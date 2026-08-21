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
                    margin: 36,
                    bufferPages: true,
                    info: {
                        Title: `Laporan Keuangan ${data.targetMonth}`,
                        Author: "IZA WhatsApp Assistant",
                        Subject: "Laporan Arus Kas Bulanan",
                    },
                });
                const buffers = [];
                doc.on("data", buffers.push.bind(buffers));
                doc.on("end", () => {
                    const pdfBuffer = Buffer.concat(buffers);
                    resolve(pdfBuffer);
                });
                const pageWidth = 595.28;
                const pageHeight = 841.89;
                const marginX = 36;
                const contentWidth = pageWidth - marginX * 2; // 523.28
                // Format Month Label (e.g., "Agustus 2026")
                const [yearStr, monthStr] = data.targetMonth.split("-");
                const monthNames = [
                    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
                    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
                ];
                const monthIdx = parseInt(monthStr, 10) - 1;
                const monthLabel = `${monthNames[monthIdx] || monthStr} ${yearStr}`;
                // 1. TOP HEADER BANNER
                doc.roundedRect(marginX, 32, contentWidth, 68, 6).fill("#0f172a");
                // Title Left
                doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(16).text("LAPORAN ARUS KAS BULANAN", marginX + 18, 45);
                doc.fillColor("#94a3b8").font("Helvetica").fontSize(9).text("Sistem Pembukuan & Manajemen Kas Digital", marginX + 18, 65);
                doc.fillColor("#38bdf8").font("Helvetica-Bold").fontSize(9).text(`Periode: ${monthLabel.toUpperCase()}`, marginX + 18, 79);
                // Metadata Right Badge
                const metaBoxWidth = 145;
                const metaBoxX = marginX + contentWidth - metaBoxWidth - 14;
                doc.roundedRect(metaBoxX, 42, metaBoxWidth, 48, 4).fill("#1e293b");
                doc.fillColor("#94a3b8").font("Helvetica").fontSize(7.5).text("TOTAL TRANSAKSI", metaBoxX + 10, 49);
                doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(10).text(`${data.count} Transaksi`, metaBoxX + 10, 60);
                doc.fillColor("#64748b").font("Helvetica").fontSize(7).text(`Status: Terverifikasi`, metaBoxX + 10, 75);
                // 2. EXECUTIVE SUMMARY CARDS (3 Columns)
                const cardY = 112;
                const cardGap = 12;
                const cardWidth = (contentWidth - cardGap * 2) / 3; // ~166
                const cardHeight = 64;
                // Card 1: Pemasukan (Green)
                doc.roundedRect(marginX, cardY, cardWidth, cardHeight, 6).fillAndStroke("#f0fdf4", "#86efac");
                doc.fillColor("#166534").font("Helvetica-Bold").fontSize(8).text("TOTAL PEMASUKAN", marginX + 12, cardY + 12);
                doc.fillColor("#15803d").font("Helvetica-Bold").fontSize(13).text(formatRupiah(data.totalIncome), marginX + 12, cardY + 27);
                doc.fillColor("#16a34a").font("Helvetica").fontSize(7.5).text("Arus kas masuk", marginX + 12, cardY + 46);
                // Card 2: Pengeluaran (Rose/Red)
                const card2X = marginX + cardWidth + cardGap;
                doc.roundedRect(card2X, cardY, cardWidth, cardHeight, 6).fillAndStroke("#fff1f2", "#fca5a5");
                doc.fillColor("#9f1239").font("Helvetica-Bold").fontSize(8).text("TOTAL PENGELUARAN", card2X + 12, cardY + 12);
                doc.fillColor("#be123c").font("Helvetica-Bold").fontSize(13).text(formatRupiah(data.totalExpense), card2X + 12, cardY + 27);
                doc.fillColor("#e11d48").font("Helvetica").fontSize(7.5).text("Arus kas keluar", card2X + 12, cardY + 46);
                // Card 3: Saldo Bersih (Blue)
                const card3X = card2X + cardWidth + cardGap;
                doc.roundedRect(card3X, cardY, cardWidth, cardHeight, 6).fillAndStroke("#eff6ff", "#93c5fd");
                doc.fillColor("#1e40af").font("Helvetica-Bold").fontSize(8).text("ARUS KAS BERSIH (NET)", card3X + 12, cardY + 12);
                const netSign = data.netCashflow >= 0 ? "+" : "";
                doc.fillColor("#1d4ed8").font("Helvetica-Bold").fontSize(13).text(`${netSign}${formatRupiah(data.netCashflow)}`, card3X + 12, cardY + 27);
                const netLabel = data.netCashflow >= 0 ? "Surplus kas bulan ini" : "Defisit kas bulan ini";
                doc.fillColor("#2563eb").font("Helvetica").fontSize(7.5).text(netLabel, card3X + 12, cardY + 46);
                // 3. CATEGORY BREAKDOWN SECTION
                let curY = 188;
                doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(11).text("Rincian Pengeluaran per Kategori", marginX, curY);
                curY += 16;
                const categories = Object.entries(data.byCategory).sort((a, b) => b[1] - a[1]);
                if (categories.length === 0) {
                    doc.fillColor("#64748b").font("Helvetica").fontSize(8.5).text("- Tidak ada pengeluaran tercatat pada periode ini.", marginX, curY);
                    curY += 15;
                }
                else {
                    // Render categories in neat 2-column or clean bar layout
                    const colWidth = (contentWidth - 14) / 2;
                    for (let i = 0; i < categories.length; i++) {
                        const [cat, amt] = categories[i];
                        const col = i % 2;
                        const row = Math.floor(i / 2);
                        const itemX = marginX + col * (colWidth + 14);
                        const itemY = curY + row * 22;
                        const percent = data.totalExpense > 0 ? (amt / data.totalExpense) * 100 : 0;
                        // Background pill
                        doc.roundedRect(itemX, itemY, colWidth, 18, 3).fill("#f8fafc");
                        // Category Name
                        doc.fillColor("#334155").font("Helvetica-Bold").fontSize(8).text(cat, itemX + 6, itemY + 5, {
                            width: colWidth * 0.55,
                            ellipsis: true,
                        });
                        // Amount & Percentage
                        doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(8).text(formatRupiah(amt), itemX + colWidth * 0.55, itemY + 5, {
                            width: colWidth * 0.3,
                            align: "right",
                        });
                        doc.fillColor("#64748b").font("Helvetica").fontSize(7).text(`(${percent.toFixed(1)}%)`, itemX + colWidth * 0.86, itemY + 5.5, {
                            width: colWidth * 0.12,
                            align: "right",
                        });
                    }
                    const totalRows = Math.ceil(categories.length / 2);
                    curY += totalRows * 22 + 8;
                }
                // 4. TRANSACTION LIST TABLE
                curY += 4;
                doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(11).text(`Daftar Rincian Transaksi (${data.transactions.length} baris)`, marginX, curY);
                curY += 15;
                // Function to render table header
                const renderTableHeader = (yPos) => {
                    doc.roundedRect(marginX, yPos, contentWidth, 18, 3).fill("#1e293b");
                    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7.5);
                    doc.text("Tanggal", marginX + 6, yPos + 5, { width: 50 });
                    doc.text("ID", marginX + 60, yPos + 5, { width: 65 });
                    doc.text("Tempat / Toko / Sumber", marginX + 130, yPos + 5, { width: 145 });
                    doc.text("Kategori", marginX + 280, yPos + 5, { width: 105 });
                    doc.text("Nominal", marginX + 390, yPos + 5, { width: 75, align: "right" });
                    doc.text("Metode", marginX + 470, yPos + 5, { width: 45, align: "right" });
                };
                renderTableHeader(curY);
                curY += 20;
                // Render Transaction Rows
                for (let i = 0; i < data.transactions.length; i++) {
                    const t = data.transactions[i];
                    const isInc = isIncome(t);
                    // Pagination check: create new page if row exceeds page height (leave space for footer)
                    if (curY > pageHeight - 55) {
                        doc.addPage();
                        curY = 36;
                        renderTableHeader(curY);
                        curY += 20;
                    }
                    // Alternating row background
                    if (i % 2 === 1) {
                        doc.roundedRect(marginX, curY, contentWidth, 16, 2).fill("#f8fafc");
                    }
                    doc.fillColor("#1e293b").font("Helvetica").fontSize(7.2);
                    doc.text(t.date || "-", marginX + 6, curY + 4, { width: 50 });
                    doc.text(t.id || "-", marginX + 60, curY + 4, { width: 65 });
                    doc.text(t.merchant || "-", marginX + 130, curY + 4, { width: 145, ellipsis: true });
                    doc.text(t.category || "-", marginX + 280, curY + 4, { width: 105, ellipsis: true });
                    const color = isInc ? "#15803d" : "#be123c";
                    const sign = isInc ? "+" : "-";
                    doc.fillColor(color).font("Helvetica-Bold").text(`${sign}${formatRupiah(t.total_amount)}`, marginX + 390, curY + 4, {
                        width: 75,
                        align: "right",
                    });
                    doc.fillColor("#64748b").font("Helvetica").text(t.payment_method || "Cash", marginX + 470, curY + 4, {
                        width: 45,
                        align: "right",
                    });
                    curY += 16;
                }
                // 5. GLOBAL PAGE NUMBERING & FOOTER (on every page)
                const totalPages = doc.bufferedPageRange().count;
                const generatedTime = new Intl.DateTimeFormat("id-ID", {
                    dateStyle: "full",
                    timeStyle: "medium",
                    timeZone: "Asia/Makassar",
                }).format(new Date());
                for (let i = 0; i < totalPages; i++) {
                    doc.switchToPage(i);
                    // Footer separator line
                    doc.moveTo(marginX, pageHeight - 32).lineTo(marginX + contentWidth, pageHeight - 32).strokeColor("#e2e8f0").stroke();
                    // Left
                    doc.fillColor("#94a3b8").font("Helvetica").fontSize(6.8).text(`Digenerate oleh IZA WhatsApp Assistant • ${generatedTime} WITA`, marginX, pageHeight - 24);
                    // Right
                    doc.fillColor("#94a3b8").font("Helvetica-Bold").fontSize(6.8).text(`Halaman ${i + 1} dari ${totalPages}`, marginX, pageHeight - 24, { width: contentWidth, align: "right" });
                }
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