import { ITEM_TYPE } from '@/lib/constants/enums';
import type { Cart, Supplement } from '@/types/supplement.types';
import type { ItemParams } from '@/utils/analytics';

/**
 * Map a cart to GA4 `items`. Every ecommerce event in the funnel needs this —
 * GA4 drops product-level reporting for any event that omits it.
 *
 * `page_type` varies by call site, so it is passed in rather than hardcoded.
 */
export function cartItemsToGaItems(cart: Cart, pageType: string): ItemParams[] {
  return cart.items.map((item) => {
    const isSupplement = item.itemType === ITEM_TYPE.SUPPLEMENT;
    const supplement =
      isSupplement && typeof item.itemId === 'object' && item.itemId !== null && 'name' in item.itemId
        ? (item.itemId as Supplement)
        : null;
    const id = typeof item.itemId === 'object' ? supplement?._id : item.itemId;
    const name = item.name || supplement?.name || String(id);
    return {
      item_id: String(id),
      item_name: name,
      item_category: isSupplement ? 'Supplements' : 'Digital',
      item_type: item.itemType,
      price: item.price,
      quantity: item.quantity,
      currency: 'INR',
      page_type: pageType,
    };
  });
}
