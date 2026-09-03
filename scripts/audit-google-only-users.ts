/**
 * Lists the accounts that the therapist-only Google change locked out.
 *
 * Google sign-in used to create CUSTOMER accounts with `phone: null`. It no
 * longer creates customers at all, so those accounts have no way in: Google
 * rejects them (their address is not in the therapist directory) and every OTP
 * route is keyed on a phone number they never gave.
 *
 * Re-registering does not recover them. The new account gets a fresh `_id`, so
 * orders, sessions and assessments stay on the orphan, and adding the old email
 * to the new account fails on the partial-unique `email_1` index because the
 * orphan still holds it. `mergeAccountByPhone` cannot help either — the two
 * accounts share no identifier.
 *
 * This script never writes. It exists so the size of that population is a
 * number rather than a guess, and so support can be handed a worklist.
 */
import mongoose from 'mongoose';

import connectDB from '../src/lib/db/mongodb';
import User from '../src/lib/models/user.model';
import Order from '../src/lib/models/order.model';
import Session from '../src/lib/models/session.model';
import { ROLES } from '../src/lib/constants/roles';

interface UserRow {
  _id: mongoose.Types.ObjectId;
  name?: string;
  email?: string;
  createdAt?: Date;
}

async function audit(): Promise<void> {
  const conn = await connectDB();
  console.log(`Connected to ${conn.connection.name}\n`);

  // A present googleId with no phone is the exact shape the old Google signup
  // produced. Therapists are excluded: for them a null phone is correct.
  const orphans = (await User.collection
    .find(
      {
        googleId: { $type: 'string', $gt: '' },
        $or: [{ phone: null }, { phone: { $exists: false } }, { phone: '' }],
        role: { $ne: ROLES.THERAPIST },
        mergedIntoUserId: null,
      },
      { projection: { _id: 1, name: 1, email: 1, createdAt: 1 } },
    )
    .sort({ createdAt: 1 })
    .toArray()) as unknown as UserRow[];

  if (!orphans.length) {
    console.log('No locked-out Google-only accounts. Nothing to do.');
    return;
  }

  console.log(`${orphans.length} locked-out account(s) — googleId set, no phone, not a therapist:\n`);

  let withData = 0;

  for (const u of orphans) {
    const id = u._id;
    const [orders, sessions] = await Promise.all([
      Order.countDocuments({ userId: id }),
      Session.countDocuments({ userId: id }),
    ]);
    if (orders || sessions) withData += 1;

    const created = u.createdAt ? u.createdAt.toISOString().slice(0, 10) : '(unknown)';
    console.log(
      `  ${id.toString()}  ${(u.name || '(unnamed)').padEnd(24)} ${(u.email || '(no email)').padEnd(34)} ` +
        `created=${created} orders=${orders} sessions=${sessions}`,
    );
  }

  console.log(`\n${withData} of ${orphans.length} carry orders or sessions — those cannot be abandoned silently.`);
  console.log('Each one still holds its email on the unique index, so the owner cannot reuse that address');
  console.log('on a fresh WhatsApp signup until this account is reconciled.');
}

audit()
  .catch((error) => {
    console.error('audit failed:', error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.connection.close());
