import { COMPANY } from '@/lib/constants/company.constants';
import { formatGstRate } from '@/lib/constants/tax.constants';
import type { GstSplit } from '@/lib/utils/gst.util';
import {
  bold,
  CONTENT_WIDTH,
  FONT,
  INK,
  MUTED,
  money,
  PAGE_MARGIN,
  PAGE_WIDTH,
  RULE,
  TABLE_HEAD_BG,
  TOTAL_BG,
  ACCENT,
  type Doc,
} from './invoice-theme';

export interface InvoiceLine {
  name: string;
  /** Shown under the name — item type, or the session date for therapy. */
  description?: string;
  quantity: number;
  unitPrice: number;
  /** GST backed out of the amount actually paid for this line. */
  tax: GstSplit;
}

interface Column {
  key: 'item' | 'qty' | 'rate' | 'taxable' | 'gst' | 'cgst' | 'sgst' | 'amount';
  /** Two lines where a single word won't fit the width. */
  label: string;
  x: number;
  width: number;
  align?: 'right';
}

/**
 * Two layouts, chosen by whether a GSTIN exists.
 *
 * Without a registration number the tax columns must not appear at all — a
 * document showing CGST/SGST while claiming no GSTIN is not a valid tax invoice.
 * So the plain layout is the original four columns, and the tax layout squeezes
 * four more in by narrowing the item column. Both are right-aligned to the same
 * page edge so the totals block below lines up either way.
 */
const PLAIN_COLUMNS: Column[] = [
  { key: 'item', label: 'ITEM & DESCRIPTION', x: PAGE_MARGIN + 10, width: 285 },
  { key: 'qty', label: 'QTY', x: PAGE_MARGIN + 300, width: 34, align: 'right' },
  { key: 'rate', label: 'RATE', x: PAGE_MARGIN + 340, width: 66, align: 'right' },
  { key: 'amount', label: 'AMOUNT', x: PAGE_MARGIN + 410, width: 79, align: 'right' },
];

const TAX_COLUMNS: Column[] = [
  { key: 'item', label: 'ITEM & DESCRIPTION', x: PAGE_MARGIN + 8, width: 138 },
  { key: 'qty', label: 'QTY', x: PAGE_MARGIN + 148, width: 20, align: 'right' },
  { key: 'rate', label: 'RATE\n(INCL.)', x: PAGE_MARGIN + 170, width: 54, align: 'right' },
  { key: 'taxable', label: 'TAXABLE\nVALUE', x: PAGE_MARGIN + 226, width: 56, align: 'right' },
  { key: 'gst', label: 'GST', x: PAGE_MARGIN + 284, width: 28, align: 'right' },
  { key: 'cgst', label: 'CGST', x: PAGE_MARGIN + 314, width: 48, align: 'right' },
  { key: 'sgst', label: 'SGST', x: PAGE_MARGIN + 364, width: 48, align: 'right' },
  { key: 'amount', label: 'TOTAL', x: PAGE_MARGIN + 414, width: 75, align: 'right' },
];

export function isTaxInvoice(): boolean {
  return Boolean(COMPANY.gstin);
}

export function invoiceColumns(): Column[] {
  return isTaxInvoice() ? TAX_COLUMNS : PLAIN_COLUMNS;
}

const HEAD_HEIGHT = 28;

export function drawTableHeader(doc: Doc, top: number): number {
  const columns = invoiceColumns();
  doc.rect(PAGE_MARGIN, top, CONTENT_WIDTH, HEAD_HEIGHT).fill(TABLE_HEAD_BG);
  doc.font(FONT).fontSize(6.5).fillColor(MUTED);

  const y = top + 7;
  for (const column of columns) {
    doc.text(column.label, column.x, y, {
      width: column.width,
      align: column.align,
      characterSpacing: 0.5,
      lineGap: 1,
    });
  }
  return top + HEAD_HEIGHT;
}

function cellValue(column: Column, line: InvoiceLine): string {
  switch (column.key) {
    case 'qty':
      return String(line.quantity);
    case 'rate':
      return money(line.unitPrice);
    case 'taxable':
      return money(line.tax.taxableValue);
    case 'gst':
      return formatGstRate(line.tax.rate);
    case 'cgst':
      return money(line.tax.cgst);
    case 'sgst':
      return money(line.tax.sgst);
    case 'amount':
      // The gross the tax was split out of, which is what the customer paid for
      // this line — not `unitPrice * quantity`, because a whole-order promo has
      // already been apportioned into it.
      return money(line.tax.gross);
    default:
      return '';
  }
}

