'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import LoginSignupForm from '@/components/LoginSignupForm';
import { validateReturnUrl } from '@/utils/returnUrl';

/**
 * Customer sign-in. No OAuth error handling here any more: Google is the
 * therapist door, so every `?error=` code from that flow lands on
 * `/therapist-login`, which owns the copy for it.
 */
function LoginContent() {
  const returnUrl = validateReturnUrl(useSearchParams().get('returnUrl')) ?? undefined;

  return <LoginSignupForm initialMode="login" returnUrl={returnUrl} />;
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}
