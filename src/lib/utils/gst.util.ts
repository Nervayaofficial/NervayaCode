/**
 * Backs GST out of tax-inclusive prices.
 *
 * All arithmetic happens in integer paise. Doing it in rupees with floats loses
 * the half-paisa cases: `19.025` is stored as `19.024999999999999`, so a
 * round-half-up on the float rounds DOWN and the printed CGST is a paisa short
 * of what the same figure shows on a Zoho or Tally invoice.
 */

export interface GstSplit {
  /** The fraction applied, e.g. `0.05`. Carried through for display. */
  rate: number;
  /** What the customer pays — tax already inside it. */
  gross: number;
  /** Gross minus tax: the value the tax was computed on. */
  taxableValue: number;
  /** Intra-state halves. Zero on an inter-state supply. */
  cgst: number;
  sgst: number;
  /** The whole tax on an inter-state supply. Zero intra-state. */
  igst: number;
}

function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

function toRupees(paise: number): number {
  return paise / 100;
}

/**
 * Splits a tax-inclusive amount into taxable value + CGST + SGST.
 *
 * The three parts always add back up to `gross` exactly, which is what lets the
 * invoice's tax column reconcile against the amount actually charged. That
 * property is why the tax is derived as `gross - taxable` rather than
 * `taxable * rate` — the latter can leave a paisa unaccounted for.
 *
 * Intra-state, an odd paisa goes to CGST (`ceil` on the half), matching the
 * ₹799 @ 5% case where ₹38.05 of tax splits as 19.03 / 19.02. Inter-state there
 * is nothing to halve: the whole amount is IGST at the full rate. The total tax
 * is identical either way — only its attribution differs, which is what the
 * return depends on.
 */
export function splitInclusiveGst(gross: number, rate: number, interState = false): GstSplit {
  const grossPaise = toPaise(gross);
  const grossRupees = toRupees(grossPaise);

  if (rate <= 0) {
    return { rate, gross: grossRupees, taxableValue: grossRupees, cgst: 0, sgst: 0, igst: 0 };
  }

  const taxablePaise = Math.round(grossPaise / (1 + rate));
  const taxPaise = grossPaise - taxablePaise;

  if (interState) {
    return {
      rate,
      gross: grossRupees,
      taxableValue: toRupees(taxablePaise),
      cgst: 0,
      sgst: 0,
      igst: toRupees(taxPaise),
    };
  }

  const cgstPaise = Math.ceil(taxPaise / 2);

  return {
    rate,
    gross: grossRupees,
    taxableValue: toRupees(taxablePaise),
    cgst: toRupees(cgstPaise),
    sgst: toRupees(taxPaise - cgstPaise),
    igst: 0,
  };
}

/**
 * Spreads a whole-order discount across lines in proportion to their value.
 *
 * The discount has to land on the lines before tax is backed out, because the
 * customer paid less and therefore less tax was collected. Applying it only to
 * the invoice total would leave the tax column overstating what was charged.
 *
 * Works in paise and gives the rounding remainder to the largest line, so the
 * apportioned amounts sum to the discount exactly rather than drifting by a
 * paisa per line.
 */
export function apportionDiscount(lineAmounts: number[], discount: number): number[] {
  const discountPaise = toPaise(discount);
  if (discountPaise <= 0 || lineAmounts.length === 0) return lineAmounts.map(() => 0);

  const amountsPaise = lineAmounts.map(toPaise);
  const totalPaise = amountsPaise.reduce((sum, p) => sum + p, 0);

  // A discount at or above the order value zeroes every line; never return a
  // negative share, which would invent tax out of a credit.
  if (totalPaise <= 0) return lineAmounts.map(() => 0);
  if (discountPaise >= totalPaise) return amountsPaise.map(toRupees);

  const shares = amountsPaise.map((paise) => Math.floor((paise * discountPaise) / totalPaise));
  const remainder = discountPaise - shares.reduce((sum, p) => sum + p, 0);

  if (remainder > 0) {
    let largest = 0;
    for (let i = 1; i < amountsPaise.length; i += 1) {
      if (amountsPaise[i] > amountsPaise[largest]) largest = i;
    }
    shares[largest] += remainder;
  }

  return shares.map(toRupees);
}
