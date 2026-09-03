import PendingSignup from '@/lib/models/pendingSignup.model';
import connectDB from '@/lib/db/mongodb';

const PENDING_SIGNUP_TTL_MS = 10 * 60 * 1000;

export interface PendingSignupData {
  phone: string;
  name: string;
  expiresAt: number;
}

/**
 * Holds a signup's name until its OTP is verified.
 *
 * Carries no role on purpose: it used to, and a caller-supplied one rode through
 * to user creation as a privilege escalation. Every account created from here is
 * a CUSTOMER.
 */
export async function savePendingSignup(phone: string, name: string): Promise<void> {
  await connectDB();
  const normalizedPhone = phone.trim();
  const expiresAt = new Date(Date.now() + PENDING_SIGNUP_TTL_MS);

  await PendingSignup.findOneAndUpdate({ phone: normalizedPhone }, { name: name.trim(), expiresAt }, { upsert: true });
}

export async function consumePendingSignup(phone: string): Promise<Omit<PendingSignupData, 'expiresAt'> | null> {
  await connectDB();
  const normalizedPhone = phone.trim();
  const doc = await PendingSignup.findOneAndDelete({ phone: normalizedPhone });

  if (!doc) return null;
  if (new Date() > doc.expiresAt) return null;

  return {
    phone: doc.phone,
    name: doc.name,
  };
}

export async function hasPendingSignup(phone: string): Promise<boolean> {
  await connectDB();
  const normalizedPhone = phone.trim();
  const doc = await PendingSignup.findOne({ phone: normalizedPhone });

  if (!doc) return false;
  if (new Date() > doc.expiresAt) {
    await PendingSignup.deleteOne({ phone: normalizedPhone });
    return false;
  }
  return true;
}

export async function clearPendingSignup(phone: string): Promise<void> {
  await connectDB();
  const normalizedPhone = phone.trim();
  await PendingSignup.deleteOne({ phone: normalizedPhone });
}
