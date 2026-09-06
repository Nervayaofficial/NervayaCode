import { OrderItem } from '@/types/supplement.types';

/** Pure formatting/derivation helpers for the order-success page, split out to
 * keep page.tsx under the house 300-line cap. */

export function getSubtotal(items: OrderItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function formatOrderDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatOrderNumber(orderId: string): string {
  const year = new Date().getFullYear();
  const short = orderId.replace(/-/g, '').slice(-8).toUpperCase();
  return `NS-${year}-${short}`;
}
