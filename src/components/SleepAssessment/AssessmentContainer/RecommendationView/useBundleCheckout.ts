'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ensureRazorpayLoaded } from '@/utils/loadRazorpay';
import { type AssessmentResult, type ServiceKey, getBundleItems, getTherapyPriority } from '@/utils/sleepAssessment';
import { cartApi } from '@/lib/api/cart';
import { useAuth } from '@/hooks/useAuth';
import { sleepPlanApi, type PlanPricing, type PlanServiceKey } from '@/lib/api/sleepPlan';
import { ITEM_TYPE } from '@/lib/constants/enums';
import { DRIFT_OFF_SESSION_IMAGE } from '@/lib/constants/driftOff.constants';
import { SLEEP_PLAN_BUNDLE_SOURCE, THERAPY_CORNER_PATH } from '@/lib/constants/sleepPlan.constants';
import type { SleepPlanData } from './useSleepPlanData';
import type { TherapistSelection } from './TherapistSelectionModal';
import { clearPlanTherapySelection } from './TherapistSelectionModal/planTherapySelection';

export type AddingState = 'plan' | 'cart' | 'therapy' | `mod:${string}` | null;

interface UseBundleCheckoutArgs {
  result: AssessmentResult;
  plan: SleepPlanData;
  setAdding: (next: AddingState | ((prev: AddingState) => AddingState)) => void;
  openTherapistModal: () => void;
  closeTherapistModal: () => void;
  refreshCart: () => Promise<void>;
}

export interface UseBundleCheckoutReturn {
  bundleItems: ServiceKey[];
  selectedItems: ServiceKey[];
  selectedCount: number;
  toggleItem: (key: ServiceKey) => void;
  showBundle: boolean;
  showTherapy: boolean;
  pricing: { originalPrice: number; discountedPrice: number; savingsAmount: number };
  handleStartPlan: () => Promise<void>;
  handleAddPlanToCart: () => Promise<void>;
  handleTherapyConfirm: (selection: TherapistSelection) => Promise<void>;
  startTherapySelection: () => void;
  /** True when the plan includes therapy, which forces the single-order route. */
  selectedHasTherapy: boolean;
}

