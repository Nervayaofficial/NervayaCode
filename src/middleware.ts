import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/utils/jwt.util';
import { COOKIE_NAMES } from '@/utils/cookieConstants';
import { ROLES } from '@/lib/constants/enums';
import {
  PUBLIC_ROUTES,
  THERAPIST_ROUTES,
  ADMIN_ROUTES,
  AUTH_ROUTES,
  CUSTOMER_ONLY_ROUTES,
  ROUTES,
  isProtectedPath,
  matchesRoutePrefix,
} from '@/utils/routesConstants';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/static') ||
    pathname.indexOf('.') !== -1 ||
    pathname === '/icon'
  ) {
    return NextResponse.next();
  }

  const isPublicRoute = matchesRoutePrefix(pathname, PUBLIC_ROUTES);

  const token = request.cookies.get(COOKIE_NAMES.AUTH_TOKEN)?.value;
  const decoded = token ? await verifyToken(token) : null;

  let response: NextResponse;

  // Every sign-in page, not just /login and /signup — /therapist-login has to
  // bounce an authenticated visitor too, or a signed-in therapist following a
  // bookmark lands on a login screen they cannot use.
  //
  // An `?error=` is the exception: every OAuth failure redirects to a sign-in
  // page carrying one, and the browser may still hold a valid session (a
  // signed-in customer who hits /api/auth/google/start, or a therapist whose
  // directory row was renamed mid-session). Bouncing those to a dashboard
  // discards the only explanation they would ever see.
  const carriesAuthError = request.nextUrl.searchParams.has('error');

  if (decoded && !carriesAuthError && matchesRoutePrefix(pathname, AUTH_ROUTES)) {
    let redirectUrl: string = ROUTES.DASHBOARD;
    if (decoded.role === ROLES.THERAPIST) {
      redirectUrl = ROUTES.THERAPIST_DASHBOARD;
    } else if (decoded.role === ROLES.ADMIN) {
      redirectUrl = ROUTES.ADMIN_DASHBOARD;
    }
    response = NextResponse.redirect(new URL(redirectUrl, request.url));
  } else if (!decoded && isProtectedPath(pathname)) {
    const loginUrl = new URL(ROUTES.LOGIN, request.url);
    loginUrl.searchParams.set('returnUrl', pathname);
    response = NextResponse.redirect(loginUrl);
  } else if (!decoded) {
    response = NextResponse.next();
  } else if (decoded) {
    const role = decoded.role;

    if (role === ROLES.THERAPIST) {
      const isTherapistRoute = matchesRoutePrefix(pathname, THERAPIST_ROUTES);
      const isCustomerOnly = matchesRoutePrefix(pathname, CUSTOMER_ONLY_ROUTES);
      if (isCustomerOnly || (!isTherapistRoute && !isPublicRoute)) {
        response = NextResponse.redirect(new URL(ROUTES.THERAPIST_DASHBOARD, request.url));
      } else {
        response = NextResponse.next();
      }
    } else if (role === ROLES.CUSTOMER) {
      const isTherapistPath = matchesRoutePrefix(pathname, THERAPIST_ROUTES);
      const isAdminPath = matchesRoutePrefix(pathname, ADMIN_ROUTES);
      if (isTherapistPath || isAdminPath) {
        response = NextResponse.redirect(new URL(ROUTES.DASHBOARD, request.url));
      } else {
        response = NextResponse.next();
      }
    } else if (role === ROLES.ADMIN) {
      const isCustomerOnly = matchesRoutePrefix(pathname, CUSTOMER_ONLY_ROUTES);
      const isTherapistPath = matchesRoutePrefix(pathname, THERAPIST_ROUTES);
      if (isCustomerOnly || isTherapistPath) {
        response = NextResponse.redirect(new URL(ROUTES.ADMIN_DASHBOARD, request.url));
      } else {
        response = NextResponse.next();
      }
    } else {
      response = NextResponse.next();
    }
  } else {
    response = NextResponse.next();
  }

  const isProduction = process.env.NODE_ENV === 'production';
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (isProduction) {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  return response;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icon).*)'],
};
