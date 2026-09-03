import { NextRequest, NextResponse } from 'next/server';

import { buildAuthorizeUrl } from '@/lib/utils/google-oauth.util';
import { createNonce, signOAuthState } from '@/lib/utils/oauth-state.util';
import { COOKIE_NAMES, getOAuthStateCookieOptions } from '@/utils/cookieConstants';
import { validateReturnUrl } from '@/utils/returnUrl';
import { ROUTES } from '@/utils/routesConstants';

/**
 * Begins Google sign-in — the therapist door.
 *
 * Authorization is not decided here. Any Google account can complete the round
 * trip; the callback rejects it unless the address is in the therapist
 * directory. Deliberately no `hd=` domain hint: therapists sign in with personal
 * Gmail accounts, so pre-filtering the chooser by domain would block all of them.
 *
 * Responds with a 302 rather than JSON: an OAuth authorize request must be a
 * top-level browser navigation, so the client links straight here instead of
 * fetching it.
 *
 * The CSRF nonce is set as a cookie here and echoed inside the signed `state`;
 * the callback requires both to agree. See oauth-state.util.ts.
 */
export async function GET(request: NextRequest) {
  try {
    const returnUrl = validateReturnUrl(request.nextUrl.searchParams.get('returnUrl')) ?? undefined;

    const nonce = createNonce();
    const state = await signOAuthState({ nonce, returnUrl });

    const response = NextResponse.redirect(buildAuthorizeUrl(state));
    response.cookies.set(COOKIE_NAMES.OAUTH_STATE, nonce, getOAuthStateCookieOptions());

    return response;
  } catch (error) {
    // Almost always missing GOOGLE_CLIENT_ID / redirect URI configuration.
    //
    // The reason is LOGGED but never returned: naming the unset variable in the
    // response would advertise the deployment's configuration. Swallowing it
    // entirely, as this used to, was the worse half of that trade — a
    // misconfigured production deploy told users "Google sign-in is
    // unavailable" and left nothing whatsoever in the server logs to say why,
    // so the only way to find the cause was to read this file.
    console.error('[auth/google/start] could not build the authorize URL:', error);
    return NextResponse.redirect(new URL(`${ROUTES.THERAPIST_LOGIN}?error=google_unavailable`, request.url));
  }
}
