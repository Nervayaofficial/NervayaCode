'use client';

import { useEffect, useRef, useState, type FocusEvent } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { Icon } from '@iconify/react';
import { ICON_CART, ICON_ARROW_RIGHT, ICON_LOADING } from '@/constants/icons';
import { useCart } from '@/context/CartContext';
import { ROUTES, supplementDetailHref } from '@/utils/routesConstants';
import { Badge } from '@/components/common';
import { ITEM_TYPE } from '@/lib/constants/enums';
import type { CartItem, Supplement } from '@/types/supplement.types';
import { formatPrice } from '@/utils/cart.util';
import styles from './styles.module.css';

interface NavbarCartPreviewProps {
  visible: boolean;
  onNavigate: () => void;
}

function getSupplementFromCartItem(item: CartItem): Supplement | null {
  if (item.itemType !== ITEM_TYPE.SUPPLEMENT) {
    return null;
  }

  if (typeof item.itemId === 'object' && item.itemId && '_id' in item.itemId) {
    return item.itemId as Supplement;
  }

  return null;
}

function getCartItemName(item: CartItem): string {
  const supplement = getSupplementFromCartItem(item);
  return item.name || supplement?.name || 'Deep Rest Session';
}

function getCartItemImage(item: CartItem): string {
  const supplement = getSupplementFromCartItem(item);

  return (
    item.image ||
    supplement?.image ||
    (item.itemType === ITEM_TYPE.SUPPLEMENT ? '/default-supplement.png' : '/drift-off-session.png')
  );
}

function getCartItemHref(item: CartItem): string {
  const supplement = getSupplementFromCartItem(item);
  const idStr = supplement?._id || (typeof item.itemId === 'string' ? item.itemId : undefined);
  return item.itemType === ITEM_TYPE.SUPPLEMENT && idStr ? supplementDetailHref(idStr) : ROUTES.DEEP_REST;
}

function getCartItemKey(item: CartItem, index: number): string {
  const supplement = getSupplementFromCartItem(item);
  const rawId = typeof item.itemId === 'string' ? item.itemId : supplement?._id || `item-${index}`;

  return `${item.itemType}-${rawId}`;
}

