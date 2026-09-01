import crypto from 'crypto';
import Order from '@/lib/models/order.model';
import Cart from '@/lib/models/cart.model';
import Supplement from '@/lib/models/supplement.model';
import DriftOffOrder from '@/lib/models/driftOffOrder.model';
import Session, { ISession } from '@/lib/models/session.model';
import User from '@/lib/models/user.model';
import { createDriftOffResponse } from '@/lib/services/driftOffResponse.service';
import connectDB from '@/lib/db/mongodb';
import { createSession, finalizeSessionBooking } from '@/lib/services/session.service';
import { ValidationError } from '@/lib/utils/error.util';
import mongoose, { Types } from 'mongoose';
import { PAYMENT_STATUS, ORDER_STATUS, CURRENCY, ITEM_TYPE } from '@/lib/constants/enums';
import { getRazorpayInstance, initiateRefund } from '@/lib/utils/razorpay.util';
import { getPromoCodeByCode, incrementUsage } from '@/lib/services/promo.service';
import { sendRefundNotificationEmail } from '@/lib/services/email/refund-notification.service';
import { toObjectId } from '@/lib/utils/objectId.util';
import { hasPaymentBypass } from '@/lib/constants/test-logins';
import { releaseSlot } from '@/lib/services/slot-hold.service';
import { runAfterResponse } from '@/lib/utils/after-response.util';

export interface RazorpayOrderResponse {
  id: string;
  entity: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string;
  status: string;
  attempts: number;
  created_at: number;
}

export async function createRazorpayOrder(orderId: string, amount: number, userId: string) {
  await connectDB();

  if (!Types.ObjectId.isValid(orderId)) {
    throw new ValidationError('Invalid Order ID');
  }

  const order = await Order.findOne({ _id: orderId, userId: toObjectId(userId) });
  if (!order) {
    throw new ValidationError('Order not found or access denied');
  }

  if (amount !== order.totalAmount) {
    throw new ValidationError('Amount mismatch');
  }

  if (order.paymentStatus === PAYMENT_STATUS.PAID) {
    throw new ValidationError('Order already paid');
  }

  // Final sanity check for therapy slots before taking payment (or bypassing it).
  await assertTherapySlotsAvailable(order.items);

  // Fixed test customer: settle the order server-side and skip Razorpay entirely.
  // Stock deduction, therapy sessions and cart clearing all still run through the
  // normal success processor. See src/lib/constants/test-logins.ts for caveats.
  const buyer = await User.findById(toObjectId(userId)).select('phone').lean();
  if (buyer?.phone && hasPaymentBypass(buyer.phone)) {
    const paymentId = `test_bypass_${orderId.slice(-8)}`;
    await Order.findByIdAndUpdate(orderId, { razorpayOrderId: paymentId });
    await processPaymentSuccess(orderId, paymentId);
    return { bypassed: true as const, orderId, id: paymentId };
  }

  const amountInPaisa = Math.round(amount * 100);

  const options = {
    amount: amountInPaisa,
    currency: CURRENCY.CODE,
    receipt: `ORD_${orderId.slice(-8)}_${Date.now().toString().slice(-6)}`,
    notes: {
      orderId: orderId.toString(),
    },
  };

  const razorpay = getRazorpayInstance();
  const razorpayOrder = await razorpay.orders.create(options);

  await Order.findByIdAndUpdate(orderId, {
    razorpayOrderId: razorpayOrder.id,
  });

  return razorpayOrder;
}

interface TherapySlotItem {
  itemType: string;
  itemId: Types.ObjectId | string;
  metadata?: { date?: string; slot?: string };
}

/** Throws if a therapy item in the order targets a slot someone else just claimed. */
async function assertTherapySlotsAvailable(items: TherapySlotItem[]): Promise<void> {
  for (const item of items) {
    if (item.itemType !== ITEM_TYPE.THERAPY) continue;
    const { date, slot } = item.metadata ?? {};
    if (!date || !slot) continue;

    const existingSession = await Session.findOne({
      therapistId: item.itemId,
      date,
      startTime: slot,
      status: { $ne: 'cancelled' },
    });
    if (existingSession) {
      throw new ValidationError(`The therapy session on ${date} at ${slot} has just been booked by someone else.`);
    }
  }
}

