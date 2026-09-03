'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import LoginSignupForm from '@/components/LoginSignupForm';
import { validateReturnUrl } from '@/utils/returnUrl';

/**
 * Honours `returnUrl` like /login does. It previously ignored it, so anyone
 * sent to signup from a gated page landed on the generic dashboard instead of
 * the thing they were trying to do.
 */
function SignupContent() {
  const searchParams = useSearchParams();
  const returnUrl = validateReturnUrl(searchParams.get('returnUrl')) ?? undefined;

  return <LoginSignupForm initialMode="signup" returnUrl={returnUrl} />;
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupContent />
    </Suspense>
  );
}
