import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/axios';
import { ITEM_TYPE, type ItemType } from '@/lib/constants/enums';
import { promoApi } from '@/lib/api/promo';
import { cartApi } from '@/lib/api/cart';
import { useCart } from '@/context/CartContext';
import { usePhoneGate } from '@/hooks/usePhoneGate';
import type { ApiResponse } from '@/lib/api/types';
import type { Cart, Order, ShippingAddress, SavedAddress } from '@/types/supplement.types';
import { cartItemsToGaItems } from '@/utils/ga-items.util';
import {
  trackBeginCheckout,
  trackAddPaymentInfo,
  trackCouponApplied,
  trackAddShippingInfo,
  trackPurchaseFailed,
} from '@/utils/analytics';

interface PaymentCreateResponse {
  success: boolean;
  /** `bypassed` is set only for the fixed test customer, whose order is already paid. */
  data?: { id: string; key_id?: string; bypassed?: boolean };
}

interface OrderResponse {
  success: boolean;
  data?: Order;
}

export function useCheckout() {
  const router = useRouter();
  const { refreshCart } = useCart();
  const [cart, setCart] = useState<Cart | null>(null);
  const [updatingItem, setUpdatingItem] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [razorpayOrderId, setRazorpayOrderId] = useState<string | null>(null);
  const [razorpayKeyId, setRazorpayKeyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const phoneGate = usePhoneGate();
  const [error, setError] = useState<string | null>(null);
  const [selectedAddress, setSelectedAddress] = useState<ShippingAddress | undefined>(undefined);
  // Which saved address is chosen. selectedAddress drops `_id` on the way in, so
  // the list has nothing to compare against and could never mark a row selected.
  const [selectedAddressId, setSelectedAddressId] = useState<string | undefined>(undefined);
  const [editingAddress, setEditingAddress] = useState(false);
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [promoCode, setPromoCode] = useState('');
  const [appliedPromoCode, setAppliedPromoCode] = useState<string | null>(null);
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);

  const isDigitalOnly =
    cart?.items.every((item) => item.itemType === ITEM_TYPE.DRIFT_OFF || item.itemType === ITEM_TYPE.THERAPY) ?? false;

  const fetchCart = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = (await api.get('/cart')) as { success: boolean; data: Cart };
      if (response.success && response.data) {
        setCart(response.data);
        if (response.data.items.length === 0) {
          router.push('/cart');
        } else {
          trackBeginCheckout({
            currency: 'INR',
            value: response.data.totalAmount,
            item_count: response.data.items.length,
            // Was hardcoded to 'supplements' regardless of what was in the cart.
            modules_in_cart: [...new Set(response.data.items.map((item) => item.itemType))],
            items: cartItemsToGaItems(response.data, '/checkout'),
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cart');
    } finally {
      setLoading(false);
    }
  }, [router]);

  const fetchSavedAddresses = useCallback(async () => {
    try {
      const response = (await api.get('/users/address')) as { success: boolean; data: SavedAddress[] };
      if (response.success && response.data) {
        setSavedAddresses(response.data);
      }
    } catch {
      // Saved addresses fetch failed silently
    }
  }, []);

  useEffect(() => {
    fetchCart();
    fetchSavedAddresses();
  }, [fetchCart, fetchSavedAddresses]);

  const handleAddressSubmit = useCallback(async (address: ShippingAddress, saveAddress: boolean, label: string) => {
    if (saveAddress) {
      try {
        await api.post('/users/address', { ...address, label, isDefault: false });
      } catch {}
    }
    setSelectedAddress(address);
    // Typed by hand, so it matches no row in the saved list.
    setSelectedAddressId(undefined);
    setIsAddressModalOpen(false);
    setEditingAddress(false);
  }, []);

  const handleAddNewAddress = useCallback(() => {
    setSelectedAddress(undefined);
    setSelectedAddressId(undefined);
    setEditingAddress(true);
    setIsAddressModalOpen(true);
  }, []);

  const handleUseAddress = useCallback((addr: SavedAddress) => {
    const { _id, label: _label, isDefault: _isDefault, ...shippingAddr } = addr;
    setSelectedAddress(shippingAddr as ShippingAddress);
    setSelectedAddressId(_id);
    setEditingAddress(false);
    setIsAddressModalOpen(false);
  }, []);

  const handleEditAddress = useCallback(() => {
    setEditingAddress(true);
    setIsAddressModalOpen(true);
  }, []);

  const handleCloseAddressModal = useCallback(() => {
    setIsAddressModalOpen(false);
  }, []);

  const mapPromoErrorMessage = useCallback((message: string): string => {
    if (message.toLowerCase().includes('expired')) return 'This promo code has expired';
    if (message.toLowerCase().includes('usage limit') || message.toLowerCase().includes('exhausted')) {
      return 'This promo code has reached its usage limit';
    }
    if (message.toLowerCase().includes('minimum purchase') || message.toLowerCase().includes('minimum order')) {
      return 'Minimum order amount not met for this code';
    }
    if (message.toLowerCase().includes('invalid')) return 'Invalid promo code';
    return message;
  }, []);

  const handlePromoCodeApply = useCallback(
    async (code: string) => {
      if (!cart?._id) return;
      setPromoLoading(true);
      setPromoError(null);
      try {
        const result = await promoApi.apply(code, cart._id, cart.totalAmount);
        setAppliedPromoCode(code);
        setPromoDiscount(result.discount ?? 0);
        trackCouponApplied({
          coupon_code: code,
          discount_value: result.discount ?? 0,
          value_before: cart.totalAmount,
          value_after: cart.totalAmount - (result.discount ?? 0),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Invalid or expired promo code';
        setPromoError(mapPromoErrorMessage(msg));
        setAppliedPromoCode(null);
        setPromoDiscount(0);
      } finally {
        setPromoLoading(false);
      }
    },
    [cart?._id, cart?.totalAmount, mapPromoErrorMessage],
  );

  const handlePromoCodeRemove = useCallback(() => {
    setAppliedPromoCode(null);
    setPromoDiscount(0);
    setPromoError(null);
  }, []);

  /**
   * Promo discounts are calculated server-side against the cart total, so editing
   * quantities invalidates whatever was applied. The new total is passed in rather
   * than read from state, which still holds the pre-edit cart at this point.
   */
  const reapplyPromoCode = useCallback(
    async (cartId: string, newTotal: number) => {
      if (!appliedPromoCode) return;
      try {
        const result = await promoApi.apply(appliedPromoCode, cartId, newTotal);
        setPromoDiscount(result.discount ?? 0);
        setPromoError(null);
      } catch (err) {
        // The code no longer qualifies (usually a minimum-order rule). Drop it
        // instead of leaving a discount that no longer reflects the total.
        const msg = err instanceof Error ? err.message : 'Promo code no longer applies';
        setAppliedPromoCode(null);
        setPromoDiscount(0);
        setPromoError(`${mapPromoErrorMessage(msg)} — promo code removed`);
      }
    },
    [appliedPromoCode, mapPromoErrorMessage],
  );

  const applyCartMutation = useCallback(
    async (mutate: () => Promise<ApiResponse<Cart>>) => {
      setUpdatingItem(true);
      setError(null);
      try {
        const response = await mutate();
        if (!response.success || !response.data) {
          setError(response.message || 'Could not update your cart');
          return;
        }

        const updated = response.data;
        setCart(updated);

        // Nothing left to check out; /cart owns the empty state.
        if (updated.items.length === 0) {
          router.push('/cart');
          return;
        }

        await reapplyPromoCode(updated._id, updated.totalAmount);
        // Checkout holds its own copy of the cart, so the navbar badge needs telling.
        await refreshCart();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update your cart');
      } finally {
        setUpdatingItem(false);
      }
    },
    [reapplyPromoCode, refreshCart, router],
  );

  const handleQuantityChange = useCallback(
    (itemId: string, quantity: number, itemType: ItemType) =>
      applyCartMutation(() => cartApi.update(itemId, quantity, itemType)),
    [applyCartMutation],
  );

  const handleRemoveItem = useCallback(
    (itemId: string, itemType: ItemType) => applyCartMutation(() => cartApi.remove(itemId, itemType)),
    [applyCartMutation],
  );

  const handleProceedToPayment = useCallback(async () => {
    if (!cart) return;
    if (!isDigitalOnly && !selectedAddress) {
      setError('Please enter your shipping address');
      return;
    }

    // Order updates go out over WhatsApp, and signup no longer collects a
    // number. Prefill from the shipping address so most users just confirm it.
    // The server enforces this independently with a 428.
    if (!(await phoneGate.ensurePhone())) return;

    setCreatingOrder(true);
    setError(null);
    try {
      if (!isDigitalOnly && selectedAddress) {
        trackAddShippingInfo({
          shipping_country: selectedAddress.country,
          shipping_method: 'standard',
          value: cart.totalAmount - promoDiscount,
          currency: 'INR',
          items: cartItemsToGaItems(cart, '/checkout'),
        });
      }
      trackAddPaymentInfo({
        currency: 'INR',
        value: cart.totalAmount - promoDiscount,
        payment_type: 'Razorpay',
        items: cartItemsToGaItems(cart, '/checkout'),
        ...(appliedPromoCode ? { coupon: appliedPromoCode } : {}),
      });
      const orderPayload = {
        ...(isDigitalOnly ? {} : { shippingAddress: selectedAddress }),
        ...(appliedPromoCode && { promoCode: appliedPromoCode, promoDiscount }),
      };
      const orderResponse = (await api.post('/orders', orderPayload)) as OrderResponse;
      if (!orderResponse.success || !orderResponse.data) {
        setError('Failed to create order');
        return;
      }
      setOrder(orderResponse.data);
      const paymentResponse = (await api.post('/payments/create-order', {
        orderId: orderResponse.data._id,
        amount: orderResponse.data.totalAmount,
      })) as PaymentCreateResponse;
      if (paymentResponse.success && paymentResponse.data?.bypassed) {
        // Test customer: the server already settled the order, so skip Razorpay.
        await refreshCart();
        router.push(`/order-success/${orderResponse.data._id}`);
      } else if (paymentResponse.success && paymentResponse.data) {
        setRazorpayOrderId(paymentResponse.data.id);
        if (paymentResponse.data.key_id) setRazorpayKeyId(paymentResponse.data.key_id);
      } else {
        trackPurchaseFailed({
          error_code: 'PAYMENT_INIT_FAILED',
          payment_method: 'Razorpay',
          value: cart.totalAmount - promoDiscount,
          currency: 'INR',
        });
        setError('Failed to initialize payment');
      }
    } catch (err) {
      trackPurchaseFailed({
        error_code: 'ORDER_CREATION_FAILED',
        payment_method: 'Razorpay',
        value: cart ? cart.totalAmount - promoDiscount : 0,
        currency: 'INR',
      });
      setError(err instanceof Error ? err.message : 'Failed to process order');
    } finally {
      setCreatingOrder(false);
    }
  }, [cart, selectedAddress, appliedPromoCode, promoDiscount, isDigitalOnly, refreshCart, router, phoneGate]);

  return {
    cart,
    order,
    loading,
    error,
    creatingOrder,
    savedAddresses,
    selectedAddress,
    selectedAddressId,
    editingAddress,
    isAddressModalOpen,
    setIsAddressModalOpen,
    handleCloseAddressModal,
    handleAddNewAddress,
    handleAddressSubmit,
    handleUseAddress,
    handleEditAddress,
    promoCode,
    setPromoCode,
    appliedPromoCode,
    promoDiscount,
    promoLoading,
    promoError,
    handlePromoCodeApply,
    handlePromoCodeRemove,
    handleQuantityChange,
    handleRemoveItem,
    updatingItem,
    handleProceedToPayment,
    razorpayOrderId,
    razorpayKeyId,
    isDigitalOnly,
    phoneGate,
  };
}
