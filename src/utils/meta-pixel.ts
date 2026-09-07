'use client';

import { matchesRoutePrefix } from '@/utils/routesConstants';
import {
  META_ALLOWED_ITEM_TYPE,
  META_EVENT_MAP,
  META_FENCED_ROUTES,
  META_ITEM_EVENTS,
  META_PIXEL_ID,
} from '@/lib/constants/meta-pixel.constants';
import { referencesFencedRoute } from '@/lib/utils/meta-fence.util';

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

export interface MetaEvent {
  name: string;
  payload: Record<string, unknown>;
  eventId?: string;
}

interface MetaContent {
  id: string;
  quantity: number;
  item_price: number;
}

/** True when no Meta event may fire on this path. */
export function isFencedRoute(pathname: string): boolean {
  return matchesRoutePrefix(pathname, META_FENCED_ROUTES);
}

/**
 * True when a fenced route appears anywhere in the given full URL or
 * referrer — not just as the current pathname.
 *
 * `fbq` attaches `document.location` (as `dl=`) and `document.referrer` (as
 * `rl=`) to every event it sends, so a fenced path leaks whenever it shows up
 * in a query string (e.g. `/login?returnUrl=%2Fsleep-assessment`) or as the
 * referrer of an allowed page (e.g. axios's full-page redirect to
 * `/login?returnUrl=<fenced-path>` on a 401). Both values arrive
 * percent-encoded, so each is decoded before the substring test.
 *
 * Delegates to `referencesFencedRoute` (`src/lib/utils/meta-fence.util.ts`)
 * — the environment-agnostic version of this same check, extracted so the
 * server side (Route Handlers, services) can reuse it without importing this
 * `'use client'` module. Deliberately over-broad: see that function's
 * docblock for why a stray substring match is the acceptable failure
 * direction, not a bug.
 */
export function isFencedInUrlOrReferrer(href: string, referrer: string): boolean {
  return referencesFencedRoute(href) || referencesFencedRoute(referrer);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Keep only supplement lines. Returns null if any line omits `item_type` — the
 * fence fails closed, because a line we cannot classify may be therapy.
 */
function filterSupplementLines(raw: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(raw)) return null;
  const lines: Record<string, unknown>[] = [];
  for (const line of raw) {
    if (!isRecord(line)) return null;
    if (typeof line.item_type !== 'string') return null;
    if (line.item_type === META_ALLOWED_ITEM_TYPE) lines.push(line);
  }
  return lines;
}

function toContents(lines: Record<string, unknown>[]): MetaContent[] | null {
  const contents: MetaContent[] = [];
  for (const line of lines) {
    const { item_id: id, quantity, price } = line;
    if (typeof id !== 'string' || id === '') return null;
    const qty = quantity === undefined ? 1 : quantity;
    if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0) return null;
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return null;
    contents.push({ id, quantity: qty, item_price: price });
  }
  return contents;
}

/**
 * Translate one dataLayer event into a Meta event, or null if it must not be
 * sent. Pure and exported so the fence can be reasoned about and tested without
 * a browser.
 */
export function buildMetaPayload(
  eventName: string,
  params: Record<string, unknown> | undefined,
  pathname: string,
): MetaEvent | null {
  if (isFencedRoute(pathname)) return null;

  // `login` is only interesting to Meta the first time.
  if (eventName === 'login') {
    if (params?.firsttime !== 1) return null;
    return { name: 'CompleteRegistration', payload: {} };
  }

  const metaName = META_EVENT_MAP[eventName];
  if (typeof metaName !== 'string') return null;

  if (eventName === 'page_view') return { name: 'PageView', payload: {} };
  if (eventName === 'search') return { name: 'Search', payload: {} };

  if (!META_ITEM_EVENTS.has(eventName)) return { name: metaName, payload: {} };

  const lines = filterSupplementLines(params?.items);
  if (lines === null || lines.length === 0) return null;

  const contents = toContents(lines);
  if (contents === null) return null;
  // Never pass through `value` — order.totalAmount and the cart total both
  // include therapy and Deep Rest lines the fence just removed.
  const value = contents.reduce((sum, c) => sum + c.item_price * c.quantity, 0);

  const payload: Record<string, unknown> = {
    content_type: 'product',
    content_ids: contents.map((c) => c.id),
    contents,
    currency: typeof params?.currency === 'string' ? params.currency : 'INR',
    value,
    num_items: contents.reduce((sum, c) => sum + c.quantity, 0),
  };

  if (lines.length === 1) {
    if (typeof lines[0].item_name === 'string') payload.content_name = lines[0].item_name;
    if (typeof lines[0].item_category === 'string') payload.content_category = lines[0].item_category;
  }

  if (eventName !== 'purchase') return { name: metaName, payload };

  // Deterministic id so the browser and the Conversions API agree without
  // coordinating. A random id here would double every reported conversion.
  const orderId = params?.order_id;
  if (typeof orderId !== 'string' && typeof orderId !== 'number') return null;
  return { name: 'Purchase', payload, eventId: `purchase_${String(orderId)}` };
}

/** Mirror one dataLayer event to the Meta Pixel. Never throws. */
export function mirrorToMetaPixel(eventName: string, params?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  if (!META_PIXEL_ID) return;
  if (typeof window.fbq !== 'function') return;

  if (isFencedInUrlOrReferrer(window.location.href, document.referrer)) return;

  const event = buildMetaPayload(eventName, params, window.location.pathname);
  if (!event) return;

  try {
    if (event.eventId) {
      window.fbq('track', event.name, event.payload, { eventID: event.eventId });
      return;
    }
    window.fbq('track', event.name, event.payload);
  } catch (error) {
    // `fbq` is third-party code (Meta's fbevents.js, or a browser-extension
    // shim replacing it) — a throw here must never surface as our bug. See
    // the docblock above: this is what makes "Never throws" true.
    console.error('mirrorToMetaPixel: window.fbq threw', error);
  }
}
