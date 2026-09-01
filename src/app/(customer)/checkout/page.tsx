'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import Sidebar from '@/components/Sidebar/LazySidebar';
import PageHeader from '@/components/PageHeader/PageHeader';
import CheckoutForm from '@/components/Checkout/CheckoutForm';
import CartItem from '@/components/Cart/CartItem';
import PaymentHandler from '@/components/Checkout/PaymentHandler';
import { useCheckout } from './useCheckout';
import { CheckoutOrderSummary } from './CheckoutOrderSummary';
import { CheckoutSavedAddresses } from './CheckoutSavedAddresses';
import { AddressCard } from './AddressCard';
import { DeliveryOptions } from './DeliveryOptions';
import { PromoCode } from './PromoCode';
import { Icon } from '@iconify/react';
import { ICON_CHEVRON_LEFT } from '@/constants/icons';
import { DRIFT_OFF_SESSION_IMAGE } from '@/lib/constants/driftOff.constants';
import { GlobalLoader, Modal } from '@/components/common';
import { PhoneCollectionModal } from '@/components/PhoneCollectionModal';
import styles from './styles.module.css';

export default function CheckoutPage() {
  const {
    cart,
    order,
    loading,
    error,
    creatingOrder,
    savedAddresses,
    selectedAddress,
    selectedAddressId,
    isAddressModalOpen,
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
  } = useCheckout();

  if (loading) {
    return (
      <Sidebar>
        <div className={styles.container}>
          <div className={styles.loadingContainer}>
            <GlobalLoader label="Loading checkout..." />
          </div>
        </div>
      </Sidebar>
    );
  }

  if (error && !order) {
    return (
      <Sidebar>
        <div className={styles.container}>
          <div className={styles.error}>{error}</div>
        </div>
      </Sidebar>
    );
  }

  if (razorpayOrderId && order && razorpayKeyId) {
    return (
      <Sidebar>
        <PaymentHandler
          orderId={order._id}
          amount={order.totalAmount}
          razorpayOrderId={razorpayOrderId}
          razorpayKeyId={razorpayKeyId}
        />
      </Sidebar>
    );
  }

  if (!cart) {
    return (
      <Sidebar>
        <div className={styles.container}>
          <div className={styles.error}>Cart not found</div>
        </div>
      </Sidebar>
    );
  }
  return (
    <Sidebar>
      <div className={styles.container}>
        <PageHeader title="Checkout" />
        <Link href="/cart" className={styles.backToCartLink}>
          <Icon icon={ICON_CHEVRON_LEFT} aria-hidden />
          Back to cart
        </Link>
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.content}>
          <div className={styles.formSection}>
            {isDigitalOnly ? (
              <div className={styles.digitalSessionCard}>
                <Image
                  src={DRIFT_OFF_SESSION_IMAGE}
                  alt="Digital Session"
                  width={320}
                  height={320}
                  className={styles.digitalSessionImage}
                />
                <div className={styles.digitalSessionInfo}>
                  <h2 className={styles.digitalSessionTitle}>Digital Sessions & Services</h2>
                  <p className={styles.digitalSessionDesc}>
                    Your order contains digital sessions or services that do not require physical shipping. All
                    necessary details will be provided via email and in your dashboard.
                  </p>
                  <ul className={styles.digitalSessionFeatures}>
                    <li>✦ Personalised experience</li>
                    <li>✦ Instant booking confirmation</li>
                    <li>✦ Guided by certified experts</li>
                    <li>✦ No shipping — access anywhere</li>
                  </ul>
                </div>
              </div>
            ) : (
              <>
                <section className={styles.reviewItems} aria-label="Items in your order">
                  <h2 className={styles.reviewItemsTitle}>Review your order</h2>
                  {cart.items.map((item) => (
                    <CartItem
                      key={`${typeof item.itemId === 'object' ? item.itemId?._id : item.itemId}-${item.itemType}`}
                      item={item}
                      onQuantityChange={handleQuantityChange}
                      onRemove={handleRemoveItem}
                      disabled={updatingItem || creatingOrder}
                    />
                  ))}
                </section>

                <CheckoutSavedAddresses
                  addresses={savedAddresses}
                  selectedId={selectedAddressId}
                  onUseAddress={handleUseAddress}
                  onAddNew={handleAddNewAddress}
                />

                {selectedAddress && (
                  <div className={styles.selectedAddressWrapper}>
                    <AddressCard
                      address={selectedAddress}
                      label="Shipping Address"
                      isDefault={false}
                      onEdit={handleEditAddress}
                    />
                  </div>
                )}

                <DeliveryOptions subtotal={cart.totalAmount} />
              </>
            )}
          </div>

          <Modal
            isOpen={isAddressModalOpen}
            onClose={handleCloseAddressModal}
            title={selectedAddress ? 'Edit Address' : 'Add New Address'}
          >
            <CheckoutForm
              onSubmit={handleAddressSubmit}
              onCancel={handleCloseAddressModal}
              loading={false}
              initialAddress={selectedAddress}
            />
          </Modal>
          <div className={styles.summarySection}>
            <CheckoutOrderSummary
              cart={cart}
              isDigitalOnly={isDigitalOnly}
              promoDiscount={promoDiscount}
              onProceedToPayment={handleProceedToPayment}
              loading={creatingOrder}
              addressSelected={isDigitalOnly || !!selectedAddress}
            />
            <PromoCode
              code={promoCode}
              onCodeChange={setPromoCode}
              onApply={handlePromoCodeApply}
              onRemove={handlePromoCodeRemove}
              appliedCode={appliedPromoCode}
              discount={promoDiscount}
              loading={promoLoading}
              error={promoError}
            />
          </div>
        </div>
      </div>

      <PhoneCollectionModal
        isOpen={phoneGate.isOpen}
        onClose={phoneGate.close}
        onVerified={phoneGate.onVerified}
        // Most shoppers already typed a number into the shipping address, so
        // prefill it — they only have to confirm the code.
        initialPhone={selectedAddress?.phone ?? ''}
        reason="We send order and delivery updates over WhatsApp, so we need a number we can reach you on."
      />
    </Sidebar>
  );
}
