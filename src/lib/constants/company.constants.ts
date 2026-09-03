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
   * Fallback place of supply only.
   *
   * The real value is derived per order from the customer's PIN code
   * (`resolvePlaceOfSupply`), which is what decides CGST+SGST versus IGST. This
   * is used when an order carries no address at all — digital-only purchases —
   * where the law puts the place of supply at the supplier's location anyway.
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
