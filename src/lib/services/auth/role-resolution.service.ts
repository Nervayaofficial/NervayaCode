import Therapist from '@/lib/models/therapist.model';
import User from '@/lib/models/user.model';
import { ROLES } from '@/lib/constants/roles';
import connectDB from '@/lib/db/mongodb';

/** The hydrated Mongoose document, not the plain interface — we call .save(). */
type UserDoc = InstanceType<typeof User>;

/**
 * Reconciles a user's role against the therapist directory, keyed on email.
 *
 * This is how the system learns that a given sign-in belongs to a therapist:
 * an admin records the therapist's Google (personal Gmail) address, and whoever
 * authenticates with that address — by Google OR by WhatsApp OTP — becomes the
 * THERAPIST linked to that profile.
 *
 * Runs on EVERY session creation, which is what makes it order-independent:
 * it does not matter whether the Therapist record or the User existed first,
 * and a therapist whose record is later renamed or deleted heals on next login.
 *
 * Never throws — a directory hiccup must not block a login.
 */
export async function applyTherapistRoleFromEmail(user: UserDoc): Promise<UserDoc> {
  // Admins outrank the directory. A Therapist record must never be able to
  // demote an admin, or an admin's own email in the directory would lock them
  // out of /admin on their next login.
  if (user.role === ROLES.ADMIN) return user;

  const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';

  // No email means nothing to match on. Deliberately leave the role alone
  // rather than demoting: a therapist can have been linked by hand, and a
  // phone-only login carries no email to compare.
  if (!email) return user;

  // ⚠️ PRIVILEGE BOUNDARY: an email only grants the role once PROVEN.
  //
  // `updateProfile` lets any authenticated user write any address onto their own
  // account, so an unproven match must not promote — otherwise signing up by
  // OTP, setting `email` to a therapist's address and logging back in would
  // hand over that therapist's client list, sessions and calendar.
  //
  // It must NOT demote either, which an earlier version did. `emailVerified` is
  // set only by Google sign-in, so demoting on it stripped the role from every
  // therapist who had ever signed up by phone — on each login, permanently, and
  // invisibly in tests because the seeds set the flag true.
  if (!user.emailVerified) return user;

  try {
    const therapist = await Therapist.findOne({ email }).select('_id').lean();

    if (therapist) {
      const therapistId = therapist._id;
      const alreadyLinked = user.role === ROLES.THERAPIST && user.therapistId?.toString() === therapistId.toString();

      if (!alreadyLinked) {
        user.role = ROLES.THERAPIST;
        user.therapistId = therapistId;
        await user.save();
      }
      return user;
    }

    // No therapist owns this address any more. Self-heal: an admin who changed
    // a therapist's email, or deleted the profile, should not leave a stranded
    // THERAPIST account with access to the therapist area.
    if (user.role === ROLES.THERAPIST) {
      user.role = ROLES.CUSTOMER;
      user.therapistId = null;
      await user.save();
    }
    return user;
  } catch (error) {
    // Best-effort: failing here would turn a directory hiccup into a total
    // login outage. But it MUST be logged — this silently swallowed
    // VersionError/ValidationError from save(), which would mean a therapist
    // never gets promoted, forever, with no signal anywhere.
    console.error('[role-resolution] failed to resolve therapist role:', error);
    return user;
  }
}

/**
 * Strips the THERAPIST role from anyone linked to a therapist profile.
 *
 * Call when a profile is deleted. Without this the linked account keeps
 * `role: THERAPIST` indefinitely: `applyTherapistRoleFromEmail` only self-heals
 * for a user who is actually signing in, and with five-day sliding sessions an
 * active therapist may not re-authenticate for weeks.
 */
export async function demoteTherapistUsers(therapistId: string): Promise<void> {
  await connectDB();

  try {
    await User.updateOne({ therapistId, role: ROLES.THERAPIST }, { $set: { role: ROLES.CUSTOMER, therapistId: null } });
  } catch (error) {
    console.error('[role-resolution] failed to demote users for deleted therapist:', error);
  }
}

/**
 * Links a therapist profile to an already-existing user account, so the change
 * takes effect immediately rather than on that person's next login.
 *
 * Call after creating or updating a Therapist. `previousEmail` demotes the
 * account that used to hold the role when an admin reassigns the address.
 */
export async function syncTherapistLinkByEmail(
  therapistId: string,
  email: string,
  previousEmail?: string | null,
): Promise<void> {
  await connectDB();

  const nextEmail = email.trim().toLowerCase();
  const priorEmail = previousEmail?.trim().toLowerCase();

  try {
    if (priorEmail && priorEmail !== nextEmail) {
      // Demote the old holder, unless they are an admin.
      await User.updateOne(
        { email: priorEmail, role: ROLES.THERAPIST },
        { $set: { role: ROLES.CUSTOMER, therapistId: null } },
      );
    }

    // Promote — but ONLY an account that has proven this address.
    //
    // `updateProfile` accepts an unverified email, so matching on the address
    // alone would let an attacker claim a therapist's email and be granted the
    // role the moment an admin created that therapist. `emailVerified` is set
    // only by Google sign-in, so requiring it closes that path.
    //
    // Dropping the promotion entirely (the previous attempt) over-corrected:
    // `applyTherapistRoleFromEmail` runs only when a session is CREATED, and
    // sessions slide for five days, so a therapist who had already signed in
    // before their profile existed stayed locked out of /therapist for up to
    // that long with nothing in the UI explaining why.
    await User.updateOne(
      { email: nextEmail, emailVerified: true, role: { $ne: ROLES.ADMIN } },
      { $set: { role: ROLES.THERAPIST, therapistId } },
    );
  } catch (error) {
    // Non-fatal for PROMOTION — that converges on next login. Demotion does
    // not: applyTherapistRoleFromEmail can only demote someone who is
    // themselves signing in, so a silently-failed demotion leaves a stale
    // THERAPIST holding a five-day sliding session. Always log it.
    console.error('[role-resolution] failed to sync therapist link:', error);
  }
}
