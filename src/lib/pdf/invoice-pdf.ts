import path from 'path';
import PDFDocument from 'pdfkit';
import { COMPANY, INVOICE_NOTE, INVOICE_TERMS, INVOICE_THANK_YOU } from '@/lib/constants/company.constants';

/**
 * Zoho-Invoice-style PDF built with pdfkit.
 *
 * Font note: the PDF standard fonts (Helvetica et al.) use WinAnsi encoding,
 * which has NO glyph for the rupee sign — `widthOfString('₹')` returns 0 and the
 * character silently renders as nothing. So the invoice embeds Geist, which does
 * carry U+20B9. pdfkit has no synthetic bold and only the regular weight is
 * vendored, so emphasis is done with size, colour and fills, plus a faux-bold
 * double-draw for the few headings that need real weight.
 */
const FONT_PATH = path.join(process.cwd(), 'src/lib/pdf/fonts/Geist-Regular.ttf');
const FONT = 'Geist';

const PAGE_MARGIN = 48;
const PAGE_WIDTH = 595.28; // A4 portrait, points
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

const INK = '#0f172a';
const MUTED = '#64748b';
const RULE = '#e2e8f0';
const ACCENT = '#4f31d9';
const TABLE_HEAD_BG = '#f1f0fb';
const TOTAL_BG = '#f8f7ff';

export interface InvoiceLine {
  name: string;
  /** Shown under the name — item type, or the session date for therapy. */
  description?: string;
  quantity: number;
  unitPrice: number;
}

export interface InvoiceData {
  invoiceNumber: string;
  orderNumber: string;
  issuedAt: Date;
  paymentStatus: string;
  paymentReference?: string;
  customer: {
    name: string;
    phone?: string;
    email?: string;
    addressLines?: string[];
  };
  lines: InvoiceLine[];
  promoCode?: string;
  promoDiscount?: number;
  /** Shipping/handling, or anything the line items don't account for. */
  extras?: number;
  total: number;
}

