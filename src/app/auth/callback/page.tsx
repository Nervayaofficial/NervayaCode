'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAuth } from '@/hooks/useAuth';
import { GlobalLoader } from '@/components/common';
import { ROUTES } from '@/utils/routesConstants';

/**
 * Landing page for the Google OAuth redirect — therapists only, since Google
 * sign-in is a therapist door (see google-identity.service.ts).
 *
 * This page exists for one reason: `auth_token` is SameSite=Strict, so the
 * browser will not send it on the cross-site navigation chain coming back from
 * accounts.google.com. Redirecting straight to a protected route would bounce
 * the freshly-authenticated user to /login.
 *
 * A same-site XHR from here DOES carry the cookie, so we read /api/auth/me and
 * hand the result to the normal auth funnel, which routes by role.
 *
 * Must stay in PUBLIC_ROUTES — it runs before the client knows it is logged in.
 */
function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { completeLoginFromSession } = useAuth();

  // React 18+ mounts effects twice in dev StrictMode; without this the funnel
  // (and its analytics event) would fire twice per login.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const returnUrl = searchParams.get('returnUrl') ?? undefined;
    const isFirstTime = searchParams.get('new') === '1';

    void completeLoginFromSession(returnUrl, isFirstTime).then((ok) => {
      // The cookie was set moments ago, so failure means it did not survive the
      // hop — send them back to a real error rather than a blank spinner.
      if (!ok) router.replace(`${ROUTES.THERAPIST_LOGIN}?error=google_session`);
    });
  }, [completeLoginFromSession, router, searchParams]);

  return <GlobalLoader label="Signing you in..." />;
}

export default function GoogleAuthCallbackPage() {
  return (
    <Suspense fallback={<GlobalLoader label="Signing you in..." />}>
      <CallbackHandler />
    </Suspense>
  );
}
