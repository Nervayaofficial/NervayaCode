import { ITEM_TYPE } from '@/lib/constants/enums';
import Order, { type IOrder } from '@/lib/models/order.model';
import User from '@/lib/models/user.model';
import { buildMetaUserData } from '@/lib/utils/meta-hash.util';
import { referencesFencedRoute } from '@/lib/utils/meta-fence.util';

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';

interface MetaUserFields {
  phone?: string | null;
  email?: string | null;
}

/**
 * Build the server Purchase event, or null when it must not be sent.
 * Exported for scripts/verify-meta-capi.ts.
 */
export function buildPurchaseEvent(
  order: Pick<IOrder, 'items' | 'metaAttribution' | 'userId'> & { _id: unknown },
  user: MetaUserFields | null,
): Record<string, unknown> | null {
  const supplements = order.items.filter((item) => item.itemType === ITEM_TYPE.SUPPLEMENT);
  if (supplements.length === 0) return null;

  const orderId = String(order._id);
  const value = supplements.reduce((sum, item) => sum + item.price * item.quantity, 0);

  // Re-check the fence at SEND time, not just at capture
  // (src/app/api/payments/create-order/route.ts). An order written before
  // that capture-side fix existed may already hold a fenced URL in the
  // database, and this is the layer that protects those already-persisted
  // rows — it must not simply trust that `metaAttribution.eventSourceUrl`
  // was clean when it was stored.
  const eventSourceUrl = order.metaAttribution?.eventSourceUrl;
  const safeEventSourceUrl = eventSourceUrl && !referencesFencedRoute(eventSourceUrl) ? eventSourceUrl : undefined;

  return {
    event_name: 'Purchase',
    // Must match the browser's eventID exactly, or Meta counts the sale twice.
    event_id: `purchase_${orderId}`,
    action_source: 'website',
    ...(safeEventSourceUrl ? { event_source_url: safeEventSourceUrl } : {}),
    user_data: buildMetaUserData({
      phone: user?.phone,
      email: user?.email,
      // The USER id, not the order id. external_id must be stable across a
      // person's orders — per-order values match nothing.
      userId: order.userId ? String(order.userId) : null,
      fbp: order.metaAttribution?.fbp,
      fbc: order.metaAttribution?.fbc,
    }),
    custom_data: {
      currency: 'INR',
      value,
      content_type: 'product',
      content_ids: supplements.map((item) => String(item.itemId)),
      contents: supplements.map((item) => ({
        id: String(item.itemId),
        quantity: item.quantity,
        item_price: item.price,
      })),
      num_items: supplements.reduce((sum, item) => sum + item.quantity, 0),
    },
  };
}

/**
 * Server Purchase side effect. Callers must register this through
 * `runAfterResponse`, not fire it with a bare `void`/floating promise — an
 * unawaited promise is truncated when the serverless instance freezes on
 * response (see after-response.util.ts), which would drop the CAPI call
 * silently. Never throws: every failure path is caught and logged, so a
 * misconfigured or unreachable Meta endpoint never fails an already-settled
 * payment.
 */
export async function sendMetaPurchaseEvent(orderId: string, paymentId: string): Promise<void> {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  const token = process.env.META_CAPI_ACCESS_TOKEN;
  if (!pixelId || !token) {
    // Not a failure — most environments (local/dev, unconfigured pixel) never
    // set these. Silence must still be greppable, so it gets a line of its own
    // rather than the same "return" every other skip in this function takes.
    console.warn(`[meta-capi] skipped for order ${orderId}: missing pixel id or access token`);
    return;
  }

  // Test-login orders settle without Razorpay. Sending them would teach Meta's
  // optimiser that a staff phone number is a buyer.
  if (paymentId.startsWith('test_bypass_')) {
    console.warn(`[meta-capi] skipped for order ${orderId}: test bypass payment id`);
    return;
  }

  try {
    const order = await Order.findById(orderId).select('items metaAttribution userId').lean();
    if (!order) {
      console.warn(`[meta-capi] skipped for order ${orderId}: order not found`);
      return;
    }

    const user = await User.findById(order.userId).select('phone email').lean();
    const event = buildPurchaseEvent(order, user);
    if (!event) {
      console.warn(`[meta-capi] skipped for order ${orderId}: no supplement line items`);
      return;
    }

    // access_token travels in the body, not the query string, so it never lands
    // in proxy access logs, fetch instrumentation, or an error message that
    // happens to include the request URL.
    const body: Record<string, unknown> = {
      data: [{ ...event, event_time: Math.floor(Date.now() / 1000) }],
      access_token: token,
    };
    if (process.env.META_CAPI_TEST_EVENT_CODE) {
      body.test_event_code = process.env.META_CAPI_TEST_EVENT_CODE;
    }

    const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.error(`[meta-capi] send failed for order ${orderId}: HTTP ${response.status}`, await response.text());
      return;
    }

    // Never log the request URL, access_token, or user_data — user_data carries
    // hashed PII and the URL used to carry the token. The identifier COUNT is
    // safe and is what you'd actually need to debug a low Event Match Quality
    // score, so that's what's reported, not the identifiers themselves.
    const userData = event.user_data as Record<string, unknown> | undefined;
    const identifierCount = userData ? Object.keys(userData).length : 0;
    console.warn(
      `[meta-capi] sent purchase for order ${orderId}: event_id=${event.event_id}, identifiers=${identifierCount}`,
    );
  } catch (error) {
    console.error(`[meta-capi] send threw for order ${orderId}:`, error);
  }
}
