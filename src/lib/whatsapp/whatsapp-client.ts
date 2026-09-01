import axios, { isAxiosError } from 'axios';

/**
 * Thin client over the Meta WhatsApp Cloud API (Graph API).
 * Env is read at call time (not module load) so missing credentials degrade
 * gracefully to the console OTP fallback instead of throwing at import.
 */

interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  apiVersion: string;
  templateName: string;
  templateLanguage: string;
}

function readConfig(): WhatsAppConfig | null {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const templateName = process.env.WHATSAPP_OTP_TEMPLATE_NAME?.trim();
  const apiVersion = process.env.WHATSAPP_API_VERSION?.trim() || 'v21.0';
  // Must match the locale the template was APPROVED under (e.g. en_US, en_GB).
  // A mismatched code triggers Graph API error #132001 ("does not exist in the translation").
  const templateLanguage = process.env.WHATSAPP_OTP_TEMPLATE_LANG?.trim() || 'en_US';

  if (!phoneNumberId || !accessToken || !templateName) {
    return null;
  }

  return { phoneNumberId, accessToken, apiVersion, templateName, templateLanguage };
}

export function isWhatsAppConfigured(): boolean {
  return readConfig() !== null;
}

interface WhatsAppBaseConfig {
  phoneNumberId: string;
  accessToken: string;
  apiVersion: string;
}

/** Base creds shared by all message types (template name supplied per-call). */
function readBaseConfig(): WhatsAppBaseConfig | null {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const apiVersion = process.env.WHATSAPP_API_VERSION?.trim() || 'v21.0';

  if (!phoneNumberId || !accessToken) {
    return null;
  }

  return { phoneNumberId, accessToken, apiVersion };
}

export function hasWhatsAppCredentials(): boolean {
  return readBaseConfig() !== null;
}

/**
 * Graph wants the recipient without the leading "+", but a bare national number
 * is not the same thing as one with the country code stripped — Meta will route
 * `8409179911` somewhere else entirely, or nowhere. Checkout collects exactly
 * that shape (10 digits, no country code), so anything shorter than a full
 * international number is rejected here rather than sent into the void.
 */
function toGraphRecipient(toE164: string): string {
  const digits = toE164.trim().replace(/^\+/, '');
  if (!/^\d{11,15}$/.test(digits)) {
    throw new WhatsAppSendError(`Recipient "${toE164}" is not in E.164 form (country code required)`);
  }
  return digits;
}

/**
 * Upload a file to WhatsApp's own media store and return its media id.
 *
 * Preferred over handing Meta a `link`: Meta fetches a link from the public
 * internet, so any host that answers with anything but a 200 kills the whole
 * template send — which is exactly how invoice PDFs stopped being delivered
 * (Cloudinary denies PDF delivery account-wide and answered 401). An uploaded
 * id needs no public hosting at all, so customer invoices never leave Meta's
 * store. Ids are valid for 30 days, far longer than the send that follows.
 */
export async function uploadWhatsAppMedia(file: Buffer, filename: string, mimeType: string): Promise<string> {
  const base = readBaseConfig();
  if (!base) {
    throw new WhatsAppSendError('WhatsApp is not configured');
  }

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', new Blob([new Uint8Array(file)], { type: mimeType }), filename);

  const url = `https://graph.facebook.com/${base.apiVersion}/${base.phoneNumberId}/media`;

  try {
    const { data } = await axios.post(url, form, {
      headers: { Authorization: `Bearer ${base.accessToken}` },
      timeout: 30000,
    });

    const mediaId = data?.id;
    if (!mediaId) {
      throw new WhatsAppSendError('WhatsApp media upload returned no id');
    }
    return mediaId;
  } catch (error) {
    if (error instanceof WhatsAppSendError) throw error;
    if (isAxiosError(error)) {
      const apiError = error.response?.data?.error;
      throw new WhatsAppSendError(
        apiError?.message || 'WhatsApp media upload failed',
        apiError?.code,
        apiError?.error_subcode,
      );
    }
    throw new WhatsAppSendError('WhatsApp media upload failed');
  }
}

