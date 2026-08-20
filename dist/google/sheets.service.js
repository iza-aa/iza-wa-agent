import { google } from "googleapis";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { isIncome } from "../db/repositories/transaction.repository.js";
export class GoogleSheetsService {
    sheetsClient;
    sheetTitle = "Transaksi";
    dasborTitle = "Dashboard";
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
            // Check if 'Transaksi' or 'Data Transaksi' exists
            let targetSheet = existingSheets.find((s) => s.properties?.title === this.sheetTitle);
            if (!targetSheet) {
                // If old 'Data Transaksi' exists, rename it to 'Transaksi'
                const oldSheet = existingSheets.find((s) => s.properties?.title === "Data Transaksi");
                if (oldSheet) {
                    await this.sheetsClient.spreadsheets.batchUpdate({
                        spreadsheetId: sheetId,
                        requestBody: {
                            requests: [
                                {
                                    updateSheetProperties: {
                                        properties: {
                                            sheetId: oldSheet.properties.sheetId,
                                            title: this.sheetTitle,
                                        },
                                        fields: "title",
                                    },
                                },
                            ],
                        },
                    });
                }
                else {
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
            }
            // Check / rename old 'Dasbor' to 'Dashboard' if needed
            const oldDasbor = existingSheets.find((s) => s.properties?.title === "Dasbor");
            if (oldDasbor) {
                try {
                    await this.sheetsClient.spreadsheets.batchUpdate({
                        spreadsheetId: sheetId,
                        requestBody: {
                            requests: [
                                {
                                    updateSheetProperties: {
                                        properties: {
                                            sheetId: oldDasbor.properties.sheetId,
                                            title: this.dasborTitle,
                                        },
                                        fields: "title",
                                    },
                                },
                            ],
                        },
                    });
                }
                catch (renameErr) {
                    logger.debug({ renameErr }, "Dasbor tab rename skip");
                }
            }
            // Ensure Headers in Transaksi (A1:L1 - Sesuai Foto 3)
            const headers = [
                "ID", // A
                "Timestamp", // B
                "Tanggal", // C
                "Jenis", // D (Pemasukan / Pengeluaran)
                "Kategori", // E
                "Keterangan", // F
                "Nominal", // G
                "Metode", // H (Mandiri, Cash, BRI, BCA, QRIS, dll.)
                "Nomor WhatsApp", // I
                "Nama", // J
                "Link Bukti", // K
                "Pesan Asli", // L
            ];
            await this.sheetsClient.spreadsheets.values.update({
                spreadsheetId: sheetId,
                range: this.sheetTitle + "!A1:L1",
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [headers],
                },
            });
            // Setup or refresh Dashboard tab (Sesuai Foto 1 & 2)
            await this.setupDashboardTab(sheetId);
            logger.info({ sheetId }, "Google Sheet initialized with Transaksi (A:L) and Dashboard");
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
            const hasDashboard = existingSheets.some((s) => s.properties?.title === this.dasborTitle);
            if (!hasDashboard) {
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
            // Build formulas and layout exactly matching Photo 1 & Photo 2
            const dashboardRows = [
                ["", "", "", "", "", "", "", ""],
                ["DASHBOARD KEUANGAN", "", "", "", "", "", "", ""],
                ["TOTAL PEMASUKAN", "", "TOTAL PENGELUARAN", "", "SALDO / SELISIH", "", "TRANSAKSI", ""],
                [
                    "=SUMIF(Transaksi!D2:D; \"Pemasukan\"; Transaksi!G2:G)",
                    "",
                    "=SUMIF(Transaksi!D2:D; \"Pengeluaran\"; Transaksi!G2:G)",
                    "",
                    "=A4-C4",
                    "",
                    "=COUNTA(Transaksi!A2:A)",
                    "",
                ],
                ["", "", "", "", "", "", "", ""],
                ["", "", "", "", "", "", "", ""],
                ["=CONCATENATE(\"RINGKASAN BULAN \"; UPPER(TEXT(TODAY(); \"MMMM YYYY\")))", "", "", "", "", "", "", ""],
                ["Pemasukan", "", "Pengeluaran", "", "Selisih", "", "Transaksi", ""],
                [
                    "=SUMIFS(Transaksi!G2:G; Transaksi!D2:D; \"Pemasukan\"; Transaksi!C2:C; \">=\"&TEXT(TODAY(); \"YYYY-MM\")&\"-01\"; Transaksi!C2:C; \"<=\"&TEXT(TODAY(); \"YYYY-MM\")&\"-31\")",
                    "",
                    "=SUMIFS(Transaksi!G2:G; Transaksi!D2:D; \"Pengeluaran\"; Transaksi!C2:C; \">=\"&TEXT(TODAY(); \"YYYY-MM\")&\"-01\"; Transaksi!C2:C; \"<=\"&TEXT(TODAY(); \"YYYY-MM\")&\"-31\")",
                    "",
                    "=A9-C9",
                    "",
                    "=COUNTIFS(Transaksi!C2:C; \">=\"&TEXT(TODAY(); \"YYYY-MM\")&\"-01\"; Transaksi!C2:C; \"<=\"&TEXT(TODAY(); \"YYYY-MM\")&\"-31\")",
                    "",
                ],
                ["", "", "", "", "", "", "", ""],
                ["", "", "", "", "", "", "", ""],
                ["TRANSAKSI TERBARU", "", "", "", "Pengeluaran per Kategori - Bulan Ini", "", "", ""],
                ["Tanggal", "Keterangan", "Jenis", "Nominal", "Kategori", "Total (Rp)", "", ""],
                [
                    "=IFERROR(QUERY(Transaksi!A2:L; \"SELECT C, F, D, G ORDER BY B DESC LIMIT 15 LABEL C '', F '', D '', G ''\"; 0); \"Belum ada data transaksi\")",
                    "",
                    "",
                    "",
                    "=IFERROR(QUERY(Transaksi!A2:L; \"SELECT E, SUM(G) WHERE D = 'Pengeluaran' AND C >= '\"&TEXT(TODAY(); \"YYYY-MM\")&\"-01' AND C <= '\"&TEXT(TODAY(); \"YYYY-MM\")&\"-31' GROUP BY E LABEL E '', SUM(G) ''\"; 0); \"Belum ada pengeluaran\")",
                    "",
                    "",
                    "",
                ],
            ];
            await this.sheetsClient.spreadsheets.values.update({
                spreadsheetId: sheetId,
                range: this.dasborTitle + "!A1:H14",
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: dashboardRows,
                },
            });
            logger.info({ sheetId }, "Dashboard tab setup completed matching reference design");
        }
        catch (err) {
            logger.warn({ err }, "Could not setup dashboard tab automatically");
        }
    }
    async appendTransaction(trx, items = [], sheetId = config.GOOGLE_SHEET_ID) {
        await this.ensureSheetInitialized(sheetId);
        const nowWIB = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
        const cleanPhone = trx.user_phone.startsWith("62") ? "+" + trx.user_phone : trx.user_phone;
        const isInc = isIncome(trx);
        const typeLabel = isInc ? "Pemasukan" : "Pengeluaran";
        const paymentMethod = trx.payment_method || (isInc ? "Transfer Bank" : "Cash");
        // Row format according to Photo 3 (Columns A:L)
        const rowData = [
            trx.id, // A: ID
            nowWIB, // B: Timestamp
            trx.date, // C: Tanggal
            typeLabel, // D: Jenis (Pemasukan / Pengeluaran)
            trx.category, // E: Kategori
            trx.merchant, // F: Keterangan
            trx.total_amount, // G: Nominal
            paymentMethod, // H: Metode (Mandiri, Cash, BRI, BCA, QRIS, dll.)
            cleanPhone, // I: Nomor WhatsApp
            trx.user_name, // J: Nama
            trx.gdrive_web_view_link ? "=HYPERLINK(\"" + trx.gdrive_web_view_link + "\"; \"Lihat Bukti\")" : "-", // K: Link Bukti
            trx.raw_text || "-", // L: Pesan Asli
        ];
        const response = await this.sheetsClient.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: this.sheetTitle + "!A:L",
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
            const nowWIB = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
            const isInc = isIncome(trx);
            const typeLabel = isInc ? "Pemasukan" : "Pengeluaran";
            const paymentMethod = trx.payment_method || (isInc ? "Transfer Bank" : "Cash");
            const updatedRowData = [
                trx.id, // A: ID
                nowWIB, // B: Timestamp
                trx.date, // C: Tanggal
                typeLabel, // D: Jenis
                trx.category, // E: Kategori
                trx.merchant, // F: Keterangan
                trx.total_amount, // G: Nominal
                paymentMethod, // H: Metode
                cleanPhone, // I: Nomor WhatsApp
                trx.user_name, // J: Nama
                trx.gdrive_web_view_link ? "=HYPERLINK(\"" + trx.gdrive_web_view_link + "\"; \"Lihat Bukti\")" : "-", // K: Link Bukti
                trx.raw_text || "-", // L: Pesan Asli
            ];
            await this.sheetsClient.spreadsheets.values.update({
                spreadsheetId: sheetId,
                range: this.sheetTitle + "!A" + sheetRowNumber + ":L" + sheetRowNumber,
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