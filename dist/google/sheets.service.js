import { google } from "googleapis";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
export class GoogleSheetsService {
    sheetsClient;
    sheetTitle = "Data Transaksi";
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
            const headerCheck = await this.sheetsClient.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: this.sheetTitle + "!A1:P1",
            });
            if (!headerCheck.data.values || headerCheck.data.values.length === 0) {
                const headers = [
                    "ID Transaksi",
                    "Tanggal",
                    "Tahun",
                    "Bulan",
                    "Penginput (Nama / HP)",
                    "Merchant / Toko",
                    "Kategori",
                    "Total (Rp)",
                    "Subtotal (Rp)",
                    "Pajak (Rp)",
                    "Diskon (Rp)",
                    "Metode Bayar",
                    "Link Bukti Foto (GDrive)",
                    "Rincian Item",
                    "Status",
                    "Waktu Catat",
                ];
                await this.sheetsClient.spreadsheets.values.update({
                    spreadsheetId: sheetId,
                    range: this.sheetTitle + "!A1:P1",
                    valueInputOption: "USER_ENTERED",
                    requestBody: {
                        values: [headers],
                    },
                });
                logger.info({ sheetId }, "Google Sheet initialized with Header Row");
            }
        }
        catch (error) {
            logger.error({ error, sheetId }, "Error ensuring Google Sheet initialized");
            throw error;
        }
    }
    async appendTransaction(trx, items = [], sheetId = config.GOOGLE_SHEET_ID) {
        await this.ensureSheetInitialized(sheetId);
        const dateObj = new Date(trx.date);
        const year = !isNaN(dateObj.getFullYear()) ? dateObj.getFullYear().toString() : new Date().getFullYear().toString();
        const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
        const month = !isNaN(dateObj.getMonth()) ? monthNames[dateObj.getMonth()] : "";
        const itemsSummary = items.length > 0
            ? items.map((it) => it.item_name + " (" + (it.qty || 1) + "x @" + it.price + ")").join(", ")
            : "-";
        const rowData = [
            trx.id,
            trx.date,
            year,
            month,
            trx.user_name + " (" + trx.user_phone + ")",
            trx.merchant,
            trx.category,
            trx.total_amount,
            trx.subtotal || trx.total_amount,
            trx.tax || 0,
            trx.discount || 0,
            trx.payment_method || "Cash",
            trx.gdrive_web_view_link ? "=HYPERLINK(\"" + trx.gdrive_web_view_link + "\", \"Lihat Bukti\")" : "-",
            itemsSummary,
            trx.status || "recorded",
            new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
        ];
        const response = await this.sheetsClient.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: this.sheetTitle + "!A:P",
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
}
export const googleSheetsService = new GoogleSheetsService();
//# sourceMappingURL=sheets.service.js.map