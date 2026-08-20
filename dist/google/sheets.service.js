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
            const oldDash = existingSheets.find((s) => s.properties?.title === this.dasborTitle || s.properties?.title === "Dasbor");
            if (oldDash) {
                await this.sheetsClient.spreadsheets.batchUpdate({
                    spreadsheetId: sheetId,
                    requestBody: {
                        requests: [
                            {
                                deleteSheet: {
                                    sheetId: oldDash.properties.sheetId,
                                },
                            },
                        ],
                    },
                });
            }
            const addRes = await this.sheetsClient.spreadsheets.batchUpdate({
                spreadsheetId: sheetId,
                requestBody: {
                    requests: [
                        {
                            addSheet: {
                                properties: {
                                    title: this.dasborTitle,
                                    gridProperties: {
                                        rowCount: 60,
                                        columnCount: 20,
                                        hideGridlines: false,
                                    },
                                },
                            },
                        },
                    ],
                },
            });
            const dashSheetId = addRes.data.replies?.[0]?.addSheet?.properties?.sheetId || 0;
            // Build formulas and layout exactly matching Photo 1 & Photo 2
            const dashboardValues = [
                ["", "", "", "", "", "", "", "", "", "", "", ""],
                ["DASHBOARD KEUANGAN", "", "", "", "", "", "", "", "", "", "", ""],
                ["TOTAL PEMASUKAN", "", "TOTAL PENGELUARAN", "", "SALDO / SELISIH", "", "TRANSAKSI", "", "", "", "", ""],
                [
                    "=SUMIF(Transaksi!D2:D; \"Pemasukan\"; Transaksi!G2:G)",
                    "",
                    "=SUMIF(Transaksi!D2:D; \"Pengeluaran\"; Transaksi!G2:G)",
                    "",
                    "=A4-C4",
                    "",
                    "=COUNTA(Transaksi!A2:A)",
                    "",
                    "",
                    "",
                    "",
                    "",
                ],
                ["", "", "", "", "", "", "", "", "", "", "", ""],
                ["", "", "", "", "", "", "", "", "", "", "", ""],
                ['=CONCATENATE("RINGKASAN BULAN "; UPPER(TEXT(TODAY(); "MMMM YYYY")))', "", "", "", "", "", "", "", "", "", "", ""],
                ["Pemasukan", "", "Pengeluaran", "", "Selisih", "", "Transaksi", "", "", "", "", ""],
                [
                    "=SUMIFS(Transaksi!G2:G; Transaksi!D2:D; \"Pemasukan\"; Transaksi!C2:C; \">=\"&TEXT(TODAY(); \"YYYY-MM\")&\"-01\"; Transaksi!C2:C; \"<=\"&TEXT(TODAY(); \"YYYY-MM\")&\"-31\")",
                    "",
                    "=SUMIFS(Transaksi!G2:G; Transaksi!D2:D; \"Pengeluaran\"; Transaksi!C2:C; \">=\"&TEXT(TODAY(); \"YYYY-MM\")&\"-01\"; Transaksi!C2:C; \"<=\"&TEXT(TODAY(); \"YYYY-MM\")&\"-31\")",
                    "",
                    "=A9-C9",
                    "",
                    '=COUNTIFS(Transaksi!C2:C; ">="&TEXT(TODAY(); "YYYY-MM")&"-01"; Transaksi!C2:C; "<="&TEXT(TODAY(); "YYYY-MM")&"-31")',
                    "",
                    "",
                    "",
                    "",
                    "",
                ],
                ["", "", "", "", "", "", "", "", "", "", "", ""],
                ["", "", "", "", "", "", "", "", "", "", "", ""],
                ["TRANSAKSI TERBARU", "", "", "", "Pengeluaran per Kategori - Bulan Ini", "", "", "", "", "", "", ""],
                [
                    "Tanggal",
                    "Keterangan",
                    "Jenis",
                    "Nominal",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "Kategori",
                    "Total Pengeluaran",
                    "",
                ],
                [
                    '=IFERROR(SORT(FILTER(CHOOSECOLS(Transaksi!A2:L; 3; 6; 4; 7); Transaksi!A2:A<>""); 1; FALSE); "Belum ada transaksi")',
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    '=IFERROR(QUERY(Transaksi!A2:L; "SELECT E, SUM(G) WHERE D = \'Pengeluaran\' GROUP BY E LABEL E \'\', SUM(G) \'\'"; 0); {"Lain-lain"\\ 0})',
                    "",
                    "",
                ],
            ];
            await this.sheetsClient.spreadsheets.values.update({
                spreadsheetId: sheetId,
                range: this.dasborTitle + "!A1:L14",
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: dashboardValues,
                },
            });
            const formattingRequests = [
                // Merge Header Banner A2:H2
                {
                    mergeCells: {
                        range: { sheetId: dashSheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 8 },
                        mergeType: "MERGE_ALL",
                    },
                },
                // Merge Top KPI Headers
                {
                    mergeCells: {
                        range: { sheetId: dashSheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 2 },
                        mergeType: "MERGE_ALL",
                    },
                },
                {
                    mergeCells: {
                        range: { sheetId: dashSheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 2, endColumnIndex: 4 },
                        mergeType: "MERGE_ALL",
                    },
                },
                {
                    mergeCells: {
                        range: { sheetId: dashSheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 4, endColumnIndex: 6 },
                        mergeType: "MERGE_ALL",
                    },
                },
                {
                    mergeCells: {
                        range: { sheetId: dashSheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 6, endColumnIndex: 8 },
                        mergeType: "MERGE_ALL",
                    },
                },
                // Merge Top KPI Values
                {
                    mergeCells: {
                        range: { sheetId: dashSheetId, startRowIndex: 3, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 2 },
                        mergeType: "MERGE_ALL",
                    },
                },
                {
                    mergeCells: {
                        range: { sheetId: dashSheetId, startRowIndex: 3, endRowIndex: 5, startColumnIndex: 2, endColumnIndex: 4 },
                        mergeType: "MERGE_ALL",
                    },
                },
                {
                    mergeCells: {
                        range: { sheetId: dashSheetId, startRowIndex: 3, endRowIndex: 5, startColumnIndex: 4, endColumnIndex: 6 },
                        mergeType: "MERGE_ALL",
                    },
                },
                {
                    mergeCells: {
                        range: { sheetId: dashSheetId, startRowIndex: 3, endRowIndex: 5, startColumnIndex: 6, endColumnIndex: 8 },
                        mergeType: "MERGE_ALL",
                    },
                },
                // Merge Monthly Banner
                {
                    mergeCells: {
                        range: { sheetId: dashSheetId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 0, endColumnIndex: 8 },
                        mergeType: "MERGE_ALL",
                    },
                },
                // Merge Monthly Headers
                {
                    mergeCells: {
                        range: { sheetId: dashSheetId, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 0, endColumnIndex: 2 },
                        mergeType: "MERGE_ALL",
                    },
                },
                {
                    mergeCells: {
                        range: { sheetId: dashSheetId, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 2, endColumnIndex: 4 },
                        mergeType: "MERGE_ALL",
                    },
                },
                {
                    mergeCells: {
                        range: { sheetId: dashSheetId, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 4, endColumnIndex: 6 },
                        mergeType: "MERGE_ALL",
                    },
                },
                {
                    mergeCells: {
                        range: { sheetId: dashSheetId, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 6, endColumnIndex: 8 },
                        mergeType: "MERGE_ALL",
                    },
                },
                // Merge Monthly Values
                {
                    mergeCells: {
                        range: { sheetId: dashSheetId, startRowIndex: 8, endRowIndex: 10, startColumnIndex: 0, endColumnIndex: 2 },
                        mergeType: "MERGE_ALL",
                    },
                },
                {
                    mergeCells: {
                        range: { sheetId: dashSheetId, startRowIndex: 8, endRowIndex: 10, startColumnIndex: 2, endColumnIndex: 4 },
                        mergeType: "MERGE_ALL",
                    },
                },
                {
                    mergeCells: {
                        range: { sheetId: dashSheetId, startRowIndex: 8, endRowIndex: 10, startColumnIndex: 4, endColumnIndex: 6 },
                        mergeType: "MERGE_ALL",
                    },
                },
                {
                    mergeCells: {
                        range: { sheetId: dashSheetId, startRowIndex: 8, endRowIndex: 10, startColumnIndex: 6, endColumnIndex: 8 },
                        mergeType: "MERGE_ALL",
                    },
                },
                // Styling Banner
                {
                    repeatCell: {
                        range: { sheetId: dashSheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 8 },
                        cell: {
                            userEnteredFormat: {
                                backgroundColor: { red: 0.94, green: 0.95, blue: 0.96 },
                                horizontalAlignment: "CENTER",
                                verticalAlignment: "MIDDLE",
                                textFormat: { bold: true, fontSize: 16, foregroundColor: { red: 0.15, green: 0.15, blue: 0.15 } },
                            },
                        },
                        fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)",
                    },
                },
                // Styling Top Headers
                {
                    repeatCell: {
                        range: { sheetId: dashSheetId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 8 },
                        cell: {
                            userEnteredFormat: {
                                backgroundColor: { red: 0.97, green: 0.98, blue: 0.99 },
                                horizontalAlignment: "CENTER",
                                verticalAlignment: "MIDDLE",
                                textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 0.2, green: 0.2, blue: 0.2 } },
                            },
                        },
                        fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)",
                    },
                },
                // Styling Top Values
                {
                    repeatCell: {
                        range: { sheetId: dashSheetId, startRowIndex: 3, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 6 },
                        cell: {
                            userEnteredFormat: {
                                horizontalAlignment: "CENTER",
                                verticalAlignment: "MIDDLE",
                                textFormat: { bold: true, fontSize: 18, foregroundColor: { red: 0.1, green: 0.1, blue: 0.1 } },
                                numberFormat: { type: "CURRENCY", pattern: '"Rp"#,##0' },
                            },
                        },
                        fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat,numberFormat)",
                    },
                },
                {
                    repeatCell: {
                        range: { sheetId: dashSheetId, startRowIndex: 3, endRowIndex: 5, startColumnIndex: 6, endColumnIndex: 8 },
                        cell: {
                            userEnteredFormat: {
                                horizontalAlignment: "CENTER",
                                verticalAlignment: "MIDDLE",
                                textFormat: { bold: true, fontSize: 18, foregroundColor: { red: 0.1, green: 0.1, blue: 0.1 } },
                                numberFormat: { type: "NUMBER", pattern: "#,##0" },
                            },
                        },
                        fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat,numberFormat)",
                    },
                },
                // Styling Monthly Banner
                {
                    repeatCell: {
                        range: { sheetId: dashSheetId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 0, endColumnIndex: 8 },
                        cell: {
                            userEnteredFormat: {
                                backgroundColor: { red: 0.95, green: 0.96, blue: 0.97 },
                                horizontalAlignment: "CENTER",
                                verticalAlignment: "MIDDLE",
                                textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 0.2, green: 0.2, blue: 0.2 } },
                            },
                        },
                        fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)",
                    },
                },
                // Styling Monthly Headers
                {
                    repeatCell: {
                        range: { sheetId: dashSheetId, startRowIndex: 7, endRowIndex: 8, startColumnIndex: 0, endColumnIndex: 8 },
                        cell: {
                            userEnteredFormat: {
                                backgroundColor: { red: 0.97, green: 0.98, blue: 0.99 },
                                horizontalAlignment: "CENTER",
                                verticalAlignment: "MIDDLE",
                                textFormat: { bold: false, fontSize: 10, foregroundColor: { red: 0.3, green: 0.3, blue: 0.3 } },
                            },
                        },
                        fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)",
                    },
                },
                // Styling Monthly Values
                {
                    repeatCell: {
                        range: { sheetId: dashSheetId, startRowIndex: 8, endRowIndex: 10, startColumnIndex: 0, endColumnIndex: 6 },
                        cell: {
                            userEnteredFormat: {
                                horizontalAlignment: "CENTER",
                                verticalAlignment: "MIDDLE",
                                textFormat: { bold: true, fontSize: 13, foregroundColor: { red: 0.1, green: 0.1, blue: 0.1 } },
                                numberFormat: { type: "CURRENCY", pattern: '"Rp"#,##0' },
                            },
                        },
                        fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat,numberFormat)",
                    },
                },
                {
                    repeatCell: {
                        range: { sheetId: dashSheetId, startRowIndex: 8, endRowIndex: 10, startColumnIndex: 6, endColumnIndex: 8 },
                        cell: {
                            userEnteredFormat: {
                                horizontalAlignment: "CENTER",
                                verticalAlignment: "MIDDLE",
                                textFormat: { bold: true, fontSize: 13, foregroundColor: { red: 0.1, green: 0.1, blue: 0.1 } },
                                numberFormat: { type: "NUMBER", pattern: "#,##0" },
                            },
                        },
                        fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat,numberFormat)",
                    },
                },
                // Table Headers Styling
                {
                    repeatCell: {
                        range: { sheetId: dashSheetId, startRowIndex: 12, endRowIndex: 13, startColumnIndex: 0, endColumnIndex: 4 },
                        cell: {
                            userEnteredFormat: {
                                backgroundColor: { red: 0.94, green: 0.95, blue: 0.96 },
                                horizontalAlignment: "LEFT",
                                verticalAlignment: "MIDDLE",
                                textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 0.2, green: 0.2, blue: 0.2 } },
                            },
                        },
                        fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)",
                    },
                },
                // Date Format in Transaksi Terbaru
                {
                    repeatCell: {
                        range: { sheetId: dashSheetId, startRowIndex: 13, endRowIndex: 35, startColumnIndex: 0, endColumnIndex: 1 },
                        cell: {
                            userEnteredFormat: {
                                horizontalAlignment: "CENTER",
                                numberFormat: { type: "DATE", pattern: "dd/mm/yyyy" },
                            },
                        },
                        fields: "userEnteredFormat(horizontalAlignment,numberFormat)",
                    },
                },
                // Nominal Format in Transaksi Terbaru
                {
                    repeatCell: {
                        range: { sheetId: dashSheetId, startRowIndex: 13, endRowIndex: 35, startColumnIndex: 3, endColumnIndex: 4 },
                        cell: {
                            userEnteredFormat: {
                                horizontalAlignment: "RIGHT",
                                numberFormat: { type: "CURRENCY", pattern: '"Rp"#,##0' },
                            },
                        },
                        fields: "userEnteredFormat(horizontalAlignment,numberFormat)",
                    },
                },
                // Borders
                {
                    updateBorders: {
                        range: { sheetId: dashSheetId, startRowIndex: 1, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 8 },
                        top: { style: "SOLID", color: { red: 0.8, green: 0.8, blue: 0.8 } },
                        bottom: { style: "SOLID", color: { red: 0.8, green: 0.8, blue: 0.8 } },
                        left: { style: "SOLID", color: { red: 0.8, green: 0.8, blue: 0.8 } },
                        right: { style: "SOLID", color: { red: 0.8, green: 0.8, blue: 0.8 } },
                        innerHorizontal: { style: "SOLID", color: { red: 0.85, green: 0.85, blue: 0.85 } },
                        innerVertical: { style: "SOLID", color: { red: 0.85, green: 0.85, blue: 0.85 } },
                    },
                },
                {
                    updateBorders: {
                        range: { sheetId: dashSheetId, startRowIndex: 6, endRowIndex: 10, startColumnIndex: 0, endColumnIndex: 8 },
                        top: { style: "SOLID", color: { red: 0.8, green: 0.8, blue: 0.8 } },
                        bottom: { style: "SOLID", color: { red: 0.8, green: 0.8, blue: 0.8 } },
                        left: { style: "SOLID", color: { red: 0.8, green: 0.8, blue: 0.8 } },
                        right: { style: "SOLID", color: { red: 0.8, green: 0.8, blue: 0.8 } },
                        innerHorizontal: { style: "SOLID", color: { red: 0.85, green: 0.85, blue: 0.85 } },
                        innerVertical: { style: "SOLID", color: { red: 0.85, green: 0.85, blue: 0.85 } },
                    },
                },
                // Column Widths
                {
                    updateDimensionProperties: {
                        range: { sheetId: dashSheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
                        properties: { pixelSize: 110 },
                        fields: "pixelSize",
                    },
                },
                {
                    updateDimensionProperties: {
                        range: { sheetId: dashSheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 },
                        properties: { pixelSize: 170 },
                        fields: "pixelSize",
                    },
                },
                {
                    updateDimensionProperties: {
                        range: { sheetId: dashSheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 },
                        properties: { pixelSize: 120 },
                        fields: "pixelSize",
                    },
                },
                {
                    updateDimensionProperties: {
                        range: { sheetId: dashSheetId, dimension: "COLUMNS", startIndex: 3, endIndex: 4 },
                        properties: { pixelSize: 140 },
                        fields: "pixelSize",
                    },
                },
                // Add Pie Chart
                {
                    addChart: {
                        chart: {
                            spec: {
                                title: "Pengeluaran per Kategori - Bulan Ini",
                                titleTextPosition: { horizontalAlignment: "CENTER" },
                                pieChart: {
                                    legendPosition: "RIGHT_LEGEND",
                                    domain: {
                                        sourceRange: {
                                            sources: [
                                                {
                                                    sheetId: dashSheetId,
                                                    startRowIndex: 12,
                                                    endRowIndex: 35,
                                                    startColumnIndex: 9,
                                                    endColumnIndex: 10,
                                                },
                                            ],
                                        },
                                    },
                                    series: {
                                        sourceRange: {
                                            sources: [
                                                {
                                                    sheetId: dashSheetId,
                                                    startRowIndex: 12,
                                                    endRowIndex: 35,
                                                    startColumnIndex: 10,
                                                    endColumnIndex: 11,
                                                },
                                            ],
                                        },
                                    },
                                    threeDimensional: false,
                                },
                            },
                            position: {
                                overlayPosition: {
                                    anchorCell: {
                                        sheetId: dashSheetId,
                                        rowIndex: 11,
                                        columnIndex: 4,
                                    },
                                    widthPixels: 520,
                                    heightPixels: 340,
                                },
                            },
                        },
                    },
                },
            ];
            await this.sheetsClient.spreadsheets.batchUpdate({
                spreadsheetId: sheetId,
                requestBody: { requests: formattingRequests },
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