export function NavbarCartPreview({ visible, onNavigate }: NavbarCartPreviewProps) {
  const { cartCount, cart, cartLoading, refreshCart } = useCart();
  const router = useRouter();
  const pathname = usePathname();
  const [isCartPreviewOpen, setIsCartPreviewOpen] = useState(false);
  const cartCloseTimeoutRef = useRef<number | null>(null);

  const cartLinkHref = ROUTES.CART;
  const cartPreviewItems = cart?.items.slice(0, 3) ?? [];
  const remainingCartItems = Math.max(0, (cart?.items.length ?? 0) - cartPreviewItems.length);

  const clearCartCloseTimeout = () => {
    if (cartCloseTimeoutRef.current !== null) {
      window.clearTimeout(cartCloseTimeoutRef.current);
      cartCloseTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearCartCloseTimeout();
    };
  }, []);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      clearCartCloseTimeout();
      setIsCartPreviewOpen(false);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [pathname]);

  if (!visible) {
    return null;
  }

  const openCartPreview = () => {
    clearCartCloseTimeout();
    setIsCartPreviewOpen(true);
    void refreshCart();
  };

  const closeCartPreview = () => {
    clearCartCloseTimeout();
    setIsCartPreviewOpen(false);
  };

  const scheduleCartPreviewClose = () => {
    clearCartCloseTimeout();
    cartCloseTimeoutRef.current = window.setTimeout(() => {
      setIsCartPreviewOpen(false);
      cartCloseTimeoutRef.current = null;
    }, 140);
  };

  const handleCartBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      closeCartPreview();
    }
  };

  const handleCartTriggerClick = () => {
    closeCartPreview();
    onNavigate();
    router.push(cartLinkHref);
  };

  const handlePreviewLinkClick = () => {
    closeCartPreview();
    onNavigate();
  };

  return (
    <div
      className={styles.cartPreviewWrapper}
      onMouseEnter={openCartPreview}
      onMouseLeave={scheduleCartPreviewClose}
      onFocus={openCartPreview}
      onBlur={handleCartBlur}
    >
      <button
        type="button"
        className={`${styles.cartTrigger} ${isCartPreviewOpen ? styles.cartTriggerOpen : ''}`}
        onClick={handleCartTriggerClick}
        aria-haspopup="dialog"
        aria-expanded={isCartPreviewOpen}
        aria-label={`Open cart with ${cartCount} items`}
      >
        <span className={styles.cartTriggerIconWrap}>
          <Icon icon={ICON_CART} width={22} height={22} />
          {cartCount > 0 && (
            <Badge variant="purple" size="xs" className={styles.cartBadge}>
              {cartCount}
            </Badge>
          )}
        </span>
        <span className={styles.cartTriggerText}>Cart</span>
      </button>

      <div
        className={`${styles.cartPreviewPanel} ${isCartPreviewOpen ? styles.cartPreviewPanelOpen : ''}`}
        role="dialog"
        aria-hidden={!isCartPreviewOpen}
        aria-label="Cart preview"
      >
        <div className={styles.cartPreviewHeader}>
          <div>
            <p className={styles.cartPreviewEyebrow}>Cart Preview</p>
          </div>
          {cartCount > 0 && <Badge size="sm">{cartCount} items</Badge>}
        </div>

        {cartLoading && !cart ? (
          <div className={styles.cartPreviewState}>
            <Icon icon={ICON_LOADING} width={28} height={28} className={styles.cartPreviewLoader} />
            <p className={styles.cartPreviewMessage}>Pulling your latest cart in...</p>
          </div>
        ) : cartPreviewItems.length === 0 ? (
          <div className={styles.cartPreviewState}>
            <div className={styles.cartPreviewEmptyIcon}>
              <Icon icon={ICON_CART} width={26} height={26} />
            </div>
            <p className={styles.cartPreviewMessage}>
              Your cart is empty. Browse our Deep Rest audio sessions, supplements, or book a therapist to get started.
            </p>
            <div className={styles.cartPreviewActionsRow}>
              <Link href={ROUTES.DEEP_REST} className={styles.cartPreviewPrimary} onClick={handlePreviewLinkClick}>
                Get Deep Rest Audio
              </Link>
              <Link href={ROUTES.SUPPLEMENTS} className={styles.cartPreviewSecondary} onClick={handlePreviewLinkClick}>
                Buy Supplements
              </Link>
              <Link href="/therapy-corner" className={styles.cartPreviewSecondary} onClick={handlePreviewLinkClick}>
                Book Therapist
              </Link>
            </div>
          </div>
        ) : (
          <>
            <ul className={styles.cartPreviewList}>
              {cartPreviewItems.map((item, index) => (
                <li key={getCartItemKey(item, index)} className={styles.cartPreviewItem}>
                  <Link
                    href={getCartItemHref(item)}
                    className={styles.cartPreviewItemLink}
                    onClick={handlePreviewLinkClick}
                  >
                    <div className={styles.cartPreviewThumbWrap}>
                      <Image
                        src={getCartItemImage(item)}
                        alt={getCartItemName(item)}
                        width={64}
                        height={64}
                        className={styles.cartPreviewThumb}
                      />
                    </div>
                    <div className={styles.cartPreviewItemInfo}>
                      <span className={styles.cartPreviewItemName}>{getCartItemName(item)}</span>
                      <span className={styles.cartPreviewItemMeta}>
                        Qty {item.quantity} ·{' '}
                        {item.itemType === ITEM_TYPE.SUPPLEMENT
                          ? 'Supplement'
                          : item.itemType === ITEM_TYPE.THERAPY
                            ? 'Therapist'
                            : 'Deep Rest'}
                      </span>
                    </div>
                    <span className={styles.cartPreviewItemPrice}>{formatPrice(item.price * item.quantity)}</span>
                  </Link>
                </li>
              ))}
            </ul>

            {remainingCartItems > 0 && (
              <p className={styles.cartPreviewMore}>
                + {remainingCartItems} more item{remainingCartItems > 1 ? 's' : ''} waiting in your cart
              </p>
            )}

            <div className={styles.cartPreviewFooter}>
              <div className={styles.cartPreviewSubtotal}>
                <span>Total</span>
                <strong>{formatPrice(cart?.totalAmount ?? 0)}</strong>
              </div>
              <div className={styles.cartPreviewActions}>
                <Link href={ROUTES.CART} className={styles.cartPreviewSecondary} onClick={handlePreviewLinkClick}>
                  View cart
                </Link>
                <Link href={ROUTES.CHECKOUT} className={styles.cartPreviewPrimary} onClick={handlePreviewLinkClick}>
                  Checkout
                  <Icon icon={ICON_ARROW_RIGHT} width={16} height={16} />
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default NavbarCartPreview;
