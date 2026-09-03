import User from '@/lib/models/user.model';
import Therapist from '@/lib/models/therapist.model';
import connectDB from '@/lib/db/mongodb';
import { ROLES } from '@/lib/constants/roles';
import { AUTH_PROVIDERS } from '@/lib/constants/enums';
import type { Types } from 'mongoose';

import type { GoogleProfile } from '@/lib/utils/google-oauth.util';

type UserDoc = InstanceType<typeof User>;

export interface ResolvedGoogleIdentity {
  user: UserDoc;
  isFirstTime: boolean;
}

/** Raised when an email is already held by an account we cannot safely link to. */
export class GoogleEmailConflictError extends Error {
  constructor() {
    super('That email already belongs to another Nervaya account');
    this.name = 'GoogleEmailConflictError';
  }
}

/** Raised when the Google address is not in the therapist directory. */
export class NotATherapistError extends Error {
  constructor() {
    super('That Google account is not registered as a Nervaya therapist');
    this.name = 'NotATherapistError';
  }
}

/** Fills in details Google knows and we don't, without overwriting user edits. */
function backfillProfile(user: UserDoc, profile: GoogleProfile): void {
  // Never rebind an account that already carries a different Google identity.
  // `sub` is the stable key; a deleted-and-recreated Google account reuses the
  // address with a new sub, and silently repointing would hand the account over.
  if (!user.googleId) user.googleId = profile.sub;
  if (!user.avatarUrl) user.avatarUrl = profile.picture;
  if (!user.name?.trim()) user.name = profile.name;
  if (!user.authProviders?.includes(AUTH_PROVIDERS.GOOGLE)) {
    user.authProviders = [...(user.authProviders ?? []), AUTH_PROVIDERS.GOOGLE];
  }
}

/**
 * Frees `email` so the account Google just authenticated can hold it.
 *
 * Only an UNPROVEN claim may be taken. `updateProfile` accepts any address
 * without a verification round trip, so a second account can be sitting on this
 * one; Google has proof and that account does not, so the address moves. A
 * holder with its own `googleId`, or one whose address is already verified, is a
 * genuine conflict and is refused instead.
 *
 * Mirrors the release branch inside `resolveGoogleIdentity` — kept separate
 * because that one also has to handle LINKING the account it finds.
 */
async function releaseEmailFromOtherAccount(email: string, keepUserId: Types.ObjectId): Promise<void> {
  const holder = await User.findOne({ email, _id: { $ne: keepUserId } });
  if (!holder) return;

  // An ADMIN outranks the therapist directory everywhere else
  // (`applyTherapistRoleFromEmail` skips them outright), so their address must
  // not be taken from them either — that would split a clinic owner who is also
  // a therapist into two accounts and strip the identifier their admin account
  // is keyed on.
  if (holder.googleId || holder.emailVerified || holder.role === ROLES.ADMIN) {
    throw new GoogleEmailConflictError();
  }

  console.warn(`[google-identity] releasing unverified email ${email} from user ${holder._id.toString()}`);
  holder.email = null;

  // It cannot keep a role that rested on an address it can no longer prove.
  if (holder.role === ROLES.THERAPIST) {
    holder.role = ROLES.CUSTOMER;
    holder.therapistId = null;
  }

  await holder.save();
}

/**
 * Maps a verified Google profile onto a THERAPIST account.
 *
 * Google sign-in is a staff door, not a general one: customers authenticate by
 * WhatsApp OTP, which is what keeps a verified phone mandatory on every customer
 * account. So the therapist directory is checked FIRST and an address that is
 * not in it never reaches a User lookup:
 *
 *   0. Email absent from the Therapist directory -> reject, create nothing.
 *   1. Known googleId           -> log that user in.
 *   2. Known email, no googleId -> LINK Google to the existing account.
 *   3. Neither                  -> create the therapist's account (no phone).
 *
 * Case 2 is why `verifyGoogleIdToken` insists on `email_verified`: linking by
 * address is only safe if Google has proven the address belongs to the person
 * signing in. It is also the only thing that sets `emailVerified`, which
 * `applyTherapistRoleFromEmail` requires before it will grant the role.
 *
 * Gating at step 0 rather than only on creation is deliberate. A therapist
 * removed from the directory keeps their `googleId`, and
 * `applyTherapistRoleFromEmail` would silently demote them to CUSTOMER on the
 * next sign-in — leaving them a working login they should no longer have.
 */
