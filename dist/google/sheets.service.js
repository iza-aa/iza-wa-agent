import { google } from "googleapis";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { isIncome } from "../db/repositories/transaction.repository.js";
export class GoogleSheetsService {
    sheetsClient;
    sheetTitle = "Data Transaksi";
    dasborTitle = "Dasbor";
    constructor() {
        const auth = new google.auth.JWT({
            email: config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            key: config.GOOGLE_PRIVATE_KEY,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });
        this.sheetsClient = google.sheets({ version: "v4", auth });
    }
    async ensureSheetInitialized(sheetId = config.GOOGLE_SHEET_ID) {
        try {
            const spreadsheet = await this.sheetsClient.spreadsheets.get({
                spreadsheetId: sheetId,
            });
            const existingSheets = spreadsheet.data.sheets || [];
            const hasTargetSheet = existingSheets.some((s) => s.properties?.title === this.sheetTitle);
            if (!hasTargetSheet) {
                await this.sheetsClient.spreadsheets.batchUpdate({
                    spreadsheetId: sheetId,
                    requestBody: {
                        requests: [
                            {
                                addSheet: {
                                    properties: {
                                        title: this.sheetTitle,
                                        gridProperties: {
                                            frozenRowCount: 1,
                                        },
                                    },
                                },
                            },
                        ],
                    },
                });
            }
            // Ensure Headers in Data Transaksi (A1:Q1)
            const headers = [
                "ID Transaksi",
                "Waktu Input",
                "Tanggal Transaksi",
                "Nama Penginput",
                "Nomor WhatsApp",
                "Tipe Transaksi",
                "Nama Merchant / Sumber",
                "Kategori",
                "Rincian Barang / Keterangan",
                "Subtotal (Rp)",
                "Pajak / PB1 (Rp)",
                "Diskon (Rp)",
                "Nominal Transaksi (Rp)",
                "Metode Pembayaran",
                "Status Verifikasi",
                "Catatan / Raw Text",
                "Link Bukti / Struk",
            ];
            await this.sheetsClient.spreadsheets.values.update({
                spreadsheetId: sheetId,
                range: this.sheetTitle + "!A1:Q1",
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [headers],
                },
            });
            // Setup or refresh Dasbor tab
            await this.setupDashboardTab(sheetId);
            logger.info({ sheetId }, "Google Sheet initialized with Header Row and Dashboard");
        }
        catch (error) {
            logger.error({ error, sheetId }, "Error ensuring Google Sheet initialized");
            throw error;
        }
    }
    async setupDashboardTab(sheetId = config.GOOGLE_SHEET_ID) {
        try {
            const spreadsheet = await this.sheetsClient.spreadsheets.get({
                spreadsheetId: sheetId,
            });
            const existingSheets = spreadsheet.data.sheets || [];
            const hasDasbor = existingSheets.some((s) => s.properties?.title === this.dasborTitle);
            if (!hasDasbor) {
                await this.sheetsClient.spreadsheets.batchUpdate({
                    spreadsheetId: sheetId,
                    requestBody: {
                        requests: [
                            {
                                addSheet: {
                                    properties: {
                                        title: this.dasborTitle,
                                    },
                                },
                            },
                        ],
                    },
                });
            }
            // Build formulas for Indonesian Google Sheet locale
            const dasborRows = [
                ["📊 DASBOR KEUANGAN & SALDO DOMPET KAS", "", "", "", "", ""],
                ["", "", "", "", "", ""],
                ["💰 TOTAL PEMASUKAN", "", "💸 TOTAL PENGELUARAN", "", "💵 SISA SALDO KAS (DOMPET)", ""],
                [
                    "=SUMIF('Data Transaksi'!F2:F; \"Pemasukan\"; 'Data Transaksi'!M2:M)",
                    "",
                    "=SUMIF('Data Transaksi'!F2:F; \"Pengeluaran\"; 'Data Transaksi'!M2:M)",
                    "",
                    "=A4-C4",
                    "",
                ],
                ["", "", "", "", "", ""],
                ["📈 PEMASUKAN BULAN INI", "", "📉 PENGELUARAN BULAN INI", "", "🏦 ARUS KAS BERSIH BULAN INI", ""],
                [
                    "=SUMIFS('Data Transaksi'!M2:M; 'Data Transaksi'!F2:F; \"Pemasukan\"; 'Data Transaksi'!C2:C; \">=\"&TEXT(TODAY(); \"YYYY-MM\")&\"-01\"; 'Data Transaksi'!C2:C; \"<=\"&TEXT(TODAY(); \"YYYY-MM\")&\"-31\")",
                    "",
                    "=SUMIFS('Data Transaksi'!M2:M; 'Data Transaksi'!F2:F; \"Pengeluaran\"; 'Data Transaksi'!C2:C; \">=\"&TEXT(TODAY(); \"YYYY-MM\")&\"-01\"; 'Data Transaksi'!C2:C; \"<=\"&TEXT(TODAY(); \"YYYY-MM\")&\"-31\")",
                    "",
                    "=A7-C7",
                    "",
                ],
                ["", "", "", "", "", ""],
                ["💡 Catatan: Seluruh angka di dasbor ini terupdate secara otomatis dan real-time saat transaksi baru masuk via WhatsApp.", "", "", "", "", ""],
            ];
            await this.sheetsClient.spreadsheets.values.update({
                spreadsheetId: sheetId,
                range: this.dasborTitle + "!A1:F9",
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: dasborRows,
                },
            });
            logger.info({ sheetId }, "Dashboard tab setup completed");
        }
        catch (err) {
            logger.warn({ err }, "Could not setup dashboard tab automatically");
        }
    }
    async appendTransaction(trx, items = [], sheetId = config.GOOGLE_SHEET_ID) {
        await this.ensureSheetInitialized(sheetId);
        const nowWIB = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
        const cleanPhone = trx.user_phone.startsWith("62") ? "+" + trx.user_phone : trx.user_phone;
        const itemsSummary = items.length > 0
            ? items.map((it) => it.item_name + " (" + (it.qty || 1) + "x @" + it.price + ")").join(", ")
            : "-";
        const isInc = isIncome(trx);
        const typeLabel = isInc ? "Pemasukan" : "Pengeluaran";
        const rowData = [
            trx.id, // A: ID Transaksi
            nowWIB, // B: Waktu Input
            trx.date, // C: Tanggal Transaksi
            trx.user_name, // D: Nama Penginput
            cleanPhone, // E: Nomor WhatsApp
            typeLabel, // F: Tipe Transaksi
            trx.merchant, // G: Nama Merchant / Sumber
            trx.category, // H: Kategori
            itemsSummary, // I: Rincian Barang / Keterangan
            trx.subtotal || trx.total_amount, // J: Subtotal (Rp)
            trx.tax || 0, // K: Pajak / PB1 (Rp)
            trx.discount || 0, // L: Diskon (Rp)
            trx.total_amount, // M: Nominal Transaksi (Rp)
            trx.payment_method || (isInc ? "Transfer Bank" : "Cash"), // N: Metode Pembayaran
            trx.status || (isInc ? "income" : "recorded"), // O: Status Verifikasi
            trx.raw_text || "-", // P: Catatan / Raw Text
            trx.gdrive_web_view_link ? "=HYPERLINK(\"" + trx.gdrive_web_view_link + "\"; \"Lihat Foto Struk\")" : "-", // Q: Link Bukti / Struk
        ];
        const response = await this.sheetsClient.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: this.sheetTitle + "!A:Q",
            valueInputOption: "USER_ENTERED",
            insertDataOption: "INSERT_ROWS",
            requestBody: {
                values: [rowData],
            },
        });
        const updatedRange = response.data.updates?.updatedRange || "";
        const rowMatch = updatedRange.match(/\d+$/);
        const rowIndex = rowMatch ? parseInt(rowMatch[0], 10) : 0;
        logger.info({ trxId: trx.id, updatedRange, rowIndex }, "Transaction appended to Google Sheet");
        return { updatedRange, rowIndex };
    }
    async updateTransactionRow(trx, items = [], sheetId = config.GOOGLE_SHEET_ID) {
        try {
            const res = await this.sheetsClient.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: this.sheetTitle + "!A:A",
            });
            const rows = res.data.values || [];
            const rowIndex = rows.findIndex((r) => r && r[0] === trx.id);
            if (rowIndex === -1) {
                logger.warn({ trxId: trx.id }, "Transaction ID not found in Google Sheet for update");
                return false;
            }
            const sheetRowNumber = rowIndex + 1;
            const cleanPhone = trx.user_phone.startsWith("62") ? "+" + trx.user_phone : trx.user_phone;
            const itemsSummary = items.length > 0
                ? items.map((it) => it.item_name + " (" + (it.qty || 1) + "x @" + it.price + ")").join(", ")
                : "-";
            const nowWIB = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
            const isInc = isIncome(trx);
            const typeLabel = isInc ? "Pemasukan" : "Pengeluaran";
            const updatedRowData = [
                trx.id, // A: ID Transaksi
                nowWIB, // B: Waktu Input
                trx.date, // C: Tanggal Transaksi
                trx.user_name, // D: Nama Penginput
                cleanPhone, // E: Nomor WhatsApp
                typeLabel, // F: Tipe Transaksi
                trx.merchant, // G: Nama Merchant / Sumber
                trx.category, // H: Kategori
                itemsSummary, // I: Rincian Barang / Keterangan
                trx.subtotal || trx.total_amount, // J: Subtotal (Rp)
                trx.tax || 0, // K: Pajak / PB1 (Rp)
                trx.discount || 0, // L: Diskon (Rp)
                trx.total_amount, // M: Nominal Transaksi (Rp)
                trx.payment_method || (isInc ? "Transfer Bank" : "Cash"), // N: Metode Pembayaran
                trx.status || (isInc ? "income" : "recorded"), // O: Status Verifikasi
                trx.raw_text || "-", // P: Catatan / Raw Text
                trx.gdrive_web_view_link ? "=HYPERLINK(\"" + trx.gdrive_web_view_link + "\"; \"Lihat Foto Struk\")" : "-", // Q: Link Bukti / Struk
            ];
            await this.sheetsClient.spreadsheets.values.update({
                spreadsheetId: sheetId,
                range: this.sheetTitle + "!A" + sheetRowNumber + ":Q" + sheetRowNumber,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [updatedRowData],
                },
            });
            logger.info({ trxId: trx.id, sheetRowNumber }, "Google Sheet row updated successfully");
            return true;
        }
        catch (err) {
            logger.error({ err, trxId: trx.id }, "Failed to update transaction row in Google Sheet");
            return false;
        }
    }
    async deleteTransactionRow(trxId, sheetId = config.GOOGLE_SHEET_ID) {
        try {
            const res = await this.sheetsClient.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: this.sheetTitle + "!A:A",
            });
            const rows = res.data.values || [];
            const rowIndex = rows.findIndex((r) => r && r[0] === trxId);
            if (rowIndex === -1) {
                logger.warn({ trxId }, "Transaction ID not found in Google Sheet for deletion");
                return false;
            }
            const meta = await this.sheetsClient.spreadsheets.get({ spreadsheetId: sheetId });
            const sheet = meta.data.sheets?.find((s) => s.properties?.title === this.sheetTitle);
            const sheetIdNum = sheet?.properties?.sheetId || 0;
            await this.sheetsClient.spreadsheets.batchUpdate({
                spreadsheetId: sheetId,
                requestBody: {
                    requests: [
                        {
                            deleteDimension: {
                                range: {
                                    sheetId: sheetIdNum,
                                    dimension: "ROWS",
                                    startIndex: rowIndex,
                                    endIndex: rowIndex + 1,
                                },
                            },
                        },
                    ],
                },
            });
            logger.info({ trxId, rowIndex: rowIndex + 1 }, "Deleted transaction row from Google Sheet");
            return true;
        }
        catch (err) {
            logger.error({ err, trxId }, "Failed to delete transaction row from Google Sheet");
            return false;
        }
    }
}
export const googleSheetsService = new GoogleSheetsService();
//# sourceMappingURL=sheets.service.js.map