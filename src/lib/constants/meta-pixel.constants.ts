import { ITEM_TYPE, type ItemType } from '@/lib/constants/enums';

/** Empty when unset — the pixel then degrades to a no-op rather than throwing. */
export const META_PIXEL_ID: string = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? '';

/**
 * Routes that must never produce a Meta event of any kind.
 *
 * `fbq` attaches `document.location` to every event it sends, so stripping
 * parameters does not help: the URL alone reveals what the visitor is seeking.
 * These are suppressed entirely. `/sleep-blog` is included because article
 * slugs are equally revealing — see the spec for why index-only was rejected.
 */
export const META_FENCED_ROUTES = [
  '/deep-rest',
  '/drift-off',
  '/sleep-assessment',
  '/therapy-corner',
  '/consultation',
  '/session',
  '/account',
  '/therapist',
  '/admin',
  '/sleep-blog',
] as const;

/**
 * GA4 dataLayer event -> Meta standard event. Anything absent is not sent:
 * Meta cannot optimise on scroll depth, CTA clicks or exit events, and several
 * of the remaining events are health-revealing.
 *
 * `login` maps to CompleteRegistration only when `firsttime === 1`, handled in
 * buildMetaPayload. `Logged_in` is deliberately absent — trackLoggedIn emits it
 * alongside `login` for a legacy GTM trigger, so mapping both would double-fire.
 * `lead_submitted` is deliberately absent — its only caller is the free
 * consultation form, which is therapy intake.
 */
export const META_EVENT_MAP: Readonly<Record<string, string>> = {
  page_view: 'PageView',
  view_item: 'ViewContent',
  add_to_cart: 'AddToCart',
  begin_checkout: 'InitiateCheckout',
  add_payment_info: 'AddPaymentInfo',
  purchase: 'Purchase',
  search: 'Search',
};

/** Events carrying an `items` array, which must be filtered to supplements. */
export const META_ITEM_EVENTS: ReadonlySet<string> = new Set([
  'view_item',
  'add_to_cart',
  'begin_checkout',
  'add_payment_info',
  'purchase',
]);

/** The only line type Meta ever sees. */
export const META_ALLOWED_ITEM_TYPE: ItemType = ITEM_TYPE.SUPPLEMENT;
