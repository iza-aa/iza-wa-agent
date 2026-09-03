import PDFDocument from "pdfkit";
import { TransactionRecord, isIncome } from "../db/repositories/transaction.repository.js";
import { formatRupiah } from "../bot/formatters/reply.formatter.js";
import { logger } from "../utils/logger.js";

export interface MonthlyPdfData {
  targetMonth: string; // 'YYYY-MM'
  totalIncome: number;
  totalExpense: number;
  netCashflow: number;
  count: number;
  byCategory: { [cat: string]: number }; // This carries the department breakdown (Dapur, Barista, Kafe, Kasir, Waiters)
  transactions: TransactionRecord[];
}

type PDFKitDocument = InstanceType<typeof PDFDocument>;

// ---------------------------------------------------------------------------
// Design tokens.
// A financial report should read like a bank statement or ledger, not a
// marketing dashboard: one accent color, a neutral gray scale, hairline
// rules instead of filled colored cards, and every number right-aligned
// on the same grid. This is the entire "house style" for the document.
// ---------------------------------------------------------------------------
const COLOR = {
  ink: "#111827", // primary text
  subtle: "#6b7280", // secondary text / column labels
  faint: "#9ca3af", // tertiary text (footer, row numbers)
  line: "#e5e7eb", // hairline rules between rows
  lineStrong: "#cbd5e1", // section dividers
  accent: "#0f172a", // single brand accent — used sparingly
  negative: "#b91c1c", // expense / outflow amounts only
  zebra: "#fafafa", // near-invisible row shading, not a colored fill
};