export function drawLine(doc: Doc, line: InvoiceLine, top: number): number {
  const columns = invoiceColumns();
  const itemColumn = columns[0];
  const size = isTaxInvoice() ? 8 : 9.5;
  const y = top + 9;

  doc.font(FONT).fontSize(size).fillColor(INK);
  doc.text(line.name, itemColumn.x, y, { width: itemColumn.width });
  let bottom = doc.y;

  if (line.description) {
    doc
      .fontSize(size - 1.5)
      .fillColor(MUTED)
      .text(line.description, itemColumn.x, bottom + 1, { width: itemColumn.width });
    bottom = doc.y;
  }

  doc.fontSize(size).fillColor(INK);
  for (const column of columns.slice(1)) {
    doc.text(cellValue(column, line), column.x, y, { width: column.width, align: column.align });
  }

  const rowBottom = Math.max(bottom, y + 12) + 9;
  doc
    .moveTo(PAGE_MARGIN, rowBottom)
    .lineTo(PAGE_WIDTH - PAGE_MARGIN, rowBottom)
    .strokeColor(RULE)
    .lineWidth(0.5)
    .stroke();
  return rowBottom;
}

export interface TotalsData {
  lines: InvoiceLine[];
  promoCode?: string;
  promoDiscount?: number;
  extras?: number;
  extrasTax?: GstSplit;
  total: number;
  paymentReference?: string;
}

/**
 * Sums the tax across item lines plus the shipping row.
 *
 * Taxable value + CGST + SGST reconciles to the grand total exactly, because
 * every row's parts were derived as `gross - taxable` rather than
 * `taxable * rate`, and the promo was apportioned into the lines before the
 * split. If these three ever stop adding up to `total`, the cause is a gross
 * amount that never reached the tax calculation — not a rounding drift.
 */
function taxTotals(data: TotalsData): { taxable: number; cgst: number; sgst: number } {
  const rows: GstSplit[] = [...data.lines.map((line) => line.tax)];
  if (data.extrasTax) rows.push(data.extrasTax);

  const sum = (pick: (row: GstSplit) => number): number =>
    Math.round(rows.reduce((total, row) => total + pick(row), 0) * 100) / 100;

  return { taxable: sum((r) => r.taxableValue), cgst: sum((r) => r.cgst), sgst: sum((r) => r.sgst) };
}

export function drawTotals(doc: Doc, data: TotalsData, top: number): number {
  const grossSubtotal = data.lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const rows: [string, string][] = [['Subtotal', money(grossSubtotal)]];

  if (data.promoDiscount && data.promoDiscount > 0) {
    rows.push([data.promoCode ? `Discount (${data.promoCode})` : 'Discount', `−${money(data.promoDiscount)}`]);

    // Names the figure the TOTAL column actually adds up to. A whole-order promo
    // is apportioned into the lines before tax is backed out, so each line shows
    // its share already deducted — without this row the item column visibly
    // fails to sum to Subtotal and the invoice looks wrong.
    const netOfDiscount = Math.round(data.lines.reduce((sum, line) => sum + line.tax.gross, 0) * 100) / 100;
    rows.push(['Amount after discount', money(netOfDiscount)]);
  }
  if (data.extras && data.extras !== 0) {
    rows.push(['Shipping & handling', money(data.extras)]);
  }

  if (isTaxInvoice()) {
    const { taxable, cgst, sgst } = taxTotals(data);
    rows.push(['Taxable value', money(taxable)], ['CGST', money(cgst)], ['SGST', money(sgst)]);
  }

  const boxX = PAGE_MARGIN + CONTENT_WIDTH / 2;
  const boxW = CONTENT_WIDTH / 2;
  let y = top + 12;

  doc.font(FONT).fontSize(9.5);
  for (const [label, value] of rows) {
    doc.fillColor(MUTED).text(label, boxX, y, { width: boxW - 100 });
    doc.fillColor(INK).text(value, boxX + boxW - 100, y, { width: 100, align: 'right' });
    y += 17;
  }

  // Grand total sits in a tinted band, the way Zoho emphasises the balance.
  doc.rect(boxX, y + 2, boxW, 30).fill(TOTAL_BG);
  doc.fontSize(11).fillColor(INK);
  bold(doc, 'Total', boxX + 12, y + 12);
  doc.fontSize(13).fillColor(ACCENT);
  bold(doc, money(data.total), boxX + boxW - 112, y + 10, { width: 100, align: 'right' });
  y += 40;

  if (data.paymentReference) {
    doc.fontSize(8).fillColor(MUTED).text(`Payment reference: ${data.paymentReference}`, boxX, y, {
      width: boxW,
      align: 'right',
    });
    y = doc.y;
  }
  return y + 8;
}