/**
 * Send a WhatsApp template message whose body has ordered text variables ({{1}}, {{2}}, ...).
 * Generic helper for utility templates such as the session/consultation meeting-link message.
 *
 * @param toE164            recipient in E.164 (leading "+" is stripped here).
 * @param templateName      the APPROVED template name in the WhatsApp Manager.
 * @param templateLanguage  locale the template was approved under (e.g. en_US).
 * @param bodyParams        values for the body variables, in template order.
 * @param document          an uploaded media `id` (preferred, see uploadWhatsAppMedia) or a
 *                          publicly fetchable `link`.
 */
export async function sendDocumentTemplate(
  toE164: string,
  templateName: string,
  templateLanguage: string,
  bodyParams: string[],
  document: ({ id: string } | { link: string }) & { filename: string },
): Promise<{ messageId: string }> {
  return sendTemplate(toE164, templateName, templateLanguage, bodyParams, {
    type: 'header',
    parameters: [{ type: 'document', document }],
  });
}

export async function sendTextTemplate(
  toE164: string,
  templateName: string,
  templateLanguage: string,
  bodyParams: string[],
): Promise<{ messageId: string }> {
  return sendTemplate(toE164, templateName, templateLanguage, bodyParams);
}

/** Shared sender for template messages, with an optional header component. */
async function sendTemplate(
  toE164: string,
  templateName: string,
  templateLanguage: string,
  bodyParams: string[],
  headerComponent?: Record<string, unknown>,
): Promise<{ messageId: string }> {
  const base = readBaseConfig();
  if (!base) {
    throw new WhatsAppSendError('WhatsApp is not configured');
  }

  const to = toGraphRecipient(toE164);
  const url = `https://graph.facebook.com/${base.apiVersion}/${base.phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: templateLanguage },
      // Meta requires the header component before the body.
      components: [
        ...(headerComponent ? [headerComponent] : []),
        ...(bodyParams.length
          ? [{ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) }]
          : []),
      ],
    },
  };

  try {
    const { data } = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${base.accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    const messageId = data?.messages?.[0]?.id;
    if (!messageId) {
      throw new WhatsAppSendError('WhatsApp API returned no message id');
    }
    return { messageId };
  } catch (error) {
    if (error instanceof WhatsAppSendError) throw error;
    if (isAxiosError(error)) {
      const apiError = error.response?.data?.error;
      throw new WhatsAppSendError(apiError?.message || 'WhatsApp send failed', apiError?.code, apiError?.error_subcode);
    }
    throw new WhatsAppSendError('WhatsApp send failed');
  }
}

export class WhatsAppSendError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly subcode?: number,
  ) {
    super(message);
    this.name = 'WhatsAppSendError';
  }
}

/**
 * Send a WhatsApp authentication-template message carrying a one-time code.
 *
 * Authentication templates require the OTP value to be passed BOTH as the body
 * parameter and as the copy-code button URL parameter, otherwise the Graph API
 * rejects the request.
 *
 * @param toE164  recipient number in E.164 (with leading "+"); stripped here.
 * @param code    the OTP value.
 * @param purpose fills the template's second body variable ("...OTP code for {{2}}").
 * @returns the WhatsApp message id (wamid) for correlation with webhook events.
 */
export async function sendOtpTemplate(toE164: string, code: string, purpose: string): Promise<{ messageId: string }> {
  const config = readConfig();
  if (!config) {
    throw new WhatsAppSendError('WhatsApp is not configured');
  }

  const to = toGraphRecipient(toE164);
  const url = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: config.templateName,
      language: { code: config.templateLanguage },
      components: [
        {
          type: 'body',
          // Order must match the template: {{1}} = code, {{2}} = purpose.
          parameters: [
            { type: 'text', text: code },
            { type: 'text', text: purpose },
          ],
        },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: code }],
        },
      ],
    },
  };

  try {
    const { data } = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    const messageId = data?.messages?.[0]?.id;
    if (!messageId) {
      throw new WhatsAppSendError('WhatsApp API returned no message id');
    }
    return { messageId };
  } catch (error) {
    if (error instanceof WhatsAppSendError) throw error;
    if (isAxiosError(error)) {
      const apiError = error.response?.data?.error;
      throw new WhatsAppSendError(apiError?.message || 'WhatsApp send failed', apiError?.code, apiError?.error_subcode);
    }
    throw new WhatsAppSendError('WhatsApp send failed');
  }
}
