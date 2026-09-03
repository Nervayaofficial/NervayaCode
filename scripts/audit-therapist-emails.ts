/**
 * Read-only audit of therapist emails, ahead of making the field the identity key.
 *
 *   npx tsx --env-file=.env scripts/audit-therapist-emails.ts
 *
 * `Therapist.email` used to default to '' and carried no unique index, so it was
 * only ever a display field. It is about to become load-bearing in three places
 * at once: the therapist's Google sign-in, the value that promotes their User to
 * the THERAPIST role, and the mailbox the Calendar service account impersonates.
 *
 * Reads go through `.collection`, not the model: a model query triggers
 * Mongoose's index build as a side effect, which would create the very unique
 * index this script exists to decide whether it is safe to create.
 *
 * This script never writes. It produces the worklist an admin must fill in via
 * /admin/therapists/edit/[id] before `migrate-therapist-email-index.ts` can run —
 * a plain unique index cannot be built while two documents still share ''.
 */
import mongoose from 'mongoose';

import connectDB from '../src/lib/db/mongodb';
import Therapist from '../src/lib/models/therapist.model';
import User from '../src/lib/models/user.model';
import { WORKSPACE_DOMAIN, isWorkspaceEmail } from '../src/lib/constants/workspace.constants';
import { validateEmail } from '../src/lib/utils/validation.util';

interface TherapistRow {
  _id: mongoose.Types.ObjectId;
  name?: string;
  slug?: string;
  email?: string;
}

function line(t: TherapistRow, note: string): string {
  return `  ${t._id.toString()}  ${(t.name || '(unnamed)').padEnd(28)} ${note}`;
}

async function audit(): Promise<void> {
  const conn = await connectDB();
  console.log(`Connected to ${conn.connection.name}`);
  console.log(`Workspace domain: @${WORKSPACE_DOMAIN} (informational — therapists sign in with personal Gmail)\n`);

  const therapists = (await Therapist.collection
    .find({}, { projection: { _id: 1, name: 1, slug: 1, email: 1 } })
    .toArray()) as unknown as TherapistRow[];
  console.log(`${therapists.length} therapist(s) total\n`);

  const missing: TherapistRow[] = [];
  const malformed: TherapistRow[] = [];
  const offDomain: TherapistRow[] = [];
  const byEmail = new Map<string, TherapistRow[]>();

  for (const t of therapists) {
    const email = (t.email || '').trim().toLowerCase();

    if (!email) {
      missing.push(t);
      continue;
    }
    if (!validateEmail(email)) {
      malformed.push(t);
      continue;
    }
    if (!isWorkspaceEmail(email)) {
      offDomain.push(t);
    }

    const group = byEmail.get(email) ?? [];
    group.push(t);
    byEmail.set(email, group);
  }

  const duplicates = [...byEmail.entries()].filter(([, group]) => group.length > 1);

  let blocking = 0;

  if (missing.length) {
    blocking += missing.length;
    console.log(`BLOCKING — ${missing.length} therapist(s) with no email:`);
    missing.forEach((t) => console.log(line(t, `slug=${t.slug || '(none)'}`)));
    console.log('');
  }

  if (malformed.length) {
    blocking += malformed.length;
    console.log(`BLOCKING — ${malformed.length} therapist(s) with a malformed email:`);
    malformed.forEach((t) => console.log(line(t, `email=${JSON.stringify(t.email)}`)));
    console.log('');
  }

  if (duplicates.length) {
    blocking += duplicates.length;
    console.log(`BLOCKING — ${duplicates.length} email(s) shared by more than one therapist:`);
    for (const [email, group] of duplicates) {
      console.log(`  ${email}`);
      group.forEach((t) => console.log(line(t, '')));
    }
    console.log('');
  }

  // Not a warning any more: personal Gmail is the norm, because therapists are
  // not on a Workspace domain. Their sessions live on the shared calendar
  // (SHARED_CALENDAR_MAILBOX) instead of a mailbox of their own, which
  // `resolveCalendarOwner` already handles. Kept as a count so the split is
  // visible when diagnosing a calendar-ownership question.
  if (offDomain.length) {
    console.log(`INFO — ${offDomain.length} of ${therapists.length} therapist(s) are outside @${WORKSPACE_DOMAIN}.`);
    console.log('  Expected. Their session events live on the shared Nervaya calendar.\n');
  }

  // Role resolution promotes any User whose email matches a Therapist. Surface
  // the ones that will change role on next login so it is never a surprise.
  const validEmails = [...byEmail.keys()];
  if (validEmails.length) {
    const users = (await User.collection
      .find({ email: { $in: validEmails } }, { projection: { _id: 1, name: 1, email: 1, role: 1, therapistId: 1 } })
      .toArray()) as unknown as Array<{ email?: string; name?: string; role?: string }>;

    const willPromote = users.filter((u) => u.role !== 'THERAPIST');
    if (willPromote.length) {
      console.log(`NOTICE — ${willPromote.length} existing user(s) will be promoted to THERAPIST on next login:`);
      willPromote.forEach((u) => console.log(`  ${u.email}  currently ${u.role}  (${u.name})`));
      console.log('  A promoted user loses access to customer-only routes such as');
      console.log('  /account, /dashboard and /cart — confirm this is intended.\n');
    }

    const linked = users.length;
    console.log(`${linked} of ${validEmails.length} therapist email(s) already match a user account.\n`);
  }

  if (blocking === 0) {
    console.log('✅ No blocking issues. Safe to run scripts/migrate-therapist-email-index.ts');
  } else {
    console.log(`❌ ${blocking} blocking issue(s). Fix these in /admin/therapists before migrating.`);
  }

  await mongoose.connection.close();
  process.exit(blocking === 0 ? 0 : 1);
}

audit().catch((e) => {
  console.error('❌ Audit failed:', e);
  process.exit(1);
});
