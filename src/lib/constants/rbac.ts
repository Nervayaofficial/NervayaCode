import { ROLES, Role } from '@/lib/constants/roles';
import { ADMIN_ROUTES, PROTECTED_ROUTES, THERAPIST_ROUTES, matchesRoutePrefix } from '@/utils/routesConstants';

export function hasRole(user: { role: Role } | null, role: Role): boolean {
  if (!user) return false;
  return user.role === role;
}

export function canAccessAdminRoute(role: Role): boolean {
  return role === ROLES.ADMIN;
}

export function canAccessTherapistRoute(role: Role): boolean {
  return role === ROLES.THERAPIST;
}

export function getAllowedRolesForRoute(path: string): Role[] | null {
  if (matchesRoutePrefix(path, ADMIN_ROUTES)) {
    return [ROLES.ADMIN];
  }
  if (matchesRoutePrefix(path, THERAPIST_ROUTES)) {
    return [ROLES.THERAPIST];
  }
  if (matchesRoutePrefix(path, PROTECTED_ROUTES)) {
    return [ROLES.ADMIN, ROLES.CUSTOMER, ROLES.THERAPIST];
  }
  return null;
}
