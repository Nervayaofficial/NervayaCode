'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar/LazySidebar';
import { GlobalLoader, StatusState } from '@/components/common';
import { ProductImageGallery, ProductInfo, ProductTabs } from '@/components/Supplements/ProductDetail';
import { useSupplementDetail } from '@/queries/supplements/useSupplementDetail';
import { getApiErrorMessage } from '@/lib/utils/apiError.util';
import { useAuth } from '@/hooks/useAuth';
import { useCart } from '@/context/CartContext';
import { ITEM_TYPE } from '@/lib/constants/enums';
import { ROUTES } from '@/utils/routesConstants';
import { trackAddToCart } from '@/utils/analytics';
import { toast } from 'sonner';
import styles from './detail.module.css';

interface SupplementDetailClientProps {
  supplementId: string;
}

/**
 * Product detail view for a single supplement.
 *
 * Mounted from two routes: `/sleep-supplements` renders it directly while the
 * catalog holds exactly one product (so the customer never sees an id in the
 * URL), and `/sleep-supplements/[id]` renders it once there are several.
 */
export default function SupplementDetailClient({ supplementId }: SupplementDetailClientProps) {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const { addItem } = useCart();
  const { supplement, isLoading, error: loadError, refetch } = useSupplementDetail(supplementId);
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);
  const [buying, setBuying] = useState(false);
  const [cartError, setCartError] = useState<string | null>(null);

  /** Shared by Add to Cart and Buy Now — identical payload, different follow-up. */
  const addSupplementToCart = async (pageType: string) => {
    if (!supplement) return false;
    const result = await addItem({
      itemId: supplement._id,
      itemType: ITEM_TYPE.SUPPLEMENT,
      quantity,
      name: supplement.name,
      price: supplement.price,
      image: supplement.images?.length ? supplement.images[0] : supplement.image,
      stock: supplement.stock,
    });
    if (!result.success) {
      setCartError(result.message || 'Failed to add to cart');
      return false;
    }
    trackAddToCart({
      currency: 'INR',
      value: supplement.price * quantity,
      items: [
        {
          item_id: supplement._id,
          item_name: supplement.name,
          item_category: 'Supplements',
          item_type: ITEM_TYPE.SUPPLEMENT,
          price: supplement.price,
          quantity,
          currency: 'INR',
          page_type: pageType,
        },
      ],
    });
    return true;
  };

  const handleBuyNow = async () => {
    if (!supplement?.stock || supplement.stock <= 0) return;
    setBuying(true);
    setCartError(null);
    try {
      if (await addSupplementToCart('product_detail_buy_now')) {
        const destination = isAuthenticated
          ? ROUTES.CHECKOUT
          : `${ROUTES.LOGIN}?returnUrl=${encodeURIComponent(ROUTES.CHECKOUT)}`;
        router.push(destination);
        return;
      }
    } catch (err) {
      setCartError(getApiErrorMessage(err, 'Failed to add to cart'));
    }
    setBuying(false);
  };

  const handleAddToCart = async () => {
    if (!supplement?.stock || supplement.stock <= 0) return;
    setAdding(true);
    setCartError(null);
    try {
      if (await addSupplementToCart('product_detail')) {
        toast.info('Added to cart successfully!', {
          style: { background: 'var(--color-accent)', color: 'var(--color-background)', border: 'none' },
        });
        setTimeout(() => {
          router.push(ROUTES.CART);
        }, 1000);
      }
    } catch (err) {
      setCartError(getApiErrorMessage(err, 'Failed to add to cart'));
    } finally {
      setAdding(false);
    }
  };

  if (isLoading) {
    return (
      <Sidebar>
        <div className={styles.container}>
          <div className={styles.loading}>
            <GlobalLoader label="Loading supplement details..." />
          </div>
        </div>
      </Sidebar>
    );
  }

  if (!supplement) {
    return (
      <Sidebar>
        <div className={styles.container}>
          {loadError ? (
            <StatusState
              type="error"
              title="Failed to load product"
              message={loadError}
              action={
                <div className={styles.actions}>
                  <button type="button" onClick={refetch} className={styles.retryButton}>
                    Try again
                  </button>
                  <Link href={ROUTES.SUPPLEMENTS} className={styles.backLink}>
                    Back to supplements
                  </Link>
                </div>
              }
            />
          ) : (
            <StatusState
              type="empty"
              title="Product not found"
              message="The product you're looking for doesn't exist or has been removed."
              action={
                <Link href={ROUTES.SUPPLEMENTS} className={styles.backLink}>
                  Back to supplements
                </Link>
              }
            />
          )}
        </div>
      </Sidebar>
    );
  }

  const isOutOfStock = !supplement.stock || supplement.stock <= 0;
  const maxQuantity = Math.max(1, Math.min(supplement.stock || 0, 10));
  const discountPercent =
    supplement.originalPrice && supplement.originalPrice > supplement.price
      ? Math.round(((supplement.originalPrice - supplement.price) / supplement.originalPrice) * 100)
      : undefined;
  const mainImage = supplement.images?.length ? supplement.images[0] : supplement.image;

  return (
    <Sidebar>
      <div className={styles.container}>
        <div className={styles.content}>
          <div className={styles.imageSection}>
            <ProductImageGallery
              mainImage={mainImage || supplement.image}
              images={supplement.images}
              discountPercent={discountPercent}
              alt={supplement.name}
            />
          </div>
          <div className={styles.detailsSection}>
            <ProductInfo
              supplement={supplement}
              quantity={quantity}
              onQuantityChange={setQuantity}
              onAddToCart={handleAddToCart}
              onBuyNow={handleBuyNow}
              adding={adding}
              buying={buying}
              isOutOfStock={isOutOfStock}
              maxQuantity={maxQuantity}
              error={cartError}
            />
          </div>
        </div>
        <ProductTabs supplement={supplement} />
      </div>
    </Sidebar>
  );
}
