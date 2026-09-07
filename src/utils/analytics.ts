import type { NpsCategory } from '@/utils/nps.util';
import { ITEM_TYPE, type ItemType } from '@/lib/constants/enums';
import { mirrorToMetaPixel } from '@/utils/meta-pixel';
declare global {
  interface Window {
    gtag?: (command: string, action: string, params?: Record<string, unknown>) => void;
    dataLayer?: Array<Record<string, unknown>>;
  }
}

// ... (previous imports)

export type ScrollDepthThreshold = 25 | 50 | 75 | 90;

/**
 * GA4 ecommerce events whose payload GTM expects to find nested under an
 * `ecommerce` object. Anything else is pushed flat.
 */
const ECOMMERCE_EVENTS = new Set([
  'view_item',
  'view_item_list',
  'select_item',
  'add_to_cart',
  'remove_from_cart',
  'view_cart',
  'begin_checkout',
  'add_shipping_info',
  'add_payment_info',
  'purchase',
  'refund',
]);

/** Fields that belong inside the `ecommerce` object rather than beside it. */
const ECOMMERCE_FIELDS = [
  'currency',
  'value',
  'items',
  'coupon',
  'transaction_id',
  'shipping',
  'tax',
  'item_list_id',
  'item_list_name',
] as const;

function sendGaEvent(eventName: string, params?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;

  // Mirror to Meta FIRST. This function returns early on every remaining path
  // (twice inside the NEXT_PUBLIC_GTM_ID branch, once when gtag is absent), so
  // a call appended at the end would be unreachable in production, where
  // NEXT_PUBLIC_GTM_ID is always set. The pixel would silently never fire.
  mirrorToMetaPixel(eventName, params);

  if (process.env.NEXT_PUBLIC_GTM_ID) {
    window.dataLayer = window.dataLayer || [];

    if (ECOMMERCE_EVENTS.has(eventName)) {
      // Clear the previous event's ecommerce object first. Without this, GTM
      // keeps the last `items` array and attributes it to the next event too.
      window.dataLayer.push({ ecommerce: null });

      const ecommerce: Record<string, unknown> = {};
      for (const field of ECOMMERCE_FIELDS) {
        if (params && field in params) ecommerce[field] = params[field];
      }

      // Fields stay duplicated at the top level so existing GTM variables that
      // read them flat keep working; the nested copy is what GA4's built-in
      // ecommerce mapping consumes.
      window.dataLayer.push({ event: eventName, ...(params || {}), ecommerce });
      return;
    }

    window.dataLayer.push({
      event: eventName,
      ...(params || {}),
    });
    return;
  }

  if (typeof window.gtag !== 'function') return;
  window.gtag('event', eventName, params);
}

// Helper to push user context updates
export function updateGaUserContext(context: {
  logged_in?: boolean;
  internal_user_id?: string | null;
  crm_contact_id?: string | null;
  lifecycle_stage?: 'anonymous' | 'lead' | 'contact' | 'customer';
  user_type?: 'guest' | 'registered';
}): void {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    event: 'user_context_update',
    user_context: context,
  });
}

// 1. page_view
export interface PageViewParams {
  page_url: string;
  page_type: string;
  traffic_source?: string;
  device_type?: string;
  experiment_variant?: string;
  [key: string]: unknown;
}
export function trackPageView(params: PageViewParams): void {
  sendGaEvent('page_view', params);
}

// 2. cta_click
export interface CtaClickParams {
  cta_text: string;
  cta_type: 'primary' | 'secondary' | 'navigation' | 'account' | 'support' | 'social';
  cta_location: string;
  page_type: string;
  target_url: string;
  module?: string;
  [key: string]: unknown;
}
export function trackCtaClick(params: CtaClickParams): void {
  sendGaEvent('cta_click', params);
}

export interface ItemParams {
  item_id: string;
  item_name: string;
  item_category?: string;
  /**
   * The real line type. `item_category` is a display label and is NOT reliable
   * for this — order-success labels therapy 'Supplements'. The Meta fence reads
   * this field and drops any event whose lines omit it.
   */
  item_type?: ItemType;
  module?: string;
  price: number;
  currency: string;
  page_type: string;
  quantity?: number;
  [key: string]: unknown;
}

export interface EcommerceParams {
  currency: string;
  value: number;
  items: ItemParams[];
  coupon?: string;
  [key: string]: unknown;
}

// 3. view_item
export function trackItemView(params: EcommerceParams): void {
  sendGaEvent('view_item', params as unknown as Record<string, unknown>);
}
export const trackViewItem = trackItemView;

// 4. add_to_cart
export function trackAddToCart(params: EcommerceParams): void {
  sendGaEvent('add_to_cart', params as unknown as Record<string, unknown>);
}

