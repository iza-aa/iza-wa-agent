import { google } from "googleapis";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { isIncome } from "../db/repositories/transaction.repository.js";
export function normalizeDateToIso(rawDate) {
    if (!rawDate)
        return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(new Date());
    const trimmed = rawDate.toString().trim();
    // If already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return trimmed;
    }
    // If DD/MM/YYYY or DD-MM-YYYY
    const dmyMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmyMatch) {
        const day = dmyMatch[1].padStart(2, "0");
        const month = dmyMatch[2].padStart(2, "0");
        const year = dmyMatch[3];
        return `${year}-${month}-${day}`;
    }
    // If YYYY/MM/DD
    const ymdMatch = trimmed.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (ymdMatch) {
        const year = ymdMatch[1];
        const month = ymdMatch[2].padStart(2, "0");
        const day = ymdMatch[3].padStart(2, "0");
        return `${year}-${month}-${day}`;
    }
    // Try parsing Date object
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
        return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(parsed);
    }
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(new Date());
}
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
            // Ensure hidden 'Calc_Data' sheet for chart aggregations
            let calcSheet = existingSheets.find((s) => s.properties?.title === "Calc_Data");
            let calcSheetId = calcSheet?.properties?.sheetId;
            if (!calcSheet) {
                const addCalc = await this.sheetsClient.spreadsheets.batchUpdate({
                    spreadsheetId: sheetId,
                    requestBody: {
                        requests: [
                            {
                                addSheet: {
                                    properties: {
                                        title: "Calc_Data",
                                        hidden: true,
                                    },
                                },
                            },
                        ],
                    },
                });
                calcSheetId = addCalc.data.replies?.[0]?.addSheet?.properties?.sheetId || 0;
            }
            await this.sheetsClient.spreadsheets.values.update({
                spreadsheetId: sheetId,
                range: "Calc_Data!A1:B1",
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [
                        ['=IFERROR(QUERY(Transaksi!A2:L; "SELECT E, SUM(G) WHERE D = \'Pengeluaran\' AND A IS NOT NULL GROUP BY E ORDER BY SUM(G) DESC LABEL E \'\', SUM(G) \'\'"); {"Belum ada pengeluaran"\\ 0})', ""]
                    ],
                },
            });
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
                    "=SUMIF(Transaksi!D:D; \"Pemasukan\"; Transaksi!G:G)",
                    "",
                    "=SUMIF(Transaksi!D:D; \"Pengeluaran\"; Transaksi!G:G)",
                    "",
                    "=A4-C4",
                    "",
                    "=IF(COUNTA(Transaksi!A:A)>1; COUNTA(Transaksi!A:A)-1; 0)",
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
                    "=SUMIFS(Transaksi!G:G; Transaksi!D:D; \"Pemasukan\"; Transaksi!C:C; \">=\"&DATE(YEAR(TODAY()); MONTH(TODAY()); 1); Transaksi!C:C; \"<=\"&EOMONTH(TODAY(); 0))",
                    "",
                    "=SUMIFS(Transaksi!G:G; Transaksi!D:D; \"Pengeluaran\"; Transaksi!C:C; \">=\"&DATE(YEAR(TODAY()); MONTH(TODAY()); 1); Transaksi!C:C; \"<=\"&EOMONTH(TODAY(); 0))",
                    "",
                    "=A9-C9",
                    "",
                    "=COUNTIFS(Transaksi!C:C; \">=\"&DATE(YEAR(TODAY()); MONTH(TODAY()); 1); Transaksi!C:C; \"<=\"&EOMONTH(TODAY(); 0))",
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
                    "",
                    "",
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
                    "",
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
                // Date Format in Transaksi Terbaru (Whole Column A14:A1000)
                {
                    repeatCell: {
                        range: { sheetId: dashSheetId, startRowIndex: 13, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: 1 },
                        cell: {
                            userEnteredFormat: {
                                horizontalAlignment: "CENTER",
                                verticalAlignment: "MIDDLE",
                                numberFormat: { type: "DATE", pattern: "dd/mm/yyyy" },
                                textFormat: { bold: false, fontSize: 10, foregroundColor: { red: 0.1, green: 0.1, blue: 0.1 } },
                            },
                        },
                        fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,numberFormat,textFormat)",
                    },
                },
                // Nominal Format in Transaksi Terbaru (Whole Column D14:D1000)
                {
                    repeatCell: {
                        range: { sheetId: dashSheetId, startRowIndex: 13, endRowIndex: 1000, startColumnIndex: 3, endColumnIndex: 4 },
                        cell: {
                            userEnteredFormat: {
                                horizontalAlignment: "RIGHT",
                                verticalAlignment: "MIDDLE",
                                numberFormat: { type: "CURRENCY", pattern: '"Rp"#,##0' },
                                textFormat: { bold: false, fontSize: 10, foregroundColor: { red: 0.1, green: 0.1, blue: 0.1 } },
                            },
                        },
                        fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,numberFormat,textFormat)",
                    },
                },
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
                                                    sheetId: calcSheetId,
                                                    startRowIndex: 0,
                                                    endRowIndex: 30,
                                                    startColumnIndex: 0,
                                                    endColumnIndex: 1,
                                                },
                                            ],
                                        },
                                    },
                                    series: {
                                        sourceRange: {
                                            sources: [
                                                {
                                                    sheetId: calcSheetId,
                                                    startRowIndex: 0,
                                                    endRowIndex: 30,
                                                    startColumnIndex: 1,
                                                    endColumnIndex: 2,
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
            // Add column width adjustments for Transaksi tab
            const meta = await this.sheetsClient.spreadsheets.get({ spreadsheetId: sheetId });
            const trxSheet = meta.data.sheets?.find((s) => s.properties?.title === this.sheetTitle);
            const trxSheetId = trxSheet?.properties?.sheetId || 0;
            const trxColWidths = [
                { start: 0, end: 1, size: 110 }, // A: ID
                { start: 1, end: 2, size: 160 }, // B: Timestamp
                { start: 2, end: 3, size: 110 }, // C: Tanggal
                { start: 3, end: 4, size: 110 }, // D: Jenis
                { start: 4, end: 5, size: 220 }, // E: Kategori (Expanded!)
                { start: 5, end: 6, size: 230 }, // F: Keterangan (Expanded!)
                { start: 6, end: 7, size: 130 }, // G: Nominal
                { start: 7, end: 8, size: 130 }, // H: Metode
                { start: 8, end: 9, size: 175 }, // I: Nomor WhatsApp (Expanded!)
                { start: 9, end: 10, size: 150 }, // J: Nama
                { start: 10, end: 11, size: 120 }, // K: Link Bukti
                { start: 11, end: 12, size: 260 }, // L: Pesan Asli
            ];
            // Clean any banded ranges (alternating colors) that might bleed outside the table
            const bandedRanges = trxSheet?.bandedRanges || [];
            bandedRanges.forEach((b) => {
                formattingRequests.push({
                    deleteBanding: {
                        bandedRangeId: b.bandedRangeId,
                    },
                });
            });
            // Keep Transaksi columns expanded to 26 (A:Z) to allow custom notes in columns M, N, O, etc.
            formattingRequests.push({
                updateSheetProperties: {
                    properties: {
                        sheetId: trxSheetId,
                        gridProperties: {
                            columnCount: 26,
                        },
                    },
                    fields: "gridProperties.columnCount",
                },
            });
            trxColWidths.forEach((col) => {
                formattingRequests.push({
                    updateDimensionProperties: {
                        range: { sheetId: trxSheetId, dimension: "COLUMNS", startIndex: col.start, endIndex: col.end },
                        properties: { pixelSize: col.size },
                        fields: "pixelSize",
                    },
                });
            });
            // --- Transaksi Sheet Header Formatting (Row 1) ---
            formattingRequests.push({
                repeatCell: {
                    range: { sheetId: trxSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 12 },
                    cell: {
                        userEnteredFormat: {
                            backgroundColor: { red: 0.16, green: 0.29, blue: 0.54 },
                            horizontalAlignment: "CENTER",
                            verticalAlignment: "MIDDLE",
                            textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 1, green: 1, blue: 1 } },
                        },
                    },
                    fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)",
                },
            });
            // --- Transaksi Sheet Data Formatting (Rows 2:1000) - CLEAR DARK TEXT ---
            formattingRequests.push({
                repeatCell: {
                    range: { sheetId: trxSheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: 12 },
                    cell: {
                        userEnteredFormat: {
                            backgroundColor: { red: 1, green: 1, blue: 1 },
                            horizontalAlignment: "LEFT",
                            verticalAlignment: "MIDDLE",
                            textFormat: { bold: false, fontSize: 10, foregroundColor: { red: 0.1, green: 0.1, blue: 0.1 } },
                        },
                    },
                    fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)",
                },
            });
            // Center alignments in Transaksi
            [0, 1, 2, 3, 7, 8, 10].forEach((colIdx) => {
                formattingRequests.push({
                    repeatCell: {
                        range: { sheetId: trxSheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 },
                        cell: {
                            userEnteredFormat: {
                                horizontalAlignment: "CENTER",
                            },
                        },
                        fields: "userEnteredFormat(horizontalAlignment)",
                    },
                });
            });
            // Date format for Tanggal (Col 2)
            formattingRequests.push({
                repeatCell: {
                    range: { sheetId: trxSheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 2, endColumnIndex: 3 },
                    cell: {
                        userEnteredFormat: {
                            horizontalAlignment: "CENTER",
                            numberFormat: { type: "DATE", pattern: "dd/mm/yyyy" },
                        },
                    },
                    fields: "userEnteredFormat(horizontalAlignment,numberFormat)",
                },
            });
            // Currency format for Nominal (Col 6)
            formattingRequests.push({
                repeatCell: {
                    range: { sheetId: trxSheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 6, endColumnIndex: 7 },
                    cell: {
                        userEnteredFormat: {
                            horizontalAlignment: "RIGHT",
                            numberFormat: { type: "CURRENCY", pattern: '"Rp"#,##0' },
                        },
                    },
                    fields: "userEnteredFormat(horizontalAlignment,numberFormat)",
                },
            });
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
        const nowWIB = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
        const cleanPhone = trx.user_phone.startsWith("62") ? "+" + trx.user_phone : trx.user_phone;
        const isInc = isIncome(trx);
        const typeLabel = isInc ? "Pemasukan" : "Pengeluaran";
        const paymentMethod = trx.payment_method || "-";
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
            insertDataOption: "OVERWRITE",
            requestBody: {
                values: [rowData],
            },
        });
        const updatedRange = response.data.updates?.updatedRange || "";
        const rowMatch = updatedRange.match(/\d+$/);
        const rowIndex = rowMatch ? parseInt(rowMatch[0], 10) : 0;
        if (rowIndex > 1) {
            await this.formatTransactionRow(rowIndex, sheetId);
        }
        logger.info({ trxId: trx.id, updatedRange, rowIndex }, "Transaction appended to Google Sheet");
        return { updatedRange, rowIndex };
    }
    async formatTransactionRow(rowIndex, sheetId = config.GOOGLE_SHEET_ID) {
        try {
            const meta = await this.sheetsClient.spreadsheets.get({ spreadsheetId: sheetId });
            const trxSheet = meta.data.sheets?.find((s) => s.properties?.title === this.sheetTitle);
            const trxSheetId = trxSheet?.properties?.sheetId || 0;
            const rIdx = rowIndex - 1; // 0-indexed
            const requests = [
                // Base row formatting: Pure white background, dark text
                {
                    repeatCell: {
                        range: { sheetId: trxSheetId, startRowIndex: rIdx, endRowIndex: rIdx + 1, startColumnIndex: 0, endColumnIndex: 12 },
                        cell: {
                            userEnteredFormat: {
                                backgroundColor: { red: 1, green: 1, blue: 1 },
                                horizontalAlignment: "LEFT",
                                verticalAlignment: "MIDDLE",
                                textFormat: { bold: false, fontSize: 10, foregroundColor: { red: 0.1, green: 0.1, blue: 0.1 } },
                            },
                        },
                        fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)",
                    },
                },
            ];
            // Center alignments (Col A, B, C, D, H, I, K)
            [0, 1, 2, 3, 7, 8, 10].forEach((cIdx) => {
                requests.push({
                    repeatCell: {
                        range: { sheetId: trxSheetId, startRowIndex: rIdx, endRowIndex: rIdx + 1, startColumnIndex: cIdx, endColumnIndex: cIdx + 1 },
                        cell: {
                            userEnteredFormat: {
                                horizontalAlignment: "CENTER",
                            },
                        },
                        fields: "userEnteredFormat(horizontalAlignment)",
                    },
                });
            });
            // Date formatting for Column C (Col 2)
            requests.push({
                repeatCell: {
                    range: { sheetId: trxSheetId, startRowIndex: rIdx, endRowIndex: rIdx + 1, startColumnIndex: 2, endColumnIndex: 3 },
                    cell: {
                        userEnteredFormat: {
                            horizontalAlignment: "CENTER",
                            numberFormat: { type: "DATE", pattern: "dd/mm/yyyy" },
                        },
                    },
                    fields: "userEnteredFormat(horizontalAlignment,numberFormat)",
                },
            });
            // Currency formatting for Column G (Col 6)
            requests.push({
                repeatCell: {
                    range: { sheetId: trxSheetId, startRowIndex: rIdx, endRowIndex: rIdx + 1, startColumnIndex: 6, endColumnIndex: 7 },
                    cell: {
                        userEnteredFormat: {
                            horizontalAlignment: "RIGHT",
                            numberFormat: { type: "CURRENCY", pattern: '"Rp"#,##0' },
                        },
                    },
                    fields: "userEnteredFormat(horizontalAlignment,numberFormat)",
                },
            });
            await this.sheetsClient.spreadsheets.batchUpdate({
                spreadsheetId: sheetId,
                requestBody: { requests },
            });
        }
        catch (err) {
            logger.warn({ err, rowIndex }, "Could not format transaction row");
        }
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
            const paymentMethod = trx.payment_method || "-";
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
    async syncFromSheetToDatabase(trxRepo, sheetId = config.GOOGLE_SHEET_ID) {
        const res = await this.sheetsClient.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: this.sheetTitle + "!A2:L",
        });
        const rows = res.data.values || [];
        const validRows = rows.filter((r) => {
            if (!r || r.length === 0)
                return false;
            const hasId = r[0] && r[0].toString().trim().length > 0;
            const hasContent = (r[5] && r[5].toString().trim().length > 0) || (r[6] && r[6].toString().replace(/[^0-9]/g, "").length > 0);
            return hasId || hasContent;
        });
        const { getSupabaseClient } = await import("../db/supabase.js");
        const supabase = getSupabaseClient();
        await supabase.from("receipt_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
        await supabase.from("transactions").delete().neq("id", "placeholder");
        let syncedCount = 0;
        for (let i = 0; i < validRows.length; i++) {
            const r = validRows[i];
            const rawDateStr = r[2]?.toString().trim() || "";
            const date = normalizeDateToIso(rawDateStr);
            let id = r[0]?.toString().trim();
            if (!id) {
                id = await trxRepo.generateTransactionId(date);
                try {
                    await this.sheetsClient.spreadsheets.values.update({
                        spreadsheetId: sheetId,
                        range: this.sheetTitle + "!A" + (i + 2),
                        valueInputOption: "USER_ENTERED",
                        requestBody: { values: [[id]] },
                    });
                }
                catch (idErr) {
                    logger.warn({ idErr }, "Could not write generated ID back to sheet");
                }
            }
            const typeStr = r[3]?.toString().toLowerCase().trim();
            const isInc = typeStr === "pemasukan";
            const category = r[4]?.toString().trim() || (isInc ? "Pemasukan: Lain-lain" : "Lain-lain");
            const merchant = r[5]?.toString().trim() || "-";
            const rawNominal = r[6]?.toString().replace(/[^0-9]/g, "");
            const nominal = parseInt(rawNominal, 10) || 0;
            const paymentMethod = r[7]?.toString().trim() || "-";
            const fallbackPhone = Array.isArray(config.SUPER_ADMIN_PHONE) ? config.SUPER_ADMIN_PHONE[0] : config.SUPER_ADMIN_PHONE;
            const userPhone = (r[8]?.toString().replace(/[^0-9]/g, "")) || fallbackPhone;
            const userName = r[9]?.toString().trim() || "User";
            const rawText = r[11]?.toString().trim() || "Input Manual Spreadsheet";
            await trxRepo.createTransaction({
                id,
                user_phone: userPhone,
                user_name: userName,
                date,
                merchant,
                category,
                subtotal: nominal,
                tax: 0,
                discount: 0,
                total_amount: nominal,
                payment_method: paymentMethod,
                raw_text: rawText,
                status: isInc ? "income" : "recorded",
                confidence_score: 1.0,
                gsheet_row_index: i + 2,
            });
            syncedCount++;
        }
        await this.setupDashboardTab(sheetId);
        logger.info({ syncedCount }, "Full 2-way sync from Google Sheets to database completed");
        return { syncedCount };
    }
}
export const googleSheetsService = new GoogleSheetsService();
//# sourceMappingURL=sheets.service.js.map