'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar/LazySidebar';
import { GlobalLoader, StatusState } from '@/components/common';
import { ProductImageGallery, ProductInfo, ProductTabs } from '@/components/Supplements/ProductDetail';
import { Supplement } from '@/types/supplement.types';
import { supplementsApi } from '@/lib/api/supplements';
import { getApiErrorMessage } from '@/lib/utils/apiError.util';
import { useAuth } from '@/hooks/useAuth';
import { useCart } from '@/context/CartContext';
import { ITEM_TYPE } from '@/lib/constants/enums';
import { ROUTES } from '@/utils/routesConstants';
import { trackViewItem, trackAddToCart } from '@/utils/analytics';
import { toast } from 'sonner';
import styles from './styles.module.css';

export default function SupplementDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const [supplement, setSupplement] = useState<Supplement | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { addItem } = useCart();

  const fetchSupplement = useCallback(async () => {
    const id = typeof params.id === 'string' ? params.id : Array.isArray(params.id) ? params.id[0] : '';
    if (!id) {
      setSupplement(null);
      setError('Supplement not found');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await supplementsApi.getById(id);
      if (response.success && response.data) {
        setSupplement(response.data);
        trackViewItem({
          currency: 'INR',
          value: response.data.price,
          items: [
            {
              item_id: response.data._id,
              item_name: response.data.name,
              item_category: 'Supplements',
              item_type: ITEM_TYPE.SUPPLEMENT,
              price: response.data.price,
              quantity: 1,
              currency: 'INR',
              page_type: 'product_detail',
            },
          ],
        });
      } else {
        setSupplement(null);
        setError('Supplement not found');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load supplement');
      setSupplement(null);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    if (params.id) {
      fetchSupplement();
    }
  }, [params.id, fetchSupplement]);

  const handleBuyNow = async () => {
    if (!supplement) return;
    if (!supplement.stock || supplement.stock <= 0) return;
    setBuying(true);
    setError(null);
    try {
      const result = await addItem({
        itemId: supplement._id,
        itemType: ITEM_TYPE.SUPPLEMENT,
        quantity,
        name: supplement.name,
        price: supplement.price,
        image: supplement.images?.length ? supplement.images[0] : supplement.image,
        stock: supplement.stock,
      });
      if (result.success) {
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
              page_type: 'product_detail_buy_now',
            },
          ],
        });
        if (!isAuthenticated) {
          router.push(`${ROUTES.LOGIN}?returnUrl=${encodeURIComponent('/checkout')}`);
        } else {
          router.push('/checkout');
        }
      } else {
        setError(result.message || 'Failed to add to cart');
        setBuying(false);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to add to cart'));
      setBuying(false);
    }
  };

  const handleAddToCart = async () => {
    if (!supplement) return;
    if (!supplement.stock || supplement.stock <= 0) return;
    setAdding(true);
    setError(null);
    try {
      const result = await addItem({
        itemId: supplement._id,
        itemType: ITEM_TYPE.SUPPLEMENT,
        quantity,
        name: supplement.name,
        price: supplement.price,
        image: supplement.images?.length ? supplement.images[0] : supplement.image,
        stock: supplement.stock,
      });
      if (result.success) {
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
              page_type: 'product_detail',
            },
          ],
        });
        toast.info('Added to cart successfully!', {
          style: { background: 'var(--color-accent)', color: 'var(--color-background)', border: 'none' },
        });
        setTimeout(() => {
          router.push('/cart');
        }, 1000);
      } else {
        setError(result.message || 'Failed to add to cart');
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to add to cart'));
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
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

  if (error && !supplement) {
    return (
      <Sidebar>
        <div className={styles.container}>
          <StatusState
            type="error"
            title="Failed to load product"
            message={error}
            action={
              <div className={styles.actions}>
                <button type="button" onClick={fetchSupplement} className={styles.retryButton}>
                  Try again
                </button>
                <Link href="/sleep-supplements" className={styles.backLink}>
                  Back to supplements
                </Link>
              </div>
            }
          />
        </div>
      </Sidebar>
    );
  }

  if (!supplement) {
    return (
      <Sidebar>
        <div className={styles.container}>
          <StatusState
            type="empty"
            title="Product not found"
            message="The product you're looking for doesn't exist or has been removed."
            action={
              <Link href="/sleep-supplements" className={styles.backLink}>
                Back to supplements
              </Link>
            }
          />
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
              error={error}
            />
          </div>
        </div>
        <ProductTabs supplement={supplement} />
      </div>
    </Sidebar>
  );
}