// 5. remove_from_cart
export function trackRemoveFromCart(params: EcommerceParams): void {
  sendGaEvent('remove_from_cart', params as unknown as Record<string, unknown>);
}

// 6. begin_checkout
export interface BeginCheckoutParams {
  value: number;
  currency: string;
  item_count: number;
  modules_in_cart: string[];
  /** Required by GA4 — without it the shopping funnel loses this step. */
  items: ItemParams[];
  [key: string]: unknown;
}
export function trackBeginCheckout(params: BeginCheckoutParams): void {
  sendGaEvent('begin_checkout', params);
}

// 7. add_shipping_info
export interface ShippingInfoParams {
  shipping_country: string;
  shipping_method: string;
  value: number;
  currency: string;
  /** Required by GA4 — without it the shopping funnel loses this step. */
  items: ItemParams[];
  shipping_details?: Record<string, unknown>;
  [key: string]: unknown;
}
export function trackAddShippingInfo(params: ShippingInfoParams): void {
  sendGaEvent('add_shipping_info', params);
}

// 8. purchase
export interface PurchaseParams {
  transaction_id: string;
  order_id: string;
  value: number;
  currency: string;
  tax?: number;
  shipping?: number;
  coupon?: string;
  items: ItemParams[];
  [key: string]: unknown;
}
export function trackPurchase(params: PurchaseParams): void {
  sendGaEvent('purchase', params);
}

// 9. purchase_failed
export interface PurchaseFailedParams {
  error_code: string;
  payment_method: string;
  value: number;
  currency: string;
  transaction_id?: string;
  order_id?: string;
  [key: string]: unknown;
}
export function trackPurchaseFailed(params: PurchaseFailedParams): void {
  sendGaEvent('purchase_failed', params);
}

// 10. Logged_in
export interface LoggedInParams {
  signup_method: string;
  page_type: string;
  firsttime: 1 | 0;
  [key: string]: unknown;
}
export function trackLoggedIn(params: LoggedInParams): void {
  // GA4's recommended event name is `login`. `Logged_in` is kept because an
  // existing GTM trigger may still match it; remove it once that is repointed.
  sendGaEvent('login', params);
  sendGaEvent('Logged_in', params);
}

// 11. view_cart
export interface ViewCartParams {
  value: number;
  currency: string;
  item_count: number;
  [key: string]: unknown;
}
export function trackViewCart(params: ViewCartParams): void {
  sendGaEvent('view_cart', params);
}

// 12. apply_coupon
export interface ApplyCouponParams {
  coupon_code: string;
  discount_value: number;
  value_before: number;
  value_after: number;
  [key: string]: unknown;
}
export function trackCouponApplied(params: ApplyCouponParams): void {
  sendGaEvent('apply_coupon', params);
}
// Alias for older/other names if needed
export const trackApplyCoupon = trackCouponApplied;

export interface PaymentInfoParams {
  currency: string;
  value: number;
  payment_type: string;
  items: ItemParams[];
  coupon?: string;
  [key: string]: unknown;
}
export function trackAddPaymentInfo(params: PaymentInfoParams): void {
  sendGaEvent('add_payment_info', params);
}

// 15. scroll_depth
export interface ScrollDepthParams {
  percent_scrolled: number;
  page_type: string;
  [key: string]: unknown;
}
export function trackScrollDepth(params: ScrollDepthParams): void {
  sendGaEvent('scroll_depth', params);
}

// 16. faq_opened
export interface FaqParams {
  faq_id: string;
  faq_topic: string;
  page_type: string;
  [key: string]: unknown;
}
export function trackFaqOpened(params: FaqParams): void {
  sendGaEvent('faq_opened', params);
}

// 17. review_viewed
export function trackReviewViewed(params: { review_source: string; page_type: string; [key: string]: unknown }): void {
  sendGaEvent('review_viewed', params);
}

// 20. whatsapp_support_clicked
export interface WhatsappParams {
  support_entry_point: string;
  page_type: string;
  module?: string;
  [key: string]: unknown;
}
export function trackWhatsappSupportClicked(params: WhatsappParams): void {
  sendGaEvent('whatsapp_support_clicked', params);
}

// 26. sleep_score_generated
export interface SleepScoreParams {
  sleep_score: number;
  score_band: 'mild' | 'moderate' | 'severe' | 'none';
  assessment_version: string;
  [key: string]: unknown;
}
export function trackSleepScoreGenerated(params: SleepScoreParams): void {
  sendGaEvent('sleep_score_generated', params);
}