export function useBundleCheckout({
  result,
  plan,
  setAdding,
  openTherapistModal,
  closeTherapistModal,
  refreshCart,
}: UseBundleCheckoutArgs): UseBundleCheckoutReturn {
  const router = useRouter();
  const { user } = useAuth();

  const bundleItems = useMemo(() => getBundleItems(result.services), [result.services]);
  const [excludedItems, setExcludedItems] = useState<Set<ServiceKey>>(() => new Set());

  const selectedItems = useMemo<ServiceKey[]>(
    () => bundleItems.filter((key) => !excludedItems.has(key)),
    [bundleItems, excludedItems],
  );
  const selectedCount = selectedItems.length;
  const selectedHasTherapy = selectedItems.includes('THERAPY');

  const toggleItem = useCallback(
    (key: ServiceKey) => {
      setExcludedItems((prev) => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key); // re-include
          return next;
        }
        // Excluding: block if this is the last remaining selected item.
        const remaining = bundleItems.filter((k) => !next.has(k)).length;
        if (remaining <= 1) return prev;
        next.add(key);
        return next;
      });
    },
    [bundleItems],
  );

  const therapyPriority = useMemo(() => getTherapyPriority(result.services), [result.services]);
  const bundleHasSupplement = bundleItems.includes('SUPPLEMENT');
  const showBundle = bundleItems.length > 0 && (!bundleHasSupplement || !!plan.supplement);
  const showTherapy = therapyPriority !== 'None' && !bundleItems.includes('THERAPY');

  const supplementPrice = plan.supplement?.price ?? 0;

  const itemUnitPrice = useCallback(
    (key: ServiceKey): number => {
      if (key === 'SUPPLEMENT') return supplementPrice;
      if (key === 'GUIDED_AUDIO') return plan.deepRestPrice;
      if (key === 'THERAPY') return plan.therapyPrice;
      return 0;
    },
    [supplementPrice, plan.deepRestPrice, plan.therapyPrice],
  );

  // Priced by the server, from the same function that prices the order, so the
  // number shown here cannot drift from the number charged. The local sum is
  // only a placeholder while the quote is in flight.
  const [quote, setQuote] = useState<PlanPricing | null>(null);

  useEffect(() => {
    let active = true;
    if (selectedItems.length === 0) {
      setQuote(null);
      return;
    }
    sleepPlanApi
      .getQuote(selectedItems as PlanServiceKey[])
      .then((res) => {
        if (active && res.success && res.data) setQuote(res.data);
      })
      .catch(() => {
        if (active) setQuote(null);
      });
    return () => {
      active = false;
    };
  }, [selectedItems]);

  const pricing = useMemo(() => {
    const localSubtotal = selectedItems.reduce((sum, key) => sum + itemUnitPrice(key), 0);
    if (!quote) {
      return { originalPrice: localSubtotal, discountedPrice: localSubtotal, savingsAmount: 0 };
    }
    return {
      originalPrice: quote.subtotal,
      discountedPrice: quote.total,
      savingsAmount: quote.discountAmount,
    };
  }, [quote, selectedItems, itemUnitPrice]);

  /**
   * Takes an existing pending order through payment.
   *
   * Mirrors the direct-booking flow: create the Razorpay order, honour the test
   * customer's bypass, otherwise open the checkout and verify on success.
   */
  const payForOrder = useCallback(
    async (orderId: string, amount: number) => {
      const rzpRes = await fetch('/api/payments/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, amount }),
      });
      const rzpData = await rzpRes.json();
      if (!rzpRes.ok || !rzpData.success) throw new Error(rzpData.message || 'Failed to initialize payment');

      if (rzpData.data?.bypassed) {
        clearPlanTherapySelection();
        router.push(`/order-success/${orderId}`);
        return;
      }
      // Load it here rather than assuming a <Script> elsewhere in the tree has
      // finished. Nothing on this page rendered one at all, so this check used
      // to fail for every real customer — invisible in tests because the
      // payment-bypass account returns above without reaching this line.
      await ensureRazorpayLoaded();

      const rzp = new window.Razorpay({
        key: rzpData.data.key_id,
        amount: Math.round(amount * 100),
        currency: 'INR',
        name: 'Nervaya',
        description: 'Your personalised sleep plan',
        order_id: rzpData.data.id,
        prefill: { name: user?.name ?? '', email: user?.email ?? '', contact: user?.phone ?? '' },
        theme: { color: 'var(--color-accent)' },
        handler: async (response: { razorpay_payment_id: string; razorpay_signature: string }) => {
          const verifyRes = await fetch('/api/payments/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderId,
              paymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            }),
          });
          const verifyData = await verifyRes.json();
          if (verifyRes.ok && verifyData.success) {
            // Cleared on PAYMENT, not on order creation: an abandoned checkout
            // should still find its therapist and slot waiting on return.
            clearPlanTherapySelection();
            router.push(`/order-success/${orderId}`);
          } else {
            toast.error(verifyData.message || 'Payment verification failed');
            setAdding(null);
          }
        },
        modal: {
          ondismiss: () => {
            toast.info('Payment cancelled — your slot is held for a few more minutes.');
            setAdding(null);
          },
        },
      });
      rzp.open();
    },
    [router, setAdding, user],
  );

  /** Buys the plan as one server-priced order, holding the therapy slot first. */
  const purchasePlan = useCallback(
    async (therapy?: { therapistId: string; date: string; slot: string }) => {
      try {
        const res = await sleepPlanApi.checkout({ services: selectedItems as PlanServiceKey[], therapy });
        if (!res.success || !res.data) throw new Error(res.message || 'Could not start your plan');
        const { order } = res.data;
        await payForOrder(String(order._id), order.totalAmount);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not start your plan');
        setAdding(null);
      }
    },
    [selectedItems, payForOrder, setAdding],
  );

  // Therapy is excluded — it can't be added to cart without therapist/date/slot from the modal.
  const addBundleNonTherapyItems = useCallback(async () => {
    for (const key of selectedItems) {
      if (key === 'SUPPLEMENT' && plan.supplement) {
        await cartApi.add(
          plan.supplement._id,
          1,
          ITEM_TYPE.SUPPLEMENT,
          plan.supplement.name,
          plan.supplement.price,
          plan.supplement.image,
          { source: SLEEP_PLAN_BUNDLE_SOURCE },
        );
      } else if (key === 'GUIDED_AUDIO') {
        await cartApi.add(
          'drift-off-session',
          1,
          ITEM_TYPE.DRIFT_OFF,
          'Deep Rest Session',
          plan.deepRestPrice,
          DRIFT_OFF_SESSION_IMAGE,
          { source: SLEEP_PLAN_BUNDLE_SOURCE },
        );
      }
    }
  }, [selectedItems, plan.supplement, plan.deepRestPrice]);

  // `addBundleAndPickTherapist` used to live here: it parked the supplement and
  // Deep Rest in the cart, then sent the user to Therapy Corner to book and pay
  // for the session separately. That is precisely the two-payment split this
  // flow now avoids, and the cart half was charged without the bundle discount.
  // The plan is one order; there is no partial route.

  const handleStartPlan = useCallback(async () => {
    if (!showBundle) return;
    setAdding('plan');
    if (selectedHasTherapy) {
      // The package is one payment, so the slot has to be chosen and held
      // BEFORE paying — hence the modal here regardless of
      // THERAPIST_RECOMMENDATION_MODAL_ENABLED, which governs the standalone
      // therapy CTAs that deliberately send people to Therapy Corner.
      openTherapistModal();
      return;
    }
    await purchasePlan();
  }, [showBundle, selectedHasTherapy, purchasePlan, setAdding, openTherapistModal]);

  const handleAddPlanToCart = useCallback(async () => {
    if (!showBundle) return;
    // Defensive: the plan card hides this button when therapy is in the bundle,
    // because the cart cannot carry the plan's discount — `createOrder` takes
    // `promoDiscount` as a parameter and never derives it from item metadata, so
    // a therapy plan routed through the cart is charged the UNDISCOUNTED total
    // and paid for in a second transaction. If it is reached anyway, fall back
    // to the single-order route rather than the old split one.
    if (selectedHasTherapy) {
      setAdding('plan');
      openTherapistModal();
      return;
    }
    setAdding('cart');
    try {
      await addBundleNonTherapyItems();
      await refreshCart();
      toast.success('Your sleep plan was added to cart');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add plan to cart');
    } finally {
      setAdding(null);
    }
  }, [showBundle, selectedHasTherapy, addBundleNonTherapyItems, refreshCart, setAdding, openTherapistModal]);

  /**
   * The popup's only outcome: buy the whole plan as ONE order.
   *
   * There used to be a second branch here that added the therapy session to the
   * cart on its own. That is what made the plan cost two payments — the session
   * settled separately from the supplement and Deep Rest — and it also lost the
   * bundle discount, since cart orders are priced per item. The popup is now
   * reachable only from the bundle CTAs, so there is one route out of it.
   */
  const handleTherapyConfirm = useCallback(
    async (selection: TherapistSelection) => {
      closeTherapistModal();
      await purchasePlan({ therapistId: selection.therapistId, date: selection.date, slot: selection.slot });
    },
    [purchasePlan, closeTherapistModal],
  );

  /**
   * Standalone therapy CTAs (highlight card + individual module tile).
   *
   * Always Therapy Corner. The selection popup is now bundle-only — its single
   * action buys the whole plan — so sending a standalone "just therapy" user
   * into it would offer them a plan they did not ask for.
   */
  const startTherapySelection = useCallback(() => {
    router.push(THERAPY_CORNER_PATH);
  }, [router]);

  return {
    bundleItems,
    selectedItems,
    selectedCount,
    toggleItem,
    showBundle,
    showTherapy,
    pricing,
    handleStartPlan,
    handleAddPlanToCart,
    handleTherapyConfirm,
    startTherapySelection,
    selectedHasTherapy,
  };
}
