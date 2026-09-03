import PDFDocument from 'pdfkit';
import path from 'path';

/**
 * Page geometry, palette and the low-level text helpers shared by every part of
 * the invoice.
 *
 * Font note: the PDF standard fonts (Helvetica et al.) use WinAnsi encoding,
 * which has NO glyph for the rupee sign — `widthOfString('₹')` returns 0 and the
 * character silently renders as nothing. So the invoice embeds Geist, which does
 * carry U+20B9. pdfkit has no synthetic bold and only the regular weight is
 * vendored, so emphasis is done with size, colour and fills, plus a faux-bold
 * double-draw for the few headings that need real weight.
 */
export const FONT_PATH = path.join(process.cwd(), 'src/lib/pdf/fonts/Geist-Regular.ttf');
export const FONT = 'Geist';

export const PAGE_MARGIN = 48;
export const PAGE_WIDTH = 595.28; // A4 portrait, points
export const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

export const INK = '#0f172a';
export const MUTED = '#64748b';
export const RULE = '#e2e8f0';
export const ACCENT = '#4f31d9';
export const TABLE_HEAD_BG = '#f1f0fb';
export const TOTAL_BG = '#f8f7ff';

export type Doc = InstanceType<typeof PDFDocument>;

/** `₹1,887.00` — grouped in the Indian digit system. */
export function money(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Faux bold: only the regular weight is vendored, so overdraw the glyphs with a
 * hairline stroke of the same colour to thicken the stems.
 */
export function bold(doc: Doc, text: string, x: number, y: number, options: PDFKit.Mixins.TextOptions = {}): void {
  doc.text(text, x, y, options);
  const afterY = doc.y;
  // Second pass nudged right thickens the stems; too large a delta reads as a
  // shadow rather than weight.
  doc.text(text, x + 0.4, y, options);
  doc.y = afterY;
}
