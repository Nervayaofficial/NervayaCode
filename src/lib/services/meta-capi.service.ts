import { ITEM_TYPE } from '@/lib/constants/enums';
import Order, { type IOrder } from '@/lib/models/order.model';
import User from '@/lib/models/user.model';
import { buildMetaUserData } from '@/lib/utils/meta-hash.util';

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

  return {
    event_name: 'Purchase',
    // Must match the browser's eventID exactly, or Meta counts the sale twice.
    event_id: `purchase_${orderId}`,
    action_source: 'website',
    ...(order.metaAttribution?.eventSourceUrl ? { event_source_url: order.metaAttribution.eventSourceUrl } : {}),
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
 * Fire-and-forget server Purchase. Mirrors pushLeadSafely: failures are logged,
 * never swallowed, and never block or fail a payment.
 */
export function sendMetaPurchaseEvent(orderId: string, paymentId: string): void {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  const token = process.env.META_CAPI_ACCESS_TOKEN;
  if (!pixelId || !token) return;

  // Test-login orders settle without Razorpay. Sending them would teach Meta's
  // optimiser that a staff phone number is a buyer.
  if (paymentId.startsWith('test_bypass_')) return;

  void (async () => {
    try {
      const order = await Order.findById(orderId).lean();
      if (!order) return;

      const user = await User.findById(order.userId).select('phone email').lean();
      const event = buildPurchaseEvent(order, user);
      if (!event) return;

      const body: Record<string, unknown> = {
        data: [{ ...event, event_time: Math.floor(Date.now() / 1000) }],
      };
      if (process.env.META_CAPI_TEST_EVENT_CODE) {
        body.test_event_code = process.env.META_CAPI_TEST_EVENT_CODE;
      }

      const response = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${token}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        console.error('Meta CAPI purchase failed:', response.status, await response.text());
      }
    } catch (error) {
      console.error('Meta CAPI purchase threw:', error);
    }
  })();
}
