/**
 * Verifies Meta CAPI hashing and payload construction without hitting the
 * network. Run: npx tsx scripts/verify-meta-capi.ts
 */
import { buildMetaUserData, hashMetaValue, normalisePhoneForMeta } from '../src/lib/utils/meta-hash.util';
import { buildPurchaseEvent } from '../src/lib/services/meta-capi.service';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
}

// Known SHA-256 vector, so a change in hashing is caught rather than assumed.
check('sha256 of "test"', hashMetaValue('test'), '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
check('E.164 phone strips to digits', normalisePhoneForMeta('+91 98765-43210'), '919876543210');
check('email is lowercased before hashing', buildMetaUserData({ email: '  Test@Example.COM ' }).em, [
  hashMetaValue('test@example.com'),
]);
check('fbp passes through unhashed', buildMetaUserData({ fbp: 'fb.1.123.456' }).fbp, 'fb.1.123.456');
check('absent identifiers are omitted', Object.keys(buildMetaUserData({})), []);

const mixedOrder = {
  _id: 'abc123',
  userId: 'user789',
  metaAttribution: { fbp: 'fb.1.1.1' },
  items: [
    { itemType: 'Supplement', itemId: 's1', name: 'Sleep Aid', price: 500, quantity: 2 },
    { itemType: 'Therapy', itemId: 't1', name: 'Session', price: 2000, quantity: 1 },
  ],
} as unknown as Parameters<typeof buildPurchaseEvent>[0];

const built = buildPurchaseEvent(mixedOrder, { phone: '+919876543210', email: null });
const custom = built?.custom_data as Record<string, unknown>;

check('therapy lines are excluded', custom.content_ids, ['s1']);
check('value excludes therapy', custom.value, 1000);
check('event_id is deterministic', built?.event_id, 'purchase_abc123');
check('external_id hashes the user id, not the order id', (built?.user_data as Record<string, unknown>).external_id, [
  hashMetaValue('user789'),
]);

const therapyOnly = {
  _id: 'xyz789',
  userId: 'user789',
  items: [{ itemType: 'Therapy', itemId: 't1', name: 'Session', price: 2000, quantity: 1 }],
} as unknown as Parameters<typeof buildPurchaseEvent>[0];

check('therapy-only order sends nothing', buildPurchaseEvent(therapyOnly, null), null);

// SEND-side half of the CAPI health fence (src/lib/services/meta-capi.service.ts).
// An order captured before the create-order route validated/fenced the Referer
// may already hold a fenced URL in `metaAttribution.eventSourceUrl` — this proves
// buildPurchaseEvent re-checks it rather than trusting what capture-time stored.
const fencedEventSourceOrder = {
  _id: 'fenced1',
  userId: 'user789',
  metaAttribution: { eventSourceUrl: 'https://nervaya.com/sleep-assessment?step=3' },
  items: [{ itemType: 'Supplement', itemId: 's1', name: 'Sleep Aid', price: 500, quantity: 1 }],
} as unknown as Parameters<typeof buildPurchaseEvent>[0];

const fencedBuilt = buildPurchaseEvent(fencedEventSourceOrder, null);
check(
  'event_source_url omitted when the stored value references a fenced route',
  fencedBuilt && 'event_source_url' in fencedBuilt,
  false,
);

const cleanEventSourceOrder = {
  _id: 'clean1',
  userId: 'user789',
  metaAttribution: { eventSourceUrl: 'https://nervaya.com/sleep-supplements/abc123' },
  items: [{ itemType: 'Supplement', itemId: 's1', name: 'Sleep Aid', price: 500, quantity: 1 }],
} as unknown as Parameters<typeof buildPurchaseEvent>[0];

const cleanBuilt = buildPurchaseEvent(cleanEventSourceOrder, null);
check(
  'event_source_url survives when the stored value is not fenced',
  cleanBuilt?.event_source_url,
  'https://nervaya.com/sleep-supplements/abc123',
);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
