import User from '@/lib/models/user.model';
import { generateToken } from '@/lib/utils/jwt.util';
import { validatePhone, validateName, validateEmail } from '@/lib/utils/validation.util';
import { ValidationError, AuthenticationError } from '@/lib/utils/error.util';
import connectDB from '@/lib/db/mongodb';
import { ROLES, Role } from '@/lib/constants/roles';
import { AUTH_PROVIDERS } from '@/lib/constants/enums';
import { applyTherapistRoleFromEmail } from '@/lib/services/auth/role-resolution.service';

type SessionUser = {
  _id: string;
  /**
   * Explicitly nullable rather than optional: a Google-only user genuinely has
   * no phone, and the UI must be able to tell "this account has no number" from
   * "the server didn't send one". Omitting the key would conflate the two.
   */
  phone: string | null;
  name: string;
  role: Role;
  email?: string;
  therapistId?: string;
  createdAt: Date;
  updatedAt: Date;
};

function toSessionUser(user: InstanceType<typeof User>): SessionUser {
  return {
    _id: user._id.toString(),
    phone: user.phone ?? null,
    name: user.name,
    role: user.role,
    ...(user.email && { email: user.email }),
    ...(user.therapistId && { therapistId: user.therapistId.toString() }),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * The single place a session is minted, for every authentication method.
 *
 * Role resolution runs here rather than in each caller, so a therapist is
 * recognised identically whether they signed in with Google or with a WhatsApp
 * OTP — and so the token is issued AFTER any promotion, never before it.
 */
export async function createSessionForUser(user: InstanceType<typeof User>) {
  // An absorbed account must never receive a session again. Guarding here
  // rather than at each caller covers phone login, Google sign-in and the
  // phone-link flow at once, because this is the only place a token is minted.
  if (user.mergedIntoUserId) {
    throw new AuthenticationError('This account has been merged. Please sign in with your WhatsApp number.');
  }

  const resolved = await applyTherapistRoleFromEmail(user);
  const token = await generateToken(resolved._id.toString(), resolved.role);

  return {
    user: toSessionUser(resolved),
    token,
  };
}

/**
 * The ONLY path that creates a customer account, and it can create nothing else.
 *
 * Google sign-in used to be a second one, and it minted users with
 * `phone: null` — which is what made the WhatsApp number optional in practice.
 * It is now therapist-only and gated on the therapist directory, so a verified
 * phone is unconditional for customers: this function refuses to run without
 * one, and `phoneVerified` is set from the OTP that just succeeded.
 */
export async function createUserAfterOtpVerification(phone: string, name: string) {
  await connectDB();

  if (!validatePhone(phone)) {
    throw new ValidationError('Invalid phone number');
  }

  if (!validateName(name)) {
    throw new ValidationError('Name must be at least 2 characters long');
  }

  const existingUser = await User.findOne({ phone });
  if (existingUser) {
    throw new ValidationError('User with this phone already exists');
  }

  // The role is not a parameter. It used to be, defaulting to CUSTOMER but
  // accepting anything the caller passed — and the signup route forwarded a
  // request-body value, so 'THERAPIST' was obtainable for the price of one OTP.
  const user = await User.create({
    phone,
    name,
    role: ROLES.CUSTOMER,
    phoneVerified: true,
    authProviders: [AUTH_PROVIDERS.WHATSAPP],
  });

  return createSessionForUser(user);
}

export async function createSessionAfterOtp(phone: string) {
  await connectDB();

  if (!validatePhone(phone)) {
    throw new ValidationError('Invalid phone number');
  }

  const user = await User.findOne({ phone });
  if (!user) {
    throw new AuthenticationError('User not found');
  }

  // Backfill for accounts created before providers were tracked.
  if (!user.authProviders?.includes(AUTH_PROVIDERS.WHATSAPP)) {
    user.authProviders = [...(user.authProviders ?? []), AUTH_PROVIDERS.WHATSAPP];
  }

  return createSessionForUser(user);
}

/**
 * Updates the profile. `email` is optional: omit the key to leave it untouched,
 * send an empty string to clear it.
 *
 * ⚠️ Phone is deliberately NOT settable here. It used to be, without an OTP to
 * the new number — which both let a typo lock the user out of a passwordless
 * account, and (once signup stopped requiring a phone) offered a way straight
 * past the booking/checkout phone gate. All phone writes now go through
 * /api/auth/phone/verify, which proves ownership first.
 */
export async function updateProfile(userId: string, name: string, email?: string | null) {
  await connectDB();

  if (!validateName(name)) {
    throw new ValidationError('Name must be at least 2 characters long');
  }

  const update: { name: string; email?: string | null; emailVerified?: boolean } = {
    name: name.trim(),
  };

  // Email is optional (phone is the identifier). `undefined` means "not
  // submitted, leave alone"; an empty string means the user cleared it, which
  // must store null — "" would collide on the sparse unique index the moment a
  // second user also cleared theirs.
  if (email !== undefined) {
    const trimmed = email?.trim() ?? '';
    if (trimmed && !validateEmail(trimmed)) {
      throw new ValidationError('Please enter a valid email address');
    }
    const nextEmail = trimmed ? trimmed.toLowerCase() : null;

    // Changing the address invalidates the proof attached to the previous one.
    // Without this, a Google user (emailVerified: true) could repoint `email`
    // at a therapist's address and keep the flag — walking straight through the
    // privilege boundary in applyTherapistRoleFromEmail. The phone branch used
    // to do exactly this before it was removed; the same rule has to hold here.
    const current = await User.findById(userId).select('email role').lean();
    if ((current?.email ?? null) !== nextEmail) {
      // A therapist's address is admin-owned. It is both their Google sign-in
      // identity and the directory key that grants the role, and clearing
      // `emailVerified` below used to break them permanently: their next Google
      // sign-in passed the directory gate (which matches `Therapist.email`) and
      // then failed role resolution (which reads `user.email`), demoting them to
      // CUSTOMER with no route back through the product.
      if (current?.role === ROLES.THERAPIST) {
        throw new ValidationError('Your email is managed by Nervaya. Ask an admin to update it.');
      }

      update.emailVerified = false;
    }

    update.email = nextEmail;
  }

  const user = await User.findByIdAndUpdate(userId, update, { new: true, runValidators: true }).catch((error) => {
    // Unique index on phone, sparse unique on email.
    if ((error as { code?: number }).code === 11000) {
      const duplicated = String((error as { message?: string }).message ?? '');
      throw new ValidationError(
        duplicated.includes('phone')
          ? 'That WhatsApp number is already linked to another account'
          : 'That email is already linked to another account',
      );
    }
    throw error;
  });

  if (!user) {
    throw new AuthenticationError('User not found');
  }

  return {
    user: toSessionUser(user),
  };
}