export async function resolveGoogleIdentity(profile: GoogleProfile): Promise<ResolvedGoogleIdentity> {
  await connectDB();

  // The admin-entered `Therapist.email` is the entire authorization list for
  // this door. Personal Gmail addresses are expected here — therapists are not
  // on a Workspace domain — so there is no domain check to lean on.
  const therapist = await Therapist.findOne({ email: profile.email }).select('_id').lean();
  if (!therapist) throw new NotATherapistError();

  const byGoogleId = await User.findOne({ googleId: profile.sub });
  if (byGoogleId) {
    // Re-assert the address Google just proved, because the directory gate above
    // matched on `profile.email` while `applyTherapistRoleFromEmail` resolves the
    // role from `user.email`. Let those two drift and the therapist passes the
    // gate, fails role resolution, and is silently demoted to CUSTOMER with no
    // route back: Google can never restore the old value, and
    // `syncTherapistLinkByEmail` only heals a row that is already verified.
    if (byGoogleId.email !== profile.email) {
      await releaseEmailFromOtherAccount(profile.email, byGoogleId._id);
      byGoogleId.email = profile.email;
      byGoogleId.emailVerified = true;
    }

    backfillProfile(byGoogleId, profile);
    if (byGoogleId.isModified()) await byGoogleId.save();
    return { user: byGoogleId, isFirstTime: false };
  }

  const byEmail = await User.findOne({ email: profile.email });
  if (byEmail) {
    // A different Google account already holds this user. `sub` is the stable
    // identity; rebinding would hand the account to whoever re-registered the
    // address. This one genuinely is a conflict.
    if (byEmail.googleId && byEmail.googleId !== profile.sub) {
      throw new GoogleEmailConflictError();
    }

    // Same rule as `releaseEmailFromOtherAccount`: never strip an ADMIN. Seeded
    // admins have `emailVerified: false` (scripts/seed-admins.ts never sets it),
    // so without this an admin who is also in the therapist directory would lose
    // their address to a second, THERAPIST-roled account on first Google sign-in.
    if (byEmail.role === ROLES.ADMIN) {
      throw new GoogleEmailConflictError();
    }

    if (byEmail.emailVerified) {
      byEmail.googleId = profile.sub;
      backfillProfile(byEmail, profile);
      await byEmail.save();
      return { user: byEmail, isFirstTime: false };
    }

    // The existing account holds this address but never PROVED it —
    // `updateProfile` accepts any email without a verification round trip, so
    // an attacker could claim victim@example.com and wait. Linking on Google's
    // assertion alone would drop the victim into the attacker's account.
    //
    // Google has proof and that account does not, so the address moves. The old
    // account keeps its phone login and all its data; it only loses a claim it
    // never substantiated. Refusing outright was the previous behaviour and it
    // locked every phone-signup user out of Google permanently — including
    // therapists, for whom a verified email is now the only route to the role.
    console.warn(`[google-identity] releasing unverified email ${profile.email} from user ${byEmail._id.toString()}`);
    byEmail.email = null;

    // If that account held the therapist role on the strength of this address,
    // it must lose it too. Nothing else can take it back: the role heals only
    // via a VERIFIED email match, `syncTherapistLinkByEmail` demotes by email,
    // and the email is now null — so the account would keep therapist access to
    // a profile it can no longer prove any connection to, indefinitely, while a
    // second account gets promoted for the same profile.
    if (byEmail.role === ROLES.THERAPIST) {
      byEmail.role = ROLES.CUSTOMER;
      byEmail.therapistId = null;
    }

    await byEmail.save();
  }

  try {
    const created = await User.create({
      googleId: profile.sub,
      email: profile.email,
      emailVerified: true,
      name: profile.name,
      avatarUrl: profile.picture,
      // No phone, and none will be asked for: a therapist is reachable through
      // the directory record, and this is the one account shape allowed to have
      // none. Every CUSTOMER is created by `createUserAfterOtpVerification`,
      // which cannot run without a verified number.
      phone: null,
      phoneVerified: false,
      // The directory match above is what authorises this. `createSessionForUser`
      // still runs `applyTherapistRoleFromEmail`, which re-derives both fields
      // from the same directory — that service stays the single authority.
      role: ROLES.THERAPIST,
      therapistId: therapist._id,
      authProviders: [AUTH_PROVIDERS.GOOGLE],
    });
    return { user: created, isFirstTime: true };
  } catch (error) {
    // Two concurrent first-logins for the same Google account can both reach
    // this branch; the unique index settles it. Re-read rather than fail —
    // cheaper and simpler than wrapping the whole flow in a transaction.
    if (typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000) {
      const keyPattern = (error as { keyPattern?: Record<string, unknown> }).keyPattern ?? {};

      // Only googleId/email collisions mean "someone else won the race". A
      // collision on `phone` means the migration script never ran and the stale
      // non-partial index is rejecting `phone: null` — log which key it was,
      // because that failure otherwise surfaces as an unexplainable
      // "google_failed" for every new user.
      // Only a googleId collision means "the same Google account won the race".
      // Recovering from an `email` collision here used to call `backfillProfile`,
      // which sets `googleId` unconditionally — binding this Google identity to
      // an account found purely by address, bypassing the `emailVerified` check
      // and the release branch above that exist to stop exactly that.
      if ('googleId' in keyPattern) {
        const existing = await User.findOne({ googleId: profile.sub });
        if (existing) {
          backfillProfile(existing, profile);
          if (existing.isModified()) await existing.save();
          return { user: existing, isFirstTime: false };
        }
      }
      console.error('[google-identity] duplicate key on', keyPattern, '— has fix-user-identity-indexes.ts been run?');
    }
    throw error;
  }
}
