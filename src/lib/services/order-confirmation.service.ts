import nodemailer from 'nodemailer';
import { prepareInvoiceForOrder } from '@/lib/services/invoice.service';
import { sendDocumentTemplate, uploadWhatsAppMedia } from '@/lib/whatsapp/whatsapp-client';
import { WHATSAPP_TEMPLATES } from '@/lib/constants/whatsapp-templates';
import { orderConfirmationEmail } from '@/lib/email/templates/order-confirmation';
import { isNoSendTestEmail } from '@/lib/constants/test-logins';
import type { InvoiceData } from '@/lib/pdf/invoice-pdf';

/** `₹1,887` — no decimals; the PDF carries the exact figures. */
function money(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function moneyExact(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "Magnesium Glycinate +2 more" — WhatsApp body variables must stay short. */
function itemSummary(data: InvoiceData): string {
  const first = data.lines[0]?.name ?? 'your order';
  const rest = data.lines.length - 1;
  return rest > 0 ? `${first} +${rest} more` : first;
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || 'there';
}

/** `NRV-2026-27-0042.pdf` — the name the customer sees on the attachment. */
function pdfFilename(invoiceNumber: string): string {
  return `${invoiceNumber.replace(/\//g, '-')}.pdf`;
}

async function sendWhatsApp(data: InvoiceData, pdf: Buffer, phone: string | undefined): Promise<void> {
  if (!phone) {
    console.warn(`[order-confirmation] skipped WhatsApp for ${data.orderNumber}: user has no phone`);
    return;
  }

  // Upload to Meta's media store rather than passing a link: a link makes
  // delivery depend on a public host staying reachable, and one that answers
  // non-200 fails the entire template send — message and PDF both.
  const filename = pdfFilename(data.invoiceNumber);
  const mediaId = await uploadWhatsAppMedia(pdf, filename, 'application/pdf');
  console.warn(`[order-confirmation] media uploaded ${mediaId} for ${data.orderNumber}`);

  const template = WHATSAPP_TEMPLATES.ORDER_CONFIRMATION;
  const { messageId } = await sendDocumentTemplate(
    phone,
    template.name,
    template.language,
    [firstName(data.customer.name), data.orderNumber, itemSummary(data), money(data.total)],
    { id: mediaId, filename },
  );
  // The wamid cross-references Meta and the whatsappwebhookevent collection —
  // a send accepted here but never delivered shows up as a status event there.
  console.warn(`[order-confirmation] WhatsApp sent ${messageId} for ${data.orderNumber}`);
}

async function sendEmail(data: InvoiceData, pdf: Buffer): Promise<void> {
  const to = data.customer.email;
  if (!to || isNoSendTestEmail(to)) return;

  const user = process.env.OTP_EMAIL_USER?.trim();
  const appPassword = process.env.OTP_EMAIL_APP_PASSWORD?.trim();
  if (!user || !appPassword) return;

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass: appPassword },
  });

  const { subject, html, text } = orderConfirmationEmail({
    name: firstName(data.customer.name),
    orderNumber: data.orderNumber,
    invoiceNumber: data.invoiceNumber,
    itemSummary: itemSummary(data),
    total: moneyExact(data.total),
    items: data.lines.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      lineTotal: moneyExact(line.unitPrice * line.quantity),
    })),
  });

  await transporter.sendMail({
    from: `"${process.env.OTP_EMAIL_FROM_NAME?.trim() || 'Nervaya'}" <${user}>`,
    to,
    subject,
    text,
    html,
    attachments: [{ filename: pdfFilename(data.invoiceNumber), content: pdf, contentType: 'application/pdf' }],
  });
}

/**
 * Generates the invoice and sends the confirmation over WhatsApp (always — phone
 * is the primary identifier) and email (only when the account has one).
 *
 * MUST be called AFTER the payment transaction commits: it does external I/O
 * (PDF upload, WhatsApp, SMTP) that must never be held open inside a
 * transaction. Each channel fails independently — an SMTP outage must not stop
 * the WhatsApp message, and neither must ever fail the order.
 */
export async function sendOrderConfirmation(orderId: string): Promise<void> {
  // Breadcrumbs (console.warn survives prod builds): one test order in Vercel
  // logs names the exact layer a silent failure died in.
  console.warn(`[order-confirmation] started for ${orderId}`);
  const prepared = await prepareInvoiceForOrder(orderId);
  if (!prepared) {
    console.warn(`[order-confirmation] skipped for ${orderId}: no invoice (therapy-only or order not found)`);
    return;
  }

  const { data, pdf, whatsappPhone } = prepared;

  const results = await Promise.allSettled([sendWhatsApp(data, pdf, whatsappPhone), sendEmail(data, pdf)]);
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      console.error(`[order-confirmation] ${index === 0 ? 'WhatsApp' : 'email'} failed for ${orderId}:`, result.reason);
    }
  }
}
