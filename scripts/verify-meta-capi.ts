/**
 * Verifies Meta CAPI hashing and payload construction without hitting the
 * network. Run: npx tsx scripts/verify-meta-capi.ts
 */
import { buildMetaUserData, hashMetaValue, normalisePhoneForMeta } from '../src/lib/utils/meta-hash.util';

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

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
