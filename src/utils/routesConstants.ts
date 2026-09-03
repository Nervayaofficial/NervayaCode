export const PUBLIC_ROUTES = [
  '/',
  '/login',
  '/signup',
  // Therapist sign-in. Public so a logged-out therapist can reach it, and listed
  // in AUTH_ROUTES so an authenticated one is bounced to their dashboard.
  '/therapist-login',
  '/about-us',
  '/privacy-policy',
  '/support',
  '/therapy-corner',
  '/sleep-assessment',
  // Google OAuth landing page. MUST be public: it runs before the client knows
  // it is authenticated, and its whole job is to read the session over a
  // same-site XHR (the auth cookie is SameSite=Strict and is not sent on the
  // cross-site redirect back from Google).
  '/auth/callback',
  // Shared meeting room — reachable by both customers and therapists. Listing it here lets the
  // THERAPIST role past the middleware role gate; access is enforced by the jitsi-token API, not the route.
  '/session',
  // Free 1-on-1 consultation room — public/anonymous (leads are not logged in). Access is gated by
  // the unguessable lead id, enforced in the consultations jitsi-token API.
  '/consultation',
] as const;

export const PROTECTED_ROUTES = [
  '/dashboard',
  '/profile',
  '/account',
  '/checkout',
  '/order-success',
  // Requires auth (logged-out users are redirected to login) but is not role-restricted.
  '/session',
] as const;

export const ADMIN_ROUTES = ['/admin'] as const;

/** Routes accessible only by users with THERAPIST role */
export const THERAPIST_ROUTES = ['/therapist'] as const;

export const AUTH_ROUTES = ['/login', '/signup', '/therapist-login'] as const;

/**
 * Role gate, not an auth gate: `isProtectedPath` deliberately ignores this list, so
 * listing a route here keeps it reachable by logged-out visitors while steering
 * THERAPIST and ADMIN sessions back to their own dashboards. `/cart` relies on that
 * distinction — guests must be able to build a cart before signing in (only
 * `/checkout` requires an account), but the cart itself is meaningless for staff roles.
 */
export const CUSTOMER_ONLY_ROUTES = [
  '/dashboard',
  '/sleep-blog',
  '/sleep-supplements',
  '/cart',
  '/deep-rest',
  '/drift-off',
  '/therapy-corner',
  '/support',
  '/sleep-assessment',
  '/account',
  '/profile',
] as const;

/**
 * Prefix match that respects path segment boundaries.
 *
 * Every consumer of these lists used to test `pathname.startsWith(route)`, which
 * treats a SIBLING path as a child: `/therapist-login`.startsWith('/therapist')
 * is true, so the therapist login page counted as a protected THERAPIST route and
 * middleware bounced every logged-out therapist to `/login`. Matching on
 * `route` or `route + '/'` keeps real children (`/admin/dashboard`,
 * `/session/<id>/room`, `/deep-rest/anything`) while excluding siblings.
 */
export function matchesRoutePrefix(pathname: string, routes: readonly string[]): boolean {
  return routes.some((route) =>
    route === '/' ? pathname === '/' : pathname === route || pathname.startsWith(`${route}/`),
  );
}

export function isProtectedPath(pathname: string): boolean {
  return (
    matchesRoutePrefix(pathname, PROTECTED_ROUTES) ||
    matchesRoutePrefix(pathname, ADMIN_ROUTES) ||
    matchesRoutePrefix(pathname, THERAPIST_ROUTES)
  );
}

export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  SIGNUP: '/signup',
  THERAPIST_LOGIN: '/therapist-login',
  DASHBOARD: '/dashboard',
  ADMIN_DASHBOARD: '/admin/dashboard',
  THERAPIST_DASHBOARD: '/therapist/dashboard',
  DEEP_REST: '/deep-rest',
  ADMIN_DEEP_REST: '/admin/deep-rest',
  SUPPLEMENTS: '/sleep-supplements',
  CART: '/cart',
  CHECKOUT: '/checkout',
  ORDER_SUCCESS: '/order-success',
} as const;