const FONT = {
  regular: "Helvetica",
  bold: "Helvetica-Bold",
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_SAFE_Y = PAGE_HEIGHT - 58; // reserve room for the footer rule + text

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

export class PdfReportService {
  async generateMonthlyReportPdf(data: MonthlyPdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: "A4",
          margin: MARGIN,
          bufferPages: true,
          info: {
            Title: `Laporan Keuangan ${data.targetMonth}`,
            Author: "IZA AI Assistant",
            Subject: "Laporan Arus Kas Bulanan",
          },
        });

        const buffers: Buffer[] = [];
        doc.on("data", buffers.push.bind(buffers));
        doc.on("end", () => resolve(Buffer.concat(buffers)));

        const monthLabel = this.formatMonthLabel(data.targetMonth);

        let y = this.drawHeader(doc, monthLabel, data.count);
        y = this.drawSummary(doc, y, data);
        y = this.drawDepartmentBreakdown(doc, y, data);
        this.drawTransactionTable(doc, y, data);
        this.drawFooterOnEveryPage(doc);

        doc.end();
      } catch (err) {
        logger.error({ err }, "Error generating PDF report");
        reject(err);
      }
    });
  }

  private formatMonthLabel(targetMonth: string): string {
    const [yearStr, monthStr] = targetMonth.split("-");
    const monthIdx = parseInt(monthStr, 10) - 1;
    return `${MONTH_NAMES[monthIdx] || monthStr} ${yearStr}`;
  }

  // -------------------------------------------------------------------
  // 1. Header — a letterhead, not a gradient banner.
  // -------------------------------------------------------------------
  private drawHeader(doc: PDFKitDocument, monthLabel: string, count: number): number {
    let y = MARGIN;

    doc.fillColor(COLOR.subtle).font(FONT.regular).fontSize(8)
      .text("LAPORAN KEUANGAN", MARGIN, y, { characterSpacing: 1.2 });

    y += 14;
    doc.fillColor(COLOR.ink).font(FONT.bold).fontSize(19)
      .text("Laporan Arus Kas Bulanan", MARGIN, y);

    y += 26;
    doc.fillColor(COLOR.accent).font(FONT.bold).fontSize(10)
      .text(`Periode ${monthLabel}`, MARGIN, y);
    doc.fillColor(COLOR.subtle).font(FONT.regular).fontSize(9)
      .text(`${count} transaksi tercatat`, MARGIN, y + 1, { width: CONTENT_WIDTH, align: "right" });

    y += 18;
    // A short accent underline
    doc.rect(MARGIN, y, 34, 2.5).fill(COLOR.accent);
    doc.moveTo(MARGIN + 42, y + 1.25).lineTo(MARGIN + CONTENT_WIDTH, y + 1.25)
      .strokeColor(COLOR.line).lineWidth(1).stroke();

    return y + 22;
  }

  // -------------------------------------------------------------------
  // 2. Summary strip — three flat columns divided by hairlines.
  // -------------------------------------------------------------------
  private drawSummary(doc: PDFKitDocument, startY: number, data: MonthlyPdfData): number {
    const top = startY;
    const colWidth = CONTENT_WIDTH / 3;
    const items = [
      { label: "PEMASUKAN", value: data.totalIncome, sign: "+", color: COLOR.ink, helper: "Total arus kas masuk" },
      { label: "PENGELUARAN", value: data.totalExpense, sign: "-", color: COLOR.negative, helper: "Total arus kas keluar" },
      {
        label: "ARUS KAS BERSIH",
        value: Math.abs(data.netCashflow),
        sign: data.netCashflow >= 0 ? "+" : "-",
        color: data.netCashflow >= 0 ? COLOR.ink : COLOR.negative,
        helper: data.netCashflow >= 0 ? "Surplus kas bulan ini" : "Defisit kas bulan ini",
      },
    ];

    doc.moveTo(MARGIN, top).lineTo(MARGIN + CONTENT_WIDTH, top).strokeColor(COLOR.lineStrong).lineWidth(1).stroke();

    const y = top + 12;
    items.forEach((item, i) => {
      const x = MARGIN + i * colWidth;
      doc.fillColor(COLOR.subtle).font(FONT.regular).fontSize(7.5)
        .text(item.label, x, y, { characterSpacing: 0.8 });
      doc.fillColor(item.color).font(FONT.bold).fontSize(15)
        .text(`${item.sign} ${formatRupiah(item.value)}`, x, y + 13);
      doc.fillColor(COLOR.faint).font(FONT.regular).fontSize(7.5)
        .text(item.helper, x, y + 32);

      if (i < items.length - 1) {
        doc.moveTo(x + colWidth - 16, y - 2).lineTo(x + colWidth - 16, y + 40)
          .strokeColor(COLOR.line).lineWidth(1).stroke();
      }
    });

    const bottom = y + 50;
    doc.moveTo(MARGIN, bottom).lineTo(MARGIN + CONTENT_WIDTH, bottom).strokeColor(COLOR.lineStrong).lineWidth(1).stroke();

    return bottom + 20;
  }

  // -------------------------------------------------------------------
  // 3. Department breakdown — Division totals (Dapur, Barista, Kafe, Kasir, Waiters)
  // -------------------------------------------------------------------
  private drawDepartmentBreakdown(doc: PDFKitDocument, startY: number, data: MonthlyPdfData): number {
    let y = startY;
    doc.fillColor(COLOR.ink).font(FONT.bold).fontSize(11)
      .text("Rincian Pengeluaran per Divisi", MARGIN, y);
    y += 18;

    const departments = Object.entries(data.byCategory || {})
      .filter(([_, amt]) => amt > 0)
      .sort((a, b) => b[1] - a[1]);

    if (departments.length === 0) {
      doc.fillColor(COLOR.subtle).font(FONT.regular).fontSize(8.5)
        .text("Tidak ada pengeluaran operasional divisi tercatat pada periode ini.", MARGIN, y);
      return y + 20;
    }

    const nameColX = MARGIN;
    const barColX = MARGIN + 220;
    const barWidth = 140;
    const amountColX = MARGIN + CONTENT_WIDTH - 150;
    const percentColX = MARGIN + CONTENT_WIDTH - 40;
    const rowHeight = 20;
    const maxAmount = departments[0][1] || 1;

    doc.fillColor(COLOR.subtle).font(FONT.regular).fontSize(7.5);
    doc.text("DIVISI OPERASIONAL", nameColX, y, { characterSpacing: 0.6 });
    doc.text("TOTAL BELANJA", amountColX, y, { width: 110, align: "right", characterSpacing: 0.6 });
    doc.text("%", percentColX, y, { width: 40, align: "right", characterSpacing: 0.6 });
    y += 12;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).strokeColor(COLOR.line).lineWidth(1).stroke();
    y += 6;

    for (const [dept, amt] of departments) {
      if (y > FOOTER_SAFE_Y) {
        doc.addPage();
        y = MARGIN;
      }
      const percent = data.totalExpense > 0 ? (amt / data.totalExpense) * 100 : 0;

      doc.fillColor(COLOR.ink).font(FONT.bold).fontSize(8.5)
        .text(`Divisi ${dept}`, nameColX, y + 4, { width: 210, ellipsis: true });

      // Thin proportional bar indicator
      const w = Math.max(2, (amt / maxAmount) * barWidth);
      doc.rect(barColX, y + 8, barWidth, 3).fill(COLOR.line);
      doc.rect(barColX, y + 8, w, 3).fill(COLOR.accent);

      doc.fillColor(COLOR.ink).font(FONT.bold).fontSize(8.5)
        .text(formatRupiah(amt), amountColX, y + 4, { width: 110, align: "right" });
      doc.fillColor(COLOR.subtle).font(FONT.regular).fontSize(8)
        .text(`${percent.toFixed(1)}%`, percentColX, y + 4, { width: 40, align: "right" });

      y += rowHeight;
      doc.moveTo(MARGIN, y - 4).lineTo(MARGIN + CONTENT_WIDTH, y - 4)
        .strokeColor(COLOR.line).lineWidth(0.75).stroke();
    }

    return y + 16;
  }

  // -------------------------------------------------------------------
  // 4. Transaction ledger — ruled table like a bank statement.
  // -------------------------------------------------------------------
  private drawTransactionTable(doc: PDFKitDocument, startY: number, data: MonthlyPdfData): void {
    let y = startY;

    doc.fillColor(COLOR.ink).font(FONT.bold).fontSize(11)
      .text(`Daftar Transaksi (${data.transactions.length} baris)`, MARGIN, y);
    y += 18;

    const cols = {
      no: { x: MARGIN, w: 24 },
      date: { x: MARGIN + 24, w: 52 },
      merchant: { x: MARGIN + 84, w: 175 },
      category: { x: MARGIN + 267, w: 100 },
      method: { x: MARGIN + 375, w: 60 },
      amount: { x: MARGIN + 443, w: CONTENT_WIDTH - 443 },
    };

    const renderHeader = (yPos: number): number => {
      doc.fillColor(COLOR.subtle).font(FONT.regular).fontSize(7.5);
      doc.text("NO.", cols.no.x, yPos, { width: cols.no.w, characterSpacing: 0.5 });
      doc.text("TANGGAL", cols.date.x, yPos, { width: cols.date.w, characterSpacing: 0.5 });
      doc.text("TEMPAT / SUMBER", cols.merchant.x, yPos, { width: cols.merchant.w, characterSpacing: 0.5 });
      doc.text("KATEGORI", cols.category.x, yPos, { width: cols.category.w, characterSpacing: 0.5 });
      doc.text("METODE", cols.method.x, yPos, { width: cols.method.w, characterSpacing: 0.5 });
      doc.text("NOMINAL", cols.amount.x, yPos, { width: cols.amount.w, align: "right", characterSpacing: 0.5 });
      const lineY = yPos + 12;
      doc.moveTo(MARGIN, lineY).lineTo(MARGIN + CONTENT_WIDTH, lineY)
        .strokeColor(COLOR.lineStrong).lineWidth(1).stroke();
      return lineY + 6;
    };

    y = renderHeader(y);

    data.transactions.forEach((t, i) => {
      if (y > FOOTER_SAFE_Y) {
        doc.addPage();
        y = renderHeader(MARGIN);
      }

      if (i % 2 === 1) {
        doc.rect(MARGIN, y - 3, CONTENT_WIDTH, 16).fill(COLOR.zebra);
      }

      const isInc = isIncome(t);
      doc.fillColor(COLOR.faint).font(FONT.regular).fontSize(7.5)
        .text(String(i + 1), cols.no.x, y, { width: cols.no.w });
      doc.fillColor(COLOR.ink).font(FONT.regular).fontSize(7.5)
        .text(t.date || "-", cols.date.x, y, { width: cols.date.w });
      doc.fillColor(COLOR.ink).font(FONT.regular).fontSize(7.5)
        .text(t.merchant || "-", cols.merchant.x, y, { width: cols.merchant.w, ellipsis: true });
      doc.fillColor(COLOR.subtle).font(FONT.regular).fontSize(7.5)
        .text(t.category || "-", cols.category.x, y, { width: cols.category.w, ellipsis: true });
      doc.fillColor(COLOR.subtle).font(FONT.regular).fontSize(7.5)
        .text(t.payment_method || "Cash", cols.method.x, y, { width: cols.method.w });

      const sign = isInc ? "+" : "-";
      doc.fillColor(isInc ? COLOR.ink : COLOR.negative).font(FONT.bold).fontSize(7.5)
        .text(`${sign} ${formatRupiah(t.total_amount)}`, cols.amount.x, y, { width: cols.amount.w, align: "right" });

      y += 16;
      doc.moveTo(MARGIN, y - 4).lineTo(MARGIN + CONTENT_WIDTH, y - 4)
        .strokeColor(COLOR.line).lineWidth(0.5).stroke();
    });
  }

  // -------------------------------------------------------------------
  // 5. Footer — one hairline, timestamp left, page count right.
  // -------------------------------------------------------------------
  private drawFooterOnEveryPage(doc: PDFKitDocument): void {
    const range = doc.bufferedPageRange();
    const generatedTime = new Intl.DateTimeFormat("id-ID", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "Asia/Makassar",
    }).format(new Date());

    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const footerY = PAGE_HEIGHT - 40;

      doc.moveTo(MARGIN, footerY).lineTo(MARGIN + CONTENT_WIDTH, footerY)
        .strokeColor(COLOR.line).lineWidth(1).stroke();

      doc.fillColor(COLOR.faint).font(FONT.regular).fontSize(7)
        .text(`Digenerate oleh IZA AI Assistant • Terakhir Diperbarui: ${generatedTime} WITA`, MARGIN, footerY + 8, { lineBreak: false });

      doc.fillColor(COLOR.faint).font(FONT.regular).fontSize(7)
        .text(`Halaman ${i + 1} dari ${range.count}`, MARGIN, footerY + 8, {
          width: CONTENT_WIDTH,
          align: "right",
          lineBreak: false,
        });
    }
  }
}

export const pdfReportService = new PdfReportService();
