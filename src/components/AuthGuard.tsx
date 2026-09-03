'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { ROLES } from '@/lib/constants/roles';
import {
  AUTH_ROUTES,
  ADMIN_ROUTES,
  PROTECTED_ROUTES,
  CUSTOMER_ONLY_ROUTES,
  THERAPIST_ROUTES,
  ROUTES,
  isProtectedPath,
  matchesRoutePrefix,
} from '@/utils/routesConstants';
import { validateReturnUrl } from '@/utils/returnUrl';
import LoadingScreen from '@/components/AuthGuard/LoadingScreen';

function isAuthRoute(pathname: string): boolean {
  return matchesRoutePrefix(pathname, AUTH_ROUTES);
}

function getDefaultRouteForRole(role: string | undefined): string {
  if (role === ROLES.ADMIN) return ROUTES.ADMIN_DASHBOARD;
  if (role === ROLES.THERAPIST) return ROUTES.THERAPIST_DASHBOARD;
  return ROUTES.DASHBOARD;
}

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { initializing, isAuthenticated, user } = useAuth();

  useEffect(() => {
    if (initializing) return;

    if (isAuthRoute(pathname)) {
      return;
    }

    if (isProtectedPath(pathname) && !isAuthenticated) {
      const safeReturn = validateReturnUrl(pathname);
      const loginUrl = safeReturn ? `${ROUTES.LOGIN}?returnUrl=${encodeURIComponent(safeReturn)}` : ROUTES.LOGIN;
      router.replace(loginUrl);
      return;
    }

    if (matchesRoutePrefix(pathname, ADMIN_ROUTES) && isAuthenticated && user?.role !== ROLES.ADMIN) {
      router.replace(getDefaultRouteForRole(user?.role));
      return;
    }

    if (matchesRoutePrefix(pathname, THERAPIST_ROUTES) && isAuthenticated && user?.role !== ROLES.THERAPIST) {
      router.replace(getDefaultRouteForRole(user?.role));
      return;
    }

    if (matchesRoutePrefix(pathname, PROTECTED_ROUTES) && isAuthenticated && user?.role === ROLES.ADMIN) {
      router.replace(ROUTES.ADMIN_DASHBOARD);
      return;
    }

    if (matchesRoutePrefix(pathname, CUSTOMER_ONLY_ROUTES) && isAuthenticated && user?.role === ROLES.ADMIN) {
      router.replace(ROUTES.ADMIN_DASHBOARD);
    }
  }, [initializing, isAuthenticated, user?.role, pathname, router]);

  // Auth routes (login/signup) don't depend on auth state, so render them
  // immediately — never show the full-screen loader, which caused a white
  // flash before the login background painted.
  if (isAuthRoute(pathname)) {
    return <>{children}</>;
  }

  if (initializing) {
    return <LoadingScreen />;
  }

  // Hold the loader while a redirect is in flight so unauthenticated visitors
  // never see the protected shell (nav + page body) between the useEffect
  // firing router.replace() and React actually navigating.
  const onProtectedPath = isProtectedPath(pathname);
  if (onProtectedPath && !isAuthenticated) {
    return <LoadingScreen />;
  }
  if (isAuthenticated) {
    if (matchesRoutePrefix(pathname, ADMIN_ROUTES) && user?.role !== ROLES.ADMIN) {
      return <LoadingScreen />;
    }
    if (matchesRoutePrefix(pathname, THERAPIST_ROUTES) && user?.role !== ROLES.THERAPIST) {
      return <LoadingScreen />;
    }
    if (
      (matchesRoutePrefix(pathname, PROTECTED_ROUTES) || matchesRoutePrefix(pathname, CUSTOMER_ONLY_ROUTES)) &&
      user?.role === ROLES.ADMIN
    ) {
      return <LoadingScreen />;
    }
  }

  return <>{children}</>;
}