// 27. assessment_started
export interface AssessmentStartedParams {
  assessment_type: 'sleep' | 'deep_rest';
  assessment_id: string;
  assessment_version: string;
  page_type: string;
  [key: string]: unknown;
}
export function trackAssessmentStarted(params: AssessmentStartedParams): void {
  sendGaEvent('assessment_started', params);
}

// 28. assessment_completed
export interface AssessmentCompletedParams {
  assessment_type: string;
  assessment_id: string;
  total_questions: number;
  completion_time_seconds: number;
  [key: string]: unknown;
}
export function trackAssessmentCompleted(params: AssessmentCompletedParams): void {
  sendGaEvent('assessment_completed', params);
}

// 29. assessment_result_generated
export interface AssessmentResultParams {
  assessment_type: string;
  assessment_id: string;
  score_value: number;
  score_band: string;
  recommendation_type: 'content' | 'therapy' | 'product';
  [key: string]: unknown;
}
export function trackAssessmentResultGenerated(params: AssessmentResultParams): void {
  sendGaEvent('assessment_result_generated', params);
}

// 30. therapy_slot_selected
export interface TherapySlotParams {
  therapy_type: string;
  therapist_id: string;
  slot_datetime: string;
  price: number;
  currency: string;
  [key: string]: unknown;
}
export function trackTherapySlotSelected(params: TherapySlotParams): void {
  sendGaEvent('therapy_slot_selected', params);
}

// extra: therapy_booked
export function trackTherapyBooked(params: TherapySlotParams): void {
  sendGaEvent('therapy_booked', params);
}

// 32. page_exit (Restored for useExitPage hook)
export interface PageExitParams {
  page_path: string;
  time_on_page_seconds: number;
  [key: string]: unknown;
}
export function trackExitPage(params: PageExitParams): void {
  sendGaEvent('page_exit', params);
}

// Legacy aliases for build compatibility
export function trackStartBooking(params: { therapist_id: string; therapist_name: string }): void {
  sendGaEvent('start_booking', params);
}

export function trackViewTherapistProfile(params: { therapist_id: string; therapist_name: string }): void {
  sendGaEvent('view_therapist_profile', params);
}

export function trackViewAudioPage(): void {
  sendGaEvent('view_audio_page', { page_type: 'audio' });
}

/**
 * Deep Rest purchase.
 *
 * Fires GA4's standard `purchase` as well as the custom `audio_purchase`. Only
 * `purchase` reaches GA4's monetisation reports, so on its own `audio_purchase`
 * left Deep Rest revenue reading as zero.
 */
export function trackAudioPurchase(params: { order_id: string; value: number; currency: string }): void {
  sendGaEvent('audio_purchase', params);
  sendGaEvent('purchase', {
    transaction_id: params.order_id,
    value: params.value,
    currency: params.currency,
    items: [
      {
        item_id: params.order_id,
        item_name: 'Deep Rest Session',
        item_category: 'Digital',
        item_type: ITEM_TYPE.DRIFT_OFF,
        price: params.value,
        quantity: 1,
        currency: params.currency,
        page_type: '/deep-rest',
      },
    ],
  });
}

/**
 * Review submitted. Carries `rating_value`, so there is no separate
 * `rating_submitted` event — the review form is the only rating surface, and
 * firing both would double-count one action.
 */
export interface ReviewSubmittedParams {
  rating_value: number;
  review_length: number;
  review_target: string;
  item_id?: string;
  page_type: string;
  [key: string]: unknown;
}
export function trackReviewSubmitted(params: ReviewSubmittedParams): void {
  sendGaEvent('review_submitted', params);
}

export interface NpsParams {
  nps_score: number;
  nps_category: NpsCategory;
  nps_context: string;
  comment_length: number;
  page_type: string;
  [key: string]: unknown;
}
export function trackNpsSubmitted(params: NpsParams): void {
  sendGaEvent('nps_submitted', params);
}

export function trackLeadSubmitted(params: { lead_type: string; source_page: string; [key: string]: unknown }): void {
  sendGaEvent('lead_submitted', params);
}

export function trackPaymentFailed(params: { order_id: string; reason: string }): void {
  sendGaEvent('payment_failed', params);
}

export function trackRecommendationClicked(params: { recommendation_title: string; destination_url: string }): void {
  sendGaEvent('recommendation_clicked', params);
}

export function trackPreviewPlay(params: { video_id: string; video_title: string }): void {
  sendGaEvent('preview_play', params);
}

export function trackAudioCompleted50(params: { video_id: string; video_title: string }): void {
  sendGaEvent('audio_completed_50', params);
}

export function trackAudioCompleted100(params: { video_id: string; video_title: string }): void {
  sendGaEvent('audio_completed_100', params);
}

export function trackSearch(search_term: string): void {
  sendGaEvent('search', { search_term });
}
