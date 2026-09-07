import { META_FENCED_ROUTES } from '@/lib/constants/meta-pixel.constants';

/** Best-effort URL-decode: malformed percent-encoding must not throw. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * True when the given string references any `META_FENCED_ROUTES` entry,
 * anywhere in it — as a bare pathname, inside a query string, or
 * percent-encoded (e.g. `%2Fsleep-assessment`).
 *
 * Pure and environment-agnostic — no `window`/`document`, no `'use client'`
 * — so it is safe to import from a Route Handler or a server service. This
 * is the server-side counterpart of the browser fence in
 * `src/utils/meta-pixel.ts` (which carries `'use client'` and delegates its
 * `isFencedInUrlOrReferrer` here rather than duplicating the check).
 *
 * Deliberately a plain substring test against the decoded string, not
 * path-boundary aware: a stray match inside an unrelated query param (e.g. a
 * `utm_` value containing "session") can drop an otherwise-legitimate value.
 * That false-positive is the acceptable failure direction — a leaked health
 * route is not.
 */
export function referencesFencedRoute(value: string): boolean {
  const decoded = safeDecode(value);
  return META_FENCED_ROUTES.some((route) => decoded.includes(route));
}
