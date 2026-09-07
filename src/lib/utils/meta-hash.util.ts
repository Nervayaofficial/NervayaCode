import crypto from 'crypto';

export interface MetaUserInput {
  phone?: string | null;
  email?: string | null;
  userId?: string | null;
  fbp?: string | null;
  fbc?: string | null;
}

/** SHA-256 hex. Meta requires normalisation BEFORE hashing. */
export function hashMetaValue(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Meta wants digits only, country code retained, no '+'.
 * The User model stores E.164 ('+919876543210'), so this strips to '919876543210'.
 */
export function normalisePhoneForMeta(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * Build Meta's `user_data`. Every identifier is hashed; `fbp` and `fbc` are
 * sent raw, which is what Meta expects for those two.
 */
export function buildMetaUserData(input: MetaUserInput): Record<string, string[] | string> {
  const data: Record<string, string[] | string> = {};

  if (input.phone) {
    const digits = normalisePhoneForMeta(input.phone);
    if (digits) data.ph = [hashMetaValue(digits)];
  }
  if (input.email) {
    const email = input.email.trim().toLowerCase();
    if (email) data.em = [hashMetaValue(email)];
  }
  if (input.userId) data.external_id = [hashMetaValue(String(input.userId))];
  if (input.fbp) data.fbp = input.fbp;
  if (input.fbc) data.fbc = input.fbc;

  return data;
}