/** `₹1,887.00` — grouped in the Indian digit system. */
function money(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

type Doc = InstanceType<typeof PDFDocument>;

/**
 * Faux bold: only the regular weight is vendored, so overdraw the glyphs with a
 * hairline stroke of the same colour to thicken the stems.
 */
function bold(doc: Doc, text: string, x: number, y: number, options: PDFKit.Mixins.TextOptions = {}): void {
  doc.text(text, x, y, options);
  const afterY = doc.y;
  // Second pass nudged right thickens the stems; too large a delta reads as a
  // shadow rather than weight.
  doc.text(text, x + 0.4, y, options);
  doc.y = afterY;
}

function drawHeader(doc: Doc, data: InvoiceData): number {
  doc.font(FONT).fontSize(22).fillColor(ACCENT);
  bold(doc, COMPANY.name, PAGE_MARGIN, PAGE_MARGIN);

  doc.fontSize(8.5).fillColor(MUTED);
  doc.text(COMPANY.tagline, PAGE_MARGIN, doc.y + 2);
  doc.text(COMPANY.addressLines.join('\n'), PAGE_MARGIN, doc.y + 6, { lineGap: 1.5 });
  doc.text(`${COMPANY.phone}  ·  ${COMPANY.email}  ·  ${COMPANY.website}`, PAGE_MARGIN, doc.y + 4);
  // Capture the left column's bottom NOW: every doc.text(x, y) below reassigns
  // doc.y, so reading it after the meta block would measure the wrong column and
  // let the divider cut through this address.
  const leftBottom = doc.y;

  // "INVOICE" + meta, right-aligned against the logo block.
  const rightX = PAGE_WIDTH / 2;
  const rightW = CONTENT_WIDTH / 2;
  doc.fontSize(24).fillColor(INK);
  bold(doc, 'INVOICE', rightX, PAGE_MARGIN + 2, { width: rightW, align: 'right' });

  doc.fontSize(9).fillColor(MUTED);
  const metaRows: [string, string][] = [
    ['Invoice No.', data.invoiceNumber],
    ['Order No.', data.orderNumber],
    ['Date', formatDate(data.issuedAt)],
    ['Status', data.paymentStatus.toUpperCase()],
  ];
  let metaY = PAGE_MARGIN + 36;
  for (const [label, value] of metaRows) {
    doc.fillColor(MUTED).text(label, rightX, metaY, { width: rightW - 110, align: 'right' });
    doc.fillColor(INK).text(value, rightX + rightW - 105, metaY, { width: 105, align: 'right' });
    metaY += 14;
  }

  return Math.max(leftBottom, metaY) + 14;
}

function drawBillTo(doc: Doc, data: InvoiceData, top: number): number {
  doc
    .moveTo(PAGE_MARGIN, top)
    .lineTo(PAGE_WIDTH - PAGE_MARGIN, top)
    .strokeColor(RULE)
    .lineWidth(1)
    .stroke();

  const y = top + 16;
  doc.font(FONT).fontSize(8).fillColor(MUTED).text('BILL TO', PAGE_MARGIN, y, { characterSpacing: 1 });

  doc.fontSize(11).fillColor(INK);
  bold(doc, data.customer.name, PAGE_MARGIN, y + 14);

  doc.fontSize(9).fillColor(MUTED);
  const contact = [data.customer.phone, data.customer.email].filter(Boolean).join('  ·  ');
  let cursor = y + 30;
  if (contact) {
    doc.text(contact, PAGE_MARGIN, cursor);
    cursor = doc.y;
  }
  if (data.customer.addressLines?.length) {
    doc.text(data.customer.addressLines.join('\n'), PAGE_MARGIN, cursor + 2, {
      width: CONTENT_WIDTH * 0.55,
      lineGap: 1.5,
    });
    cursor = doc.y;
  }
  return cursor + 20;
}

// Column geometry, shared by the header and every row.
const COL = {
  item: PAGE_MARGIN + 10,
  qty: PAGE_MARGIN + 300,
  rate: PAGE_MARGIN + 340,
  amount: PAGE_MARGIN + 410,
};
const COL_W = { item: 285, qty: 34, rate: 66, amount: 79 };

function drawTableHeader(doc: Doc, top: number): number {
  doc.rect(PAGE_MARGIN, top, CONTENT_WIDTH, 24).fill(TABLE_HEAD_BG);
  doc.font(FONT).fontSize(8).fillColor(MUTED);
  const y = top + 8;
  doc.text('ITEM & DESCRIPTION', COL.item, y, { width: COL_W.item, characterSpacing: 0.6 });
  doc.text('QTY', COL.qty, y, { width: COL_W.qty, align: 'right', characterSpacing: 0.6 });
  doc.text('RATE', COL.rate, y, { width: COL_W.rate, align: 'right', characterSpacing: 0.6 });
  doc.text('AMOUNT', COL.amount, y, { width: COL_W.amount, align: 'right', characterSpacing: 0.6 });
  return top + 24;
}

function drawLine(doc: Doc, line: InvoiceLine, top: number): number {
  const y = top + 10;
  doc.font(FONT).fontSize(9.5).fillColor(INK);
  doc.text(line.name, COL.item, y, { width: COL_W.item });
  let bottom = doc.y;

  if (line.description) {
    doc
      .fontSize(8)
      .fillColor(MUTED)
      .text(line.description, COL.item, bottom + 1, { width: COL_W.item });
    bottom = doc.y;
  }

  doc.fontSize(9.5).fillColor(INK);
  doc.text(String(line.quantity), COL.qty, y, { width: COL_W.qty, align: 'right' });
  doc.text(money(line.unitPrice), COL.rate, y, { width: COL_W.rate, align: 'right' });
  doc.text(money(line.unitPrice * line.quantity), COL.amount, y, { width: COL_W.amount, align: 'right' });

  const rowBottom = Math.max(bottom, y + 12) + 10;
  doc
    .moveTo(PAGE_MARGIN, rowBottom)
    .lineTo(PAGE_WIDTH - PAGE_MARGIN, rowBottom)
    .strokeColor(RULE)
    .lineWidth(0.5)
    .stroke();
  return rowBottom;
}

function drawTotals(doc: Doc, data: InvoiceData, top: number): number {
  const subtotal = data.lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const rows: [string, string][] = [['Subtotal', money(subtotal)]];

  if (data.promoDiscount && data.promoDiscount > 0) {
    rows.push([data.promoCode ? `Discount (${data.promoCode})` : 'Discount', `−${money(data.promoDiscount)}`]);
  }
  if (data.extras && data.extras !== 0) {
    rows.push(['Shipping & handling', money(data.extras)]);
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

function drawFooter(doc: Doc, top: number): void {
  // Sign-off sits above the rule, left-aligned under the item table — Zoho's
  // placement for "Thanks for your business."
  const thanksY = Math.min(top + 6, doc.page.height - 128);
  doc.font(FONT).fontSize(10).fillColor(INK);
  bold(doc, INVOICE_THANK_YOU, PAGE_MARGIN, thanksY, { width: CONTENT_WIDTH * 0.6 });

  const y = Math.min(doc.y + 16, doc.page.height - 96);
  doc
    .moveTo(PAGE_MARGIN, y)
    .lineTo(PAGE_WIDTH - PAGE_MARGIN, y)
    .strokeColor(RULE)
    .lineWidth(1)
    .stroke();
  doc.font(FONT).fontSize(8).fillColor(MUTED);
  doc.text(INVOICE_TERMS, PAGE_MARGIN, y + 12, { width: CONTENT_WIDTH, lineGap: 2 });
  doc.text(INVOICE_NOTE, PAGE_MARGIN, doc.y + 4, { width: CONTENT_WIDTH, lineGap: 2 });
}

/** Renders the invoice and resolves with the complete PDF as a Buffer. */
export function buildInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      // `font:` in the constructor replaces the default Helvetica load. Without
      // it pdfkit resolves `#standard-fonts/Helvetica` — a wildcard subpath
      // import Vercel's file tracer cannot follow — and the whole PDF build
      // dies with MODULE_NOT_FOUND in production while working locally.
      const doc = new PDFDocument({
        size: 'A4',
        margin: PAGE_MARGIN,
        font: FONT_PATH,
        info: { Title: data.invoiceNumber },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.registerFont(FONT, FONT_PATH);

      let cursor = drawHeader(doc, data);
      cursor = drawBillTo(doc, data, cursor);
      cursor = drawTableHeader(doc, cursor);
      for (const line of data.lines) {
        // Start a new page before a row would overflow the footer area.
        if (cursor > doc.page.height - 170) {
          doc.addPage();
          cursor = drawTableHeader(doc, PAGE_MARGIN);
        }
        cursor = drawLine(doc, line, cursor);
      }
      cursor = drawTotals(doc, data, cursor);
      drawFooter(doc, cursor);

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
