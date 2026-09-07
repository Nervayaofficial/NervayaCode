'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@iconify/react';
import {
  ICON_GLOBE,
  ICON_TRUCK,
  ICON_ENVELOPE,
  ICON_WHATSAPP,
  ICON_BOX,
  ICON_CALENDAR_DAY,
  ICON_HOUSE,
  ICON_HEADPHONES,
} from '@/constants/icons';
import { ITEM_TYPE } from '@/lib/constants/enums';
import { formatPrice } from '@/utils/cart.util';
import { useOrderDetail } from '@/queries/orders/useOrderDetail';
import { useAuth } from '@/hooks/useAuth';
import { getShippingCost } from '@/utils/shipping.util';
import { trackPurchase } from '@/utils/analytics';
import Sidebar from '@/components/Sidebar/LazySidebar';
import { GlobalLoader } from '@/components/common';
import { getSubtotal, formatOrderDate, formatOrderNumber } from './order-success.helpers';
import styles from './styles.module.css';

const Lottie = dynamic(() => import('lottie-react'), { ssr: false });

export default function OrderSuccessPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = typeof params.orderId === 'string' ? params.orderId : (params.orderId?.[0] ?? '');
  const { user } = useAuth();
  const { order, isLoading: loading, error } = useOrderDetail(orderId);
  const [confettiData, setConfettiData] = useState<object | null>(null);
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (!order) return;

    // Nervaya's fixed test logins settle orders server-side with a
    // `test_bypass_`-prefixed paymentId (see payment.service.ts /
    // driftOffPayment.service.ts). meta-capi.service.ts already skips these
    // server-side; the browser has no equivalent check, so without this a
    // staff test order would fire a real Purchase (training Meta's optimiser
    // on a staff phone number) and a real GA4 purchase (polluting revenue).
    if (order.paymentId?.startsWith('test_bypass_')) return;

    // `purchase` must fire once per order. This effect re-runs on refresh and
    // back-navigation, and GA4 does not reliably deduplicate by transaction_id,
    // so a repeat would inflate revenue. sessionStorage (not a ref) is what
    // survives the reload that causes it.
    const purchaseKey = `ga-purchase-sent:${order._id}`;
    try {
      if (sessionStorage.getItem(purchaseKey)) return;
      sessionStorage.setItem(purchaseKey, '1');
    } catch {
      // Private mode / storage disabled: fall through and track anyway. An
      // occasional duplicate beats losing the event entirely.
    }

    const subtotalForShipping = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const orderIsDigital = order.items.every(
      (item) => item.itemType === ITEM_TYPE.DRIFT_OFF || item.itemType === ITEM_TYPE.THERAPY,
    );
    const shippingCost = orderIsDigital ? 0 : getShippingCost(subtotalForShipping);
    trackPurchase({
      transaction_id: order._id,
      order_id: order._id,
      currency: 'INR',
      value: order.totalAmount,
      shipping: shippingCost,
      ...(order.promoCode ? { coupon: order.promoCode } : {}),
      items: order.items.map((item) => ({
        item_id: typeof item.itemId === 'string' ? item.itemId : String(item.itemId),
        item_name: item.name,
        item_category: item.itemType === ITEM_TYPE.DRIFT_OFF ? 'Digital' : 'Supplements',
        item_type: item.itemType,
        price: item.price,
        quantity: item.quantity,
        currency: 'INR',
        page_type: 'order_success',
      })),
    });
  }, [order]);

  useEffect(() => {
    fetch('/success-confetti.json')
      .then((res) => res.json())
      .then(setConfettiData)
      .catch(() => {});
  }, []);

  const isDigitalOnly =
    order?.items.every((item) => item.itemType === ITEM_TYPE.DRIFT_OFF || item.itemType === ITEM_TYPE.THERAPY) ?? false;
  const driftOffItem = order?.items.find((item) => item.itemType === ITEM_TYPE.DRIFT_OFF);
  const hasDriftOff = Boolean(driftOffItem);
  const driftOffOrderId = driftOffItem ? String(driftOffItem.itemId) : null;
  const questionnaireUrl = driftOffOrderId
    ? `/deep-rest/questionnaire?orderId=${driftOffOrderId}`
    : '/deep-rest/sessions';

  // Auto-redirect countdown for Deep Rest orders (not therapy-only digital orders)
  useEffect(() => {
    if (!order || !hasDriftOff) return;
    let current = 5;
    const tick = () => {
      setRedirectCountdown(current);
      current -= 1;
      if (current < 0) {
        clearInterval(interval);
        router.replace(questionnaireUrl);
      }
    };
    const interval = setInterval(tick, 1000);
    const kickoff = setTimeout(tick, 0);
    return () => {
      clearInterval(interval);
      clearTimeout(kickoff);
    };
  }, [order, hasDriftOff, router, questionnaireUrl]);

  if (loading) {
    return (
      <Sidebar>
        <div className={styles.container}>
          <div className={styles.loadingContainer}>
            <GlobalLoader label="Loading your order..." />
          </div>
        </div>
      </Sidebar>
    );
  }

  if (error || !order) {
    return (
      <Sidebar>
        <div className={styles.container}>
          <div className={styles.error} role="alert">
            {error || 'Order not found'}
          </div>
          <Link href={isDigitalOnly ? '/deep-rest' : '/supplements'} className={styles.link}>
            {isDigitalOnly ? 'Back to Deep Rest' : 'Continue Shopping'}
          </Link>
        </div>
      </Sidebar>
    );
  }

  const subtotal = getSubtotal(order.items);
  const shipping = isDigitalOnly ? 0 : getShippingCost(subtotal);
  const promoDiscount = order.promoDiscount ?? 0;
  const orderDate = formatOrderDate(order.createdAt);
  const orderNumber = formatOrderNumber(order._id);
  const hasEmail = Boolean(user?.email);

  return (
    <Sidebar>
      <div className={styles.container}>
        <div className={styles.successCard}>
          <div className={styles.successAnimation} aria-hidden>
            {confettiData ? (
              <Lottie animationData={confettiData} loop={false} />
            ) : (
              <div className={styles.successIconFallback}>
                <span>✓</span>
              </div>
            )}
          </div>
          <h1 className={styles.title}>Payment Successful!</h1>
          <p className={styles.message}>Thank you for your order. Your purchase has been confirmed.</p>

          <div className={styles.orderSummary}>
            <div className={styles.orderHeader}>
              <div className={styles.orderHeaderGroup}>
                <span className={styles.orderHeaderLabel}>Order Number</span>
                <span className={styles.orderHeaderValue}>{orderNumber}</span>
              </div>
              <div className={styles.orderHeaderGroup}>
                <span className={styles.orderHeaderLabel}>Order Date</span>
                <span className={styles.orderHeaderValue}>{orderDate}</span>
              </div>
            </div>

            <div className={styles.orderSection}>
              <h3 className={styles.sectionTitle}>
                <Icon icon={ICON_GLOBE} className={styles.sectionIcon} aria-hidden />
                Order Items
              </h3>
              <ul className={styles.itemsList} aria-label="Order items">
                {order.items.map((item) => (
                  <li key={`${item.name}-${item.quantity}`} className={styles.itemRow}>
                    <span>{item.name}</span>
                    <span>Quantity: {item.quantity}</span>
                    <span>{formatPrice(item.price * item.quantity)}</span>
                  </li>
                ))}
              </ul>
            </div>

            {order.shippingAddress && (
              <div className={styles.orderSection}>
                <h3 className={styles.sectionTitle}>
                  <Icon icon={ICON_TRUCK} className={styles.sectionIcon} aria-hidden />
                  Shipping Address
                </h3>
                <address className={styles.address}>
                  {order.shippingAddress.name}
                  <br />
                  {order.shippingAddress.addressLine1}
                  {order.shippingAddress.addressLine2 && (
                    <>
                      <br />
                      {order.shippingAddress.addressLine2}
                    </>
                  )}
                  <br />
                  {order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.zipCode}
                  <br />
                  {order.shippingAddress.country}
                </address>
              </div>
            )}

            <div className={styles.financialSummary}>
              <div className={styles.summaryRow}>
                <span>Subtotal</span>
                <span>{formatPrice(subtotal)}</span>
              </div>
              {shipping > 0 && (
                <div className={styles.summaryRow}>
                  <span>Shipment</span>
                  <span>{formatPrice(shipping)}</span>
                </div>
              )}
              {promoDiscount > 0 && (
                <div className={styles.summaryRow}>
                  <span>Discount</span>
                  <span className={styles.discount}>−{formatPrice(promoDiscount)}</span>
                </div>
              )}
              <div className={`${styles.summaryRow} ${styles.totalRow}`}>
                <span>Total</span>
                <span>{formatPrice(order.totalAmount)}</span>
              </div>
            </div>
          </div>

          <section className={styles.whatsNext} aria-labelledby="whats-next-heading">
            <h2 id="whats-next-heading" className={styles.whatsNextTitle}>
              What&apos;s Next?
            </h2>
            <div className={styles.nextSteps}>
              <div className={styles.nextStepCard}>
                <div className={styles.stepIcon} aria-hidden>
                  <Icon icon={hasEmail ? ICON_ENVELOPE : ICON_WHATSAPP} />
                </div>
                <p>
                  {hasEmail
                    ? `We've sent a confirmation to your WhatsApp and email (${user?.email}).`
                    : "We've sent a confirmation to your WhatsApp."}
                </p>
              </div>

              {hasDriftOff && (
                <div className={styles.nextStepCard}>
                  <div className={styles.stepIcon} aria-hidden>
                    <Icon icon={ICON_HEADPHONES} />
                  </div>
                  <p>
                    Complete your assessment questionnaire so our specialists can craft your personalized session.
                    {redirectCountdown !== null && redirectCountdown > 0 && (
                      <>
                        <br />
                        <strong>Redirecting in {redirectCountdown}s...</strong>
                      </>
                    )}
                  </p>
                </div>
              )}
              {!isDigitalOnly && (
                <>
                  <div className={styles.nextStepCard}>
                    <div className={styles.stepIcon} aria-hidden>
                      <Icon icon={ICON_BOX} />
                    </div>
                    <p>Your order is being prepared and will ship within 1–2 business days.</p>
                  </div>
                  <div className={styles.nextStepCard}>
                    <div className={styles.stepIcon} aria-hidden>
                      <Icon icon={ICON_CALENDAR_DAY} />
                    </div>
                    <p>Expected arrival in 5–7 business days.</p>
                  </div>
                </>
              )}
            </div>
          </section>

          <div className={styles.actions}>
            <Link
              href={hasDriftOff ? questionnaireUrl : isDigitalOnly ? '/dashboard' : '/supplements'}
              className={styles.primaryButton}
            >
              <Icon icon={hasDriftOff ? ICON_HEADPHONES : ICON_HOUSE} aria-hidden />
              {hasDriftOff ? 'Start Questionnaire' : isDigitalOnly ? 'Back to Home' : 'Continue Shopping'}
            </Link>
            <p className={styles.supportText}>
              Need help with your order?{' '}
              <Link href="/support" className={styles.supportLink}>
                Contact Support
              </Link>
            </p>
          </div>
        </div>
      </div>
    </Sidebar>
  );
}
