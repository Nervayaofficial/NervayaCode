import { ITEM_TYPE, type ItemType } from '@/lib/constants/enums';

/**
 * GST rates by item type, as fractions.
 *
 * Every rate here is **inclusive**: the price the customer sees and pays already
 * contains the tax, so the invoice works backwards out of the gross rather than
 * adding anything on top. Changing a rate therefore changes how a price is
 * split, never what is charged.
 *
 *  - Supplement  5%  — AYUSH-licensed nutraceutical.
 *  - Deep Rest  18%  — a digital/OIDAR service, taxable at the standard rate.
 *  - Therapy    Nil  — exempt healthcare service by a qualified practitioner.
 *
 * These classifications rest on assumptions an accountant should confirm; they
 * are not derivable from the code. A wrong rate here understates or overstates
 * tax on every invoice issued afterwards, so treat a change as a finance
 * decision rather than a config tweak.
 */
export const GST_RATE_BY_ITEM_TYPE: Record<ItemType, number> = {
  [ITEM_TYPE.SUPPLEMENT]: 0.05,
  [ITEM_TYPE.DRIFT_OFF]: 0.18,
  [ITEM_TYPE.THERAPY]: 0,
};

/**
 * Shipping is charged only on orders containing physical goods (`getShippingCost`
 * is skipped for digital-only carts), and the only physical goods sold are
 * supplements. So delivery is ancillary to a single 5% supply and follows its
 * rate as a composite supply, rather than being taxed at the standard 18%.
 *
 * If anything other than supplements ever ships, this stops being a constant and
 * becomes a per-order calculation of the principal supply.
 */
export const GST_RATE_SHIPPING = GST_RATE_BY_ITEM_TYPE[ITEM_TYPE.SUPPLEMENT];

export function gstRateForItemType(itemType: string): number {
  return GST_RATE_BY_ITEM_TYPE[itemType as ItemType] ?? 0;
}

/** `0.05` -> `5%`, `0` -> `Nil` (the wording a tax invoice uses for exempt). */
export function formatGstRate(rate: number): string {
  if (rate <= 0) return 'Nil';
  const percent = rate * 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}
