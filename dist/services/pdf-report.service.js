import PDFDocument from "pdfkit";
import { isIncome } from "../db/repositories/transaction.repository.js";
import { formatRupiah } from "../bot/formatters/reply.formatter.js";
import { logger } from "../utils/logger.js";
export class PdfReportService {
    async generateMonthlyReportPdf(data) {
        return new Promise((resolve, reject) => {
            try {
                const doc = new PDFDocument({
                    size: "A4",
                    margin: 40,
                    info: {
                        Title: `Laporan Keuangan ${data.targetMonth}`,
                        Author: "IZA WhatsApp Agent",
                    },
                });
                const buffers = [];
                doc.on("data", buffers.push.bind(buffers));
                doc.on("end", () => {
                    const pdfBuffer = Buffer.concat(buffers);
                    resolve(pdfBuffer);
                });
                // 1. Header
                doc.fillColor("#1e293b").fontSize(20).text("LAPORAN KEUANGAN KAS BULANAN", { align: "center" });
                doc.fontSize(12).fillColor("#64748b").text(`Periode: ${data.targetMonth}`, { align: "center" });
                doc.moveDown(1.5);
                // 2. Summary Boxes
                const startY = doc.y;
                const boxWidth = 160;
                const boxHeight = 60;
                const marginX = 40;
                // Box 1: Pemasukan (Green)
                doc.rect(marginX, startY, boxWidth, boxHeight).fillAndStroke("#ecfdf5", "#10b981");
                doc.fillColor("#065f46").fontSize(10).text("TOTAL PEMASUKAN", marginX + 10, startY + 10);
                doc.fontSize(13).fillColor("#047857").text(formatRupiah(data.totalIncome), marginX + 10, startY + 28);
                // Box 2: Pengeluaran (Red)
                const box2X = marginX + boxWidth + 15;
                doc.rect(box2X, startY, boxWidth, boxHeight).fillAndStroke("#fef2f2", "#ef4444");
                doc.fillColor("#991b1b").fontSize(10).text("TOTAL PENGELUARAN", box2X + 10, startY + 10);
                doc.fontSize(13).fillColor("#b91c1c").text(formatRupiah(data.totalExpense), box2X + 10, startY + 28);
                // Box 3: Arus Kas Bersih (Blue)
                const box3X = box2X + boxWidth + 15;
                doc.rect(box3X, startY, boxWidth, boxHeight).fillAndStroke("#eff6ff", "#3b82f6");
                doc.fillColor("#1e40af").fontSize(10).text("ARUS KAS BERSIH", box3X + 10, startY + 10);
                const sign = data.netCashflow >= 0 ? "+" : "";
                doc.fontSize(13).fillColor("#1d4ed8").text(`${sign}${formatRupiah(data.netCashflow)}`, box3X + 10, startY + 28);
                doc.y = startY + boxHeight + 25;
                // 3. Category Breakdown
                doc.fillColor("#1e293b").fontSize(13).text("Rincian Pengeluaran per Kategori:", marginX);
                doc.moveDown(0.5);
                const categories = Object.entries(data.byCategory).sort((a, b) => b[1] - a[1]);
                if (categories.length === 0) {
                    doc.fontSize(10).fillColor("#64748b").text("- Tidak ada pengeluaran tercatat.");
                }
                else {
                    for (const [cat, amt] of categories) {
                        const percent = data.totalExpense > 0 ? ((amt / data.totalExpense) * 100).toFixed(1) : "0";
                        doc.fontSize(10).fillColor("#334155").text(`• ${cat}: `, { continued: true });
                        doc.fillColor("#0f172a").text(`${formatRupiah(amt)} `, { continued: true });
                        doc.fillColor("#64748b").text(`(${percent}%)`);
                    }
                }
                doc.moveDown(1.5);
                // 4. Transaction List Table
                doc.fillColor("#1e293b").fontSize(13).text(`Daftar Transaksi (${data.transactions.length} baris):`);
                doc.moveDown(0.5);
                // Table Header
                let tableY = doc.y;
                doc.rect(marginX, tableY, 515, 20).fill("#f1f5f9");
                doc.fillColor("#334155").fontSize(9);
                doc.text("Tgl", marginX + 5, tableY + 5, { width: 50 });
                doc.text("ID", marginX + 60, tableY + 5, { width: 70 });
                doc.text("Tempat / Sumber", marginX + 135, tableY + 5, { width: 140 });
                doc.text("Kategori", marginX + 280, tableY + 5, { width: 100 });
                doc.text("Nominal", marginX + 385, tableY + 5, { width: 75, align: "right" });
                doc.text("Metode", marginX + 465, tableY + 5, { width: 45, align: "right" });
                tableY += 22;
                // Render Rows
                for (let i = 0; i < data.transactions.length; i++) {
                    const t = data.transactions[i];
                    const isInc = isIncome(t);
                    // Add page if near bottom
                    if (tableY > 750) {
                        doc.addPage();
                        tableY = 40;
                    }
                    // Alternate row background
                    if (i % 2 === 1) {
                        doc.rect(marginX, tableY, 515, 18).fill("#f8fafc");
                    }
                    doc.fillColor("#1e293b").fontSize(8);
                    doc.text(t.date || "-", marginX + 5, tableY + 4, { width: 50 });
                    doc.text(t.id || "-", marginX + 60, tableY + 4, { width: 70 });
                    doc.text(t.merchant || "-", marginX + 135, tableY + 4, { width: 140, ellipsis: true });
                    doc.text(t.category || "-", marginX + 280, tableY + 4, { width: 100, ellipsis: true });
                    const color = isInc ? "#059669" : "#dc2626";
                    const sign = isInc ? "+" : "-";
                    doc.fillColor(color).text(`${sign}${formatRupiah(t.total_amount)}`, marginX + 385, tableY + 4, {
                        width: 75,
                        align: "right",
                    });
                    doc.fillColor("#64748b").text(t.payment_method || "Cash", marginX + 465, tableY + 4, {
                        width: 45,
                        align: "right",
                    });
                    tableY += 18;
                }
                // Footer
                doc.moveDown(2);
                const generatedTime = new Intl.DateTimeFormat("id-ID", {
                    dateStyle: "full",
                    timeStyle: "medium",
                    timeZone: "Asia/Makassar",
                }).format(new Date());
                doc.fontSize(8).fillColor("#94a3b8").text(`Digenerate secara otomatis oleh IZA WhatsApp Assistant pada ${generatedTime} WITA`, { align: "center" });
                doc.end();
            }
            catch (err) {
                logger.error({ err }, "Error generating PDF report");
                reject(err);
            }
        });
    }
}
export const pdfReportService = new PdfReportService();
//# sourceMappingURL=pdf-report.service.js.map