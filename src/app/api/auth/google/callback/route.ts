import { NextRequest, NextResponse } from 'next/server';

import { exchangeCodeForIdToken, verifyGoogleIdToken } from '@/lib/utils/google-oauth.util';
import { verifyOAuthState } from '@/lib/utils/oauth-state.util';
import {
  GoogleEmailConflictError,
  NotATherapistError,
  resolveGoogleIdentity,
} from '@/lib/services/auth/google-identity.service';
import { createSessionForUser } from '@/lib/services/auth.service';
import { COOKIE_NAMES, getSecureCookieOptions, getOAuthStateCookieOptions } from '@/utils/cookieConstants';
import { validateReturnUrl } from '@/utils/returnUrl';
import { ROUTES } from '@/utils/routesConstants';

/**
 * Generic codes only — never echo Google's error text back to the browser.
 *
 * Failures land on the therapist sign-in page, not `/login`: this flow is only
 * reachable from there, and the customer form no longer has a Google button to
 * explain an OAuth error next to.
 */
function failure(request: NextRequest, code: string): NextResponse {
  const response = NextResponse.redirect(new URL(`${ROUTES.THERAPIST_LOGIN}?error=${code}`, request.url));
  response.cookies.set(COOKIE_NAMES.OAUTH_STATE, '', { ...getOAuthStateCookieOptions(), maxAge: 0 });
  return response;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // The user pressed "Cancel" on Google's consent screen.
  if (params.get('error')) return failure(request, 'google_cancelled');

  const code = params.get('code');
  if (!code) return failure(request, 'google_failed');

  const verifiedState = await verifyOAuthState(
    params.get('state') ?? undefined,
    request.cookies.get(COOKIE_NAMES.OAUTH_STATE)?.value,
  );
  if (!verifiedState) return failure(request, 'google_state');

  try {
    const idToken = await exchangeCodeForIdToken(code);
    const profile = await verifyGoogleIdToken(idToken);

    const { user, isFirstTime } = await resolveGoogleIdentity(profile);
    // Mints the token AFTER therapist-role resolution, so a therapist lands on
    // the therapist dashboard on the first hop rather than the customer one.
    const session = await createSessionForUser(user);

    // Re-validate even though it came from a token we signed: defence in depth
    // costs nothing here.
    const returnUrl = validateReturnUrl(verifiedState.returnUrl);

    const destination = new URL('/auth/callback', request.url);
    if (returnUrl) destination.searchParams.set('returnUrl', returnUrl);
    if (isFirstTime) destination.searchParams.set('new', '1');

    // Land on a PUBLIC page, not straight on the dashboard. `auth_token` is
    // SameSite=Strict, and this redirect is the tail of a cross-site navigation
    // chain from accounts.google.com — the browser stores the cookie but will
    // not SEND it on that hop, so a protected destination would bounce the
    // freshly-authenticated user back to /login. The callback page then calls
    // /api/auth/me as a same-site XHR, which does carry the cookie.
    const response = NextResponse.redirect(destination);

    response.cookies.set(COOKIE_NAMES.AUTH_TOKEN, session.token, getSecureCookieOptions());
    response.cookies.set(COOKIE_NAMES.OAUTH_STATE, '', { ...getOAuthStateCookieOptions(), maxAge: 0 });

    // No guest claim here. A guest sleep assessment is a customer artifact and
    // only therapists arrive through this route, so claiming one would weld a
    // stranger's assessment onto a staff account. The OTP path still claims.

    return response;
  } catch (error) {
    if (error instanceof NotATherapistError) {
      return failure(request, 'not_a_therapist');
    }
    if (error instanceof GoogleEmailConflictError) {
      return failure(request, 'google_email_conflict');
    }

    // LOG the reason, return only the generic code. Without this line a missing
    // GOOGLE_CLIENT_SECRET (read for the first time during the token exchange —
    // `/start` needs only the client id, so it succeeds) shows every therapist
    // "we couldn't sign you in", forever, with nothing whatsoever in the server
    // logs. Same for a token-time redirect_uri mismatch or a JWKS failure.
    console.error('[auth/google/callback] sign-in failed:', error);
    return failure(request, 'google_failed');
  }
}
