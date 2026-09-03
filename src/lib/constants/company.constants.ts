/**
 * Seller details printed on the invoice header.
 *
 * ⚠️ ADDRESS AND PHONE ARE PLACEHOLDERS — replace with the registered details
 * before sending invoices to real customers. An invoice carrying the wrong
 * business address is worse than one carrying none.
 *
 * `gstin` being present is what makes this a **tax invoice** rather than a plain
 * one: it switches on the document title and the per-line GST breakdown in
 * invoice-pdf.ts. Clearing it back to null reverts both, so the tax columns can
 * never appear without the registration number that legitimises them.
 */
export const COMPANY = {
  name: 'Nervaya',
  tagline: 'Sleep and mental wellness',
  addressLines: ['47 Anuragha Township', 'K R Pura, Kadugodi', 'Bengaluru, Karnataka 560067', 'India'],
  email: 'nervayaofficial@gmail.com',
  phone: '+91 82921 97371',
  website: 'nervaya.com',
  /** GST registration. `29` is the Karnataka state code, matching the address. */
  gstin: '29AALCN4069L1ZQ',
  /**
   * Place of supply printed on the invoice, and the reason the tax splits into
   * CGST + SGST rather than IGST.
   *
   * ⚠️ Held constant at the seller's state, which is only correct for customers
   * in Karnataka. An inter-state supply is IGST at the full rate — one line, not
   * a half-and-half pair — and that is NOT implemented: an out-of-state order is
   * currently invoiced as if it were local. The total tax is the same either
   * way, so the customer is charged correctly; it is the return that would be
   * wrong. Fixing it means deriving this from `shippingAddress.state` and
   * emitting an IGST column when it differs.
   */
  stateOfSupply: 'Karnataka (29)',
} as const;

/** Sign-off under the totals, where Zoho puts "Thanks for your business." */
export const INVOICE_THANK_YOU = 'Thank you for doing business with us.';

/** Prices already include everything owed, so the invoice says so explicitly. */
export const INVOICE_NOTE =
  'All prices are inclusive of GST at the rates shown. This is a computer-generated invoice and needs no signature.';

export const INVOICE_TERMS =
  'Thank you for choosing Nervaya. Questions? Reply to this message or email nervayaofficial@gmail.com.';
