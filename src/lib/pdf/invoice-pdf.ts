import PDFDocument from 'pdfkit';
import { COMPANY, INVOICE_NOTE, INVOICE_TERMS, INVOICE_THANK_YOU } from '@/lib/constants/company.constants';
import type { GstSplit } from '@/lib/utils/gst.util';
import {
  ACCENT,
  bold,
  CONTENT_WIDTH,
  FONT,
  FONT_PATH,
  formatDate,
  INK,
  MUTED,
  PAGE_MARGIN,
  PAGE_WIDTH,
  RULE,
  type Doc,
} from './invoice-theme';
import { drawLine, drawTableHeader, drawTotals, isTaxInvoice, type InvoiceLine } from './invoice-table';

export type { InvoiceLine };

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
  /** GST backed out of `extras`, at the rate of the goods it accompanies. */
  extrasTax?: GstSplit;
  total: number;
}

function drawHeader(doc: Doc, data: InvoiceData): number {
  doc.font(FONT).fontSize(22).fillColor(ACCENT);
  bold(doc, COMPANY.name, PAGE_MARGIN, PAGE_MARGIN);

  doc.fontSize(8.5).fillColor(MUTED);
  doc.text(COMPANY.tagline, PAGE_MARGIN, doc.y + 2);
  doc.text(COMPANY.addressLines.join('\n'), PAGE_MARGIN, doc.y + 6, { lineGap: 1.5 });
  doc.text(`${COMPANY.phone}  ·  ${COMPANY.email}  ·  ${COMPANY.website}`, PAGE_MARGIN, doc.y + 4);
  if (COMPANY.gstin) {
    doc.fillColor(INK).text(`GSTIN: ${COMPANY.gstin}`, PAGE_MARGIN, doc.y + 4);
  }
  // Capture the left column's bottom NOW: every doc.text(x, y) below reassigns
  // doc.y, so reading it after the meta block would measure the wrong column and
  // let the divider cut through this address.
  const leftBottom = doc.y;

  // Title + meta, right-aligned against the logo block. "TAX INVOICE" only when
  // a GSTIN backs it up; without one this is a plain invoice and must not claim
  // otherwise.
  const rightX = PAGE_WIDTH / 2;
  const rightW = CONTENT_WIDTH / 2;
  doc.fontSize(isTaxInvoice() ? 20 : 24).fillColor(INK);
  bold(doc, isTaxInvoice() ? 'TAX INVOICE' : 'INVOICE', rightX, PAGE_MARGIN + 2, { width: rightW, align: 'right' });

  doc.fontSize(9).fillColor(MUTED);
  const metaRows: [string, string][] = [
    ['Invoice No.', data.invoiceNumber],
    ['Order No.', data.orderNumber],
    ['Date', formatDate(data.issuedAt)],
    ['Status', data.paymentStatus.toUpperCase()],
  ];
  if (isTaxInvoice()) {
    metaRows.push(['Place of Supply', COMPANY.stateOfSupply], ['Reverse Charge', 'No']);
  }

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
        // Start a new page before a row would overflow the footer area. The tax
        // layout needs more room below the table (three extra totals rows), so
        // the threshold grows with it.
        if (cursor > doc.page.height - (isTaxInvoice() ? 230 : 170)) {
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