/**
 * Shared payment success processor — called by both verifyPayment and handlePaymentWebhook.
 * Uses optimistic locking (findOneAndUpdate with paymentStatus: PENDING) to prevent
 * the race condition where both verify and webhook process the same order simultaneously.
 */
class StockError extends Error {
  itemName: string;
  orderAmount: number;
  constructor(itemName: string, orderAmount: number) {
    super(`Insufficient stock for ${itemName}`);
    this.itemName = itemName;
    this.orderAmount = orderAmount;
  }
}

async function processPaymentSuccess(orderId: string, paymentId: string) {
  const session = await mongoose.startSession();
  // Therapy sessions created inside the transaction; finalized (meet link + notifications)
  // AFTER commit so external I/O and the link write never block/conflict with the transaction.
  const therapyToFinalize: { session: ISession; date: string; startTime: string }[] = [];
  try {
    await session.withTransaction(async () => {
      therapyToFinalize.length = 0; // reset on transaction retry
      // Optimistic lock: only one caller can claim the order from PENDING → PAID
      const lockedOrder = await Order.findOneAndUpdate(
        { _id: orderId, paymentStatus: PAYMENT_STATUS.PENDING },
        { paymentId, paymentStatus: PAYMENT_STATUS.PAID, orderStatus: ORDER_STATUS.CONFIRMED },
        { new: true, session },
      );

      if (!lockedOrder) return; // Already processed or not found — idempotent exit

      // Deduct stock atomically for supplements — throws StockError to roll back entire transaction
      for (const item of lockedOrder.items) {
        if (item.itemType === ITEM_TYPE.SUPPLEMENT) {
          const result = await Supplement.findOneAndUpdate(
            { _id: item.itemId, stock: { $gte: item.quantity } },
            { $inc: { stock: -item.quantity } },
            { new: true, session },
          );
          if (!result) {
            throw new StockError(item.name || 'Unknown item', lockedOrder.totalAmount);
          }
        }
      }

      // Clear the user's cart
      await Cart.findOneAndUpdate({ userId: lockedOrder.userId }, { items: [] }).session(session);

      // Increment promo code usage
      if (lockedOrder.promoCode) {
        const promo = await getPromoCodeByCode(lockedOrder.promoCode);
        if (promo) await incrementUsage(promo._id.toString());
      }

      // Fulfill digital items
      for (const item of lockedOrder.items) {
        if (item.itemType === ITEM_TYPE.DRIFT_OFF) {
          const existingCount = await DriftOffOrder.countDocuments({
            razorpayOrderId: lockedOrder.razorpayOrderId,
          }).session(session);

          if (existingCount === 0) {
            const quantity = item.quantity || 1;
            for (let i = 0; i < quantity; i++) {
              const [newDriftOffOrder] = await DriftOffOrder.create(
                [
                  {
                    userId: lockedOrder.userId,
                    amount: item.price,
                    paymentStatus: PAYMENT_STATUS.PAID,
                    razorpayOrderId: lockedOrder.razorpayOrderId,
                    paymentId,
                  },
                ],
                { session },
              );

              await createDriftOffResponse(lockedOrder.userId.toString(), newDriftOffOrder._id.toString(), session);
              // The order still carries the pre-payment placeholder itemId ('drift-off-session') —
              // point it at the real DriftOffOrder so order-success can link to the questionnaire.
              item.itemId = newDriftOffOrder._id;
            }
          }
        } else if (item.itemType === ITEM_TYPE.THERAPY) {
          const date = item.metadata?.date as string;
          const slot = item.metadata?.slot as string;
          if (date && slot) {
            const createdSession = await createSession(
              lockedOrder.userId.toString(),
              item.itemId.toString(),
              date,
              slot,
              session,
              lockedOrder._id.toString(),
            );
            therapyToFinalize.push({ session: createdSession, date, startTime: slot });
            // The Session now owns the slot via its own unique index, so the
            // pre-payment hold has done its job and must go — otherwise it
            // blocks the customer's own reschedule until the TTL expires.
            await releaseSlot({ therapistId: item.itemId.toString(), date, startTime: slot }, session);
          }
        }
      }

      if (lockedOrder.isModified('items')) {
        await lockedOrder.save({ session });
      }
    });

    // Finalize therapy sessions outside the committed transaction (meet link + notifications).
    for (const t of therapyToFinalize) {
      await finalizeSessionBooking(t.session, t.date, t.startTime);
    }

    // Invoice + confirmation, also post-commit (PDF build, WhatsApp, SMTP).
    // Deferred rather than merely unawaited: an unawaited promise is killed when
    // the serverless instance freezes on response, which left paid orders with no
    // invoice and no message at all.
    await runAfterResponse('payment:order-confirmation', async () => {
      const { sendOrderConfirmation } = await import('@/lib/services/order-confirmation.service');
      await sendOrderConfirmation(orderId);
    });

    // Record the purchase against the buyer's CRM lead, also post-commit and
    // fire-and-forget. Until this existed the CRM knew who signed up but never
    // who bought.
    pushPurchaseToCrm(orderId);

    return { success: true };
  } catch (error) {
    // Stock failure: transaction rolled back all changes. Now mark order as refunded and initiate refund.
    if (error instanceof StockError) {
      try {
        await Order.findByIdAndUpdate(orderId, {
          paymentStatus: PAYMENT_STATUS.REFUNDED,
          orderStatus: ORDER_STATUS.CANCELLED,
        });
        await initiateRefund(paymentId);
        const order = await Order.findById(orderId);
        if (order) {
          const user = await User.findById(order.userId).select('email name');
          if (user?.email) {
            await sendRefundNotificationEmail({
              email: user.email,
              name: user.name,
              orderId,
              amount: error.orderAmount,
              reason: `Insufficient stock for ${error.itemName}`,
            });
          }
        }
      } catch (refundError) {
        console.error('Failed to initiate refund for stock failure:', refundError);
      }
      return { success: true, refunded: true, reason: error.message };
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function verifyPayment(orderId: string, paymentId: string, razorpaySignature: string, userId: string) {
  await connectDB();

  if (!Types.ObjectId.isValid(orderId)) {
    throw new ValidationError('Invalid Order ID');
  }

  const order = await Order.findOne({ _id: orderId, userId: toObjectId(userId) });
  if (!order) {
    throw new ValidationError('Order not found or access denied');
  }

  if (!order.razorpayOrderId) {
    throw new ValidationError('Razorpay order ID not found');
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
  if (!keySecret) {
    throw new Error('RAZORPAY_KEY_SECRET is not defined');
  }

  const text = `${order.razorpayOrderId}|${paymentId}`;
  const generatedSignature = crypto.createHmac('sha256', keySecret).update(text).digest('hex');

  if (generatedSignature !== razorpaySignature) {
    throw new ValidationError('Invalid payment signature');
  }

  await processPaymentSuccess(orderId, paymentId);

  const orderResult = await Order.findById(orderId);
  return { verified: true, order: orderResult };
}

export async function handlePaymentWebhook(razorpayOrderId: string, paymentId: string, event: string) {
  await connectDB();

  if (event === 'payment.captured' || event === 'payment.authorized') {
    const order = await Order.findOne({ razorpayOrderId });
    if (!order) throw new ValidationError('Order not found');

    await processPaymentSuccess(order._id.toString(), paymentId);
  } else if (event === 'payment.failed') {
    await Order.findOneAndUpdate(
      { razorpayOrderId },
      { paymentStatus: PAYMENT_STATUS.FAILED, orderStatus: ORDER_STATUS.CANCELLED },
    );
  }
  return { success: true };
}

/**
 * Push a paid order to Zoho CRM. Never throws: a CRM outage must not affect a
 * payment that has already succeeded.
 */
function pushPurchaseToCrm(orderId: string): void {
  void (async () => {
    try {
      const [order, { pushPurchaseLeadToZoho, pushLeadSafely }] = await Promise.all([
        Order.findById(orderId).lean(),
        import('@/lib/zoho/zoho-crm.service'),
      ]);
      if (!order) return;

      const user = await User.findById(order.userId).select('name email phone').lean();
      if (!user?.name || (!user.email && !user.phone)) return;

      const channels = [...new Set(order.items.map((item) => item.itemType))].join(' + ');
      pushLeadSafely('purchase', () =>
        pushPurchaseLeadToZoho({
          name: user.name,
          email: user.email ?? undefined,
          phone: user.phone ?? undefined,
          orderId: String(order._id),
          amount: order.totalAmount,
          channel: channels ? `${channels} order` : 'Order',
          items: order.items.map((item) => ({ name: item.name, quantity: item.quantity, price: item.price })),
        }),
      );
    } catch (error) {
      console.error('[Zoho] purchase lead lookup failed:', error);
    }
  })();
}
