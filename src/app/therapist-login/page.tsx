'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

import { TherapistLogin } from '@/components/TherapistLogin';

/**
 * The OAuth routes redirect here with a generic code rather than Google's own
 * error text — the raw message can leak deployment configuration, and none of
 * it is actionable for the user.
 */
const THERAPIST_OAUTH_ERROR_MESSAGES: Record<string, string> = {
  not_a_therapist:
    "That Google account isn't registered as a Nervaya therapist. Ask your admin to add it to your therapist profile.",
  google_cancelled: 'Google sign-in was cancelled. Try again when you are ready.',
  google_state: 'That sign-in link expired. Please try signing in with Google again.',
  google_session: "We couldn't complete your sign-in. Please try again.",
  google_unavailable: 'Google sign-in is unavailable right now. Please contact your Nervaya admin.',
  google_failed: "We couldn't sign you in with Google. Please try again.",
  google_email_conflict:
    'A different Google account already holds that email. Ask your admin to check the address on your therapist profile.',
};

function TherapistLoginContent() {
  const errorCode = useSearchParams().get('error');
  const initialError = errorCode
    ? (THERAPIST_OAUTH_ERROR_MESSAGES[errorCode] ?? THERAPIST_OAUTH_ERROR_MESSAGES.google_failed)
    : undefined;

  return <TherapistLogin initialError={initialError} />;
}

export default function TherapistLoginPage() {
  return (
    <Suspense fallback={null}>
      <TherapistLoginContent />
    </Suspense>
  );
}
