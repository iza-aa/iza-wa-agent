import { google } from "googleapis";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { isIncome } from "../db/repositories/transaction.repository.js";
import { normalizePhoneNumber } from "../utils/phone.utils.js";
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
    rincianTitle = "Rincian Belanja";
    dataRincianTitle = "Data_Rincian";
    logPesanTitle = "Log_Pesan";
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
            // Setup or refresh Rincian Belanja & Data_Rincian tabs
            await this.setupRincianBelanjaTab(sheetId);
            logger.info({ sheetId }, "Google Sheet initialized with Transaksi, Dashboard, and Rincian Belanja");
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
    async appendMessageLog(phone, name, message, messageType = "text", sheetId = "1ozOTR4cRFvhCJhBmnqHVhpak4C1802Ic1C_cZhe7Hi8") {
        try {
            const nowWITA = new Date().toLocaleString("id-ID", { timeZone: "Asia/Makassar" });
            const now = new Date();
            const makassarDate = new Intl.DateTimeFormat("en-GB", {
                timeZone: "Asia/Makassar",
            }).format(now);
            const cleanPhone = phone.startsWith("62") ? "+" + phone : phone;
            const rowData = [
                nowWITA,
                makassarDate,
                cleanPhone,
                name || "User",
                message || "",
                messageType,
            ];
            const response = await this.sheetsClient.spreadsheets.values.append({
                spreadsheetId: sheetId,
                range: this.logPesanTitle + "!A:F",
                valueInputOption: "USER_ENTERED",
                insertDataOption: "OVERWRITE",
                requestBody: {
                    values: [rowData],
                },
            });
            const updates = response.data.updates || {};
            logger.info({
                phone,
                name,
                message,
                updatedRange: updates.updatedRange,
                updatedRows: updates.updatedRows,
                updatedCells: updates.updatedCells,
                updatedColumns: updates.updatedColumns,
                spreadsheetId: updates.spreadsheetId,
                tableRange: response.data.tableRange,
            }, "appendMessageLog API response");
        }
        catch (err) {
            logger.error({ err, phone, message }, "Error appending message log to Google Sheets");
            throw err;
        }
    }
    async appendTransaction(trx, items = [], sheetId = "1ozOTR4cRFvhCJhBmnqHVhpak4C1802Ic1C_cZhe7Hi8") {
        const nowWITA = new Date().toLocaleString("id-ID", { timeZone: "Asia/Makassar" });
        const cleanPhone = trx.user_phone.startsWith("62") ? "+" + trx.user_phone : trx.user_phone;
        const isInc = isIncome(trx);
        const typeLabel = isInc ? "Pemasukan" : "Pengeluaran";
        const paymentMethod = trx.payment_method || "-";
        const cleanRawText = trx.raw_text
            ? trx.raw_text.replace(/\r?\n\s*[-•*]?\s*/g, " • ").replace(/\s+/g, " ").trim()
            : "-";
        // Row format according to Photo 3 (Columns A:L)
        const rowData = [
            trx.id, // A: ID
            nowWITA, // B: Timestamp
            trx.date, // C: Tanggal
            typeLabel, // D: Jenis (Pemasukan / Pengeluaran)
            trx.category, // E: Kategori
            trx.merchant, // F: Keterangan
            trx.total_amount, // G: Nominal
            paymentMethod, // H: Metode (Mandiri, Cash, BRI, BCA, QRIS, dll.)
            cleanPhone, // I: Nomor WhatsApp
            trx.user_name, // J: Nama
            trx.gdrive_web_view_link ? "=HYPERLINK(\"" + trx.gdrive_web_view_link + "\"; \"Lihat Bukti\")" : "-", // K: Link Bukti
            cleanRawText, // L: Pesan Asli (Single-line flat)
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
        if (items && items.length > 0) {
            try {
                await this.appendTransactionItems(trx.id, trx.date, items, trx.user_name, sheetId);
            }
            catch (itemErr) {
                logger.warn({ itemErr, trxId: trx.id }, "Could not append items to Data_Rincian");
            }
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
            // Enforce single-line height (CLIP wrapping & 26px height)
            requests.push({
                repeatCell: {
                    range: { sheetId: trxSheetId, startRowIndex: rIdx, endRowIndex: rIdx + 1, startColumnIndex: 0, endColumnIndex: 12 },
                    cell: {
                        userEnteredFormat: {
                            wrapStrategy: "CLIP",
                            verticalAlignment: "MIDDLE",
                        },
                    },
                    fields: "userEnteredFormat(wrapStrategy,verticalAlignment)",
                },
            });
            requests.push({
                updateDimensionProperties: {
                    range: {
                        sheetId: trxSheetId,
                        dimension: "ROWS",
                        startIndex: rIdx,
                        endIndex: rIdx + 1,
                    },
                    properties: {
                        pixelSize: 26,
                    },
                    fields: "pixelSize",
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
            const nowWITA = new Date().toLocaleString("id-ID", { timeZone: "Asia/Makassar" });
            const isInc = isIncome(trx);
            const typeLabel = isInc ? "Pemasukan" : "Pengeluaran";
            const paymentMethod = trx.payment_method || "-";
            const updatedRowData = [
                trx.id, // A: ID
                nowWITA, // B: Timestamp
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
            // Also cascade delete from Data_Rincian
            try {
                const dRes = await this.sheetsClient.spreadsheets.values.get({
                    spreadsheetId: sheetId,
                    range: this.dataRincianTitle + "!A2:I",
                });
                const dRows = (dRes.data.values || []).filter((r) => r[0] && r[3]);
                const keptDRows = dRows.filter((r) => (r[1] || "").toString().trim() !== trxId);
                if (keptDRows.length !== dRows.length) {
                    await this.sheetsClient.spreadsheets.values.clear({
                        spreadsheetId: sheetId,
                        range: this.dataRincianTitle + "!A2:I" + Math.max(dRows.length + 1, 50),
                    });
                    if (keptDRows.length > 0) {
                        await this.sheetsClient.spreadsheets.values.update({
                            spreadsheetId: sheetId,
                            range: this.dataRincianTitle + "!A2:I" + (keptDRows.length + 1),
                            valueInputOption: "USER_ENTERED",
                            requestBody: {
                                values: keptDRows,
                            },
                        });
                    }
                    await this.renderRincianBelanjaSheet(sheetId);
                    logger.info({ trxId }, "Cascade deleted items from Data_Rincian and refreshed Rincian Belanja");
                }
            }
            catch (dErr) {
                logger.warn({ dErr, trxId }, "Could not cascade delete from Data_Rincian");
            }
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
        if (validRows.length === 0) {
            logger.warn("No valid rows found in Google Sheet during sync, skipping database wipe to protect data integrity");
            return { syncedCount: 0 };
        }
        const { getSupabaseClient } = await import("../db/supabase.js");
        const supabase = getSupabaseClient();
        const trxPayloads = [];
        const validIds = [];
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
            validIds.push(id);
            const typeStr = r[3]?.toString().toLowerCase().trim();
            const isInc = typeStr === "pemasukan";
            const category = r[4]?.toString().trim() || (isInc ? "Pemasukan: Lain-lain" : "Lain-lain");
            const merchant = r[5]?.toString().trim() || "-";
            const rawNominal = r[6]?.toString().replace(/[^0-9]/g, "");
            const nominal = parseInt(rawNominal, 10) || 0;
            const paymentMethod = r[7]?.toString().trim() || "-";
            const fallbackPhone = Array.isArray(config.SUPER_ADMIN_PHONE) ? config.SUPER_ADMIN_PHONE[0] : config.SUPER_ADMIN_PHONE;
            const userPhone = normalizePhoneNumber(r[8]?.toString() || fallbackPhone) || fallbackPhone;
            const userName = r[9]?.toString().trim() || "User";
            const rawText = r[11]?.toString().trim() || "Input Manual Spreadsheet";
            trxPayloads.push({
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
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            });
        }
        // 1. Batch upsert transactions (Zero downtime - takes ~50ms instead of 15 seconds)
        const CHUNK_SIZE = 50;
        for (let c = 0; c < trxPayloads.length; c += CHUNK_SIZE) {
            const chunk = trxPayloads.slice(c, c + CHUNK_SIZE);
            await supabase.from("transactions").upsert(chunk, { onConflict: "id" });
        }
        // 2. Clean up transactions deleted from sheet
        const { data: dbTrxs } = await supabase.from("transactions").select("id");
        const dbIds = (dbTrxs || []).map((t) => t.id);
        const idsToDelete = dbIds.filter((dbId) => !validIds.includes(dbId));
        if (idsToDelete.length > 0) {
            await supabase.from("transactions").delete().in("id", idsToDelete);
        }
        const syncedCount = trxPayloads.length;
        // 3. Sync items from Data_Rincian tab to Supabase & Purge orphaned items
        try {
            const rincianRes = await this.sheetsClient.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: this.dataRincianTitle + "!A2:I",
            });
            let rincianRows = (rincianRes.data.values || []).filter((r) => r[0] && r[3]);
            // If transactions were deleted from Transaksi, also purge them from Data_Rincian
            if (idsToDelete.length > 0) {
                const keptRincian = rincianRows.filter((r) => !idsToDelete.includes((r[1] || "").toString().trim()));
                if (keptRincian.length !== rincianRows.length) {
                    await this.sheetsClient.spreadsheets.values.clear({
                        spreadsheetId: sheetId,
                        range: this.dataRincianTitle + "!A2:I" + Math.max(rincianRows.length + 1, 50),
                    });
                    if (keptRincian.length > 0) {
                        await this.sheetsClient.spreadsheets.values.update({
                            spreadsheetId: sheetId,
                            range: this.dataRincianTitle + "!A2:I" + (keptRincian.length + 1),
                            valueInputOption: "USER_ENTERED",
                            requestBody: {
                                values: keptRincian,
                            },
                        });
                    }
                    rincianRows = keptRincian;
                    await this.renderRincianBelanjaSheet(sheetId);
                    logger.info({ idsToDelete }, "Purged deleted transactions from Data_Rincian");
                }
            }
            await supabase.from("receipt_items").delete().neq("id", "00000000-0000-0000-0000-000000000000");
            if (rincianRows.length > 0) {
                const itemsPayload = rincianRows.map((row) => {
                    const trxId = row[1]?.toString().trim();
                    const itemName = row[3]?.toString().trim();
                    const qtyStr = row[4]?.toString().trim() || "1 unit";
                    const qtyMatch = qtyStr.match(/^(\d+)\s*(.*)$/);
                    const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
                    const unit = qtyMatch && qtyMatch[2] ? qtyMatch[2].trim() : "unit";
                    const rawPrice = row[5]?.toString().replace(/[^0-9]/g, "");
                    const totalPrice = parseInt(rawPrice, 10) || 0;
                    const dept = row[6]?.toString().trim() || "Kafe";
                    return {
                        transaction_id: trxId,
                        item_name: `${itemName}${unit !== "unit" ? ` (${qty} ${unit})` : ""}`,
                        qty,
                        price: qty > 0 ? Math.round(totalPrice / qty) : totalPrice,
                        total_price: totalPrice,
                        category: (["Dapur", "Barista", "Waiters", "Kasir", "Kafe"].includes(dept) ? dept : "Kafe"),
                    };
                });
                await supabase.from("receipt_items").insert(itemsPayload);
                logger.info({ itemsCount: itemsPayload.length }, "Synced Data_Rincian items to Supabase");
            }
        }
        catch (rincianErr) {
            logger.warn({ rincianErr }, "Could not sync Data_Rincian items to Supabase");
        }
        await this.setupDashboardTab(sheetId);
        await this.setupRincianBelanjaTab(sheetId);
        logger.info({ syncedCount }, "Full 2-way sync from Google Sheets to database completed");
        return { syncedCount };
    }
    async appendTransactionItems(trxId, date, items, userName = "User", sheetId = config.GOOGLE_SHEET_ID) {
        if (!items || items.length === 0)
            return;
        // Ensure Data_Rincian exists
        await this.setupRincianBelanjaTab(sheetId);
        const rows = items.map((it, idx) => {
            const uniqueId = `${trxId}-I${String(idx + 1).padStart(2, "0")}`;
            const qtyUnit = it.unit && it.unit !== "unit" ? `${it.qty} ${it.unit}` : `${it.qty || 1} unit`;
            const dept = it.department || it.category || "Kafe";
            const itemPrice = it.total_price || ((it.qty || 1) * it.price);
            return [
                uniqueId, // A: ID Item
                trxId, // B: ID Transaksi
                date, // C: Tanggal
                it.item_name, // D: Jenis Belanja
                qtyUnit, // E: Jumlah Satuan
                itemPrice, // F: Harga
                dept, // G: Keperluan
                it.notes || "-", // H: Keterangan
                userName, // I: Penginput
            ];
        });
        await this.sheetsClient.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: this.dataRincianTitle + "!A:I",
            valueInputOption: "USER_ENTERED",
            insertDataOption: "OVERWRITE",
            requestBody: {
                values: rows,
            },
        });
        logger.info({ trxId, itemsCount: items.length }, "Appended items to Data_Rincian sheet");
        // Automatically refresh the visual Rincian Belanja table
        await this.renderRincianBelanjaSheet(sheetId);
    }
    async renderRincianBelanjaSheet(sheetId = config.GOOGLE_SHEET_ID) {
        try {
            // 1. Get current filter values from B2:F2
            const filterRes = await this.sheetsClient.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: "'Rincian Belanja'!B2:F2",
            });
            const filterRow = filterRes.data.values?.[0] || [];
            const filterId = (filterRow[0] || "").toString().trim();
            const filterDate = (filterRow[2] || "").toString().trim();
            const filterDept = (filterRow[4] || "").toString().trim();
            // 2. Fetch Data_Rincian
            const dataRes = await this.sheetsClient.spreadsheets.values.get({
                spreadsheetId: sheetId,
                range: "'Data_Rincian'!A2:I500",
            });
            const dataRows = (dataRes.data.values || []).filter((r) => r[0] && r[3]);
            // 3. Filter matching rows
            const displayRows = [];
            const trackerIds = [];
            for (let i = 0; i < dataRows.length; i++) {
                const r = dataRows[i];
                const dItemId = r[0];
                const dTrxId = (r[1] || "").toString().trim();
                const dDate = (r[2] || "").toString().trim();
                const dItemName = r[3];
                const dQty = r[4];
                const dPrice = r[5];
                const dDept = (r[6] || "").toString().trim();
                const dNotes = r[7] || "-";
                if (filterId && filterId !== "SEMUA" && dTrxId !== filterId)
                    continue;
                if (filterDate && filterDate !== "SEMUA" && filterDate !== "-" && dDate !== filterDate)
                    continue;
                if (filterDept && filterDept !== "SEMUA" && dDept.toLowerCase() !== filterDept.toLowerCase())
                    continue;
                const shortId = dTrxId.replace(/^T\d+-/, "");
                const submitter = (r[8] || "").toString().trim();
                const customNote = dNotes && dNotes !== "-" ? dNotes : "";
                const noteDisplay = shortId
                    ? (customNote ? `[${shortId}] ${customNote}` : (submitter ? `[${shortId}] ${submitter}` : `[${shortId}]`))
                    : (dNotes || "-");
                displayRows.push([
                    displayRows.length + 1,
                    dDate,
                    dItemName,
                    dQty,
                    dPrice,
                    dDept,
                    noteDisplay,
                ]);
                trackerIds.push([dItemId]);
            }
            // 4. Update Rincian Belanja table (A5:G for visible data, L5:L for hidden tracker)
            await this.sheetsClient.spreadsheets.values.clear({
                spreadsheetId: sheetId,
                range: "'Rincian Belanja'!A5:G36",
            });
            await this.sheetsClient.spreadsheets.values.clear({
                spreadsheetId: sheetId,
                range: "'Rincian Belanja'!L5:L36",
            });
            if (displayRows.length > 0) {
                await this.sheetsClient.spreadsheets.values.update({
                    spreadsheetId: sheetId,
                    range: "'Rincian Belanja'!A5:G" + (displayRows.length + 4),
                    valueInputOption: "USER_ENTERED",
                    requestBody: {
                        values: displayRows,
                    },
                });
                await this.sheetsClient.spreadsheets.values.update({
                    spreadsheetId: sheetId,
                    range: "'Rincian Belanja'!L5:L" + (trackerIds.length + 4),
                    valueInputOption: "USER_ENTERED",
                    requestBody: {
                        values: trackerIds,
                    },
                });
            }
        }
        catch (err) {
            logger.warn({ err }, "Could not auto-render Rincian Belanja sheet");
        }
    }
    async setupRincianBelanjaTab(sheetId = config.GOOGLE_SHEET_ID) {
        try {
            const spreadsheet = await this.sheetsClient.spreadsheets.get({
                spreadsheetId: sheetId,
            });
            const existingSheets = spreadsheet.data.sheets || [];
            // 1. Ensure 'Data_Rincian' sheet exists
            let dataRincianSheet = existingSheets.find((s) => s.properties?.title === this.dataRincianTitle);
            if (!dataRincianSheet) {
                const addData = await this.sheetsClient.spreadsheets.batchUpdate({
                    spreadsheetId: sheetId,
                    requestBody: {
                        requests: [
                            {
                                addSheet: {
                                    properties: {
                                        title: this.dataRincianTitle,
                                        gridProperties: {
                                            frozenRowCount: 1,
                                            rowCount: 500,
                                            columnCount: 12,
                                        },
                                    },
                                },
                            },
                        ],
                    },
                });
                dataRincianSheet = addData.data.replies?.[0]?.addSheet;
            }
            // Headers for Data_Rincian (A1:I1 only, never overwrite row 2 data)
            const dataHeaders = [
                "ID Item", // A
                "ID Transaksi", // B
                "Tanggal", // C
                "Jenis Belanja", // D
                "Jumlah Satuan", // E
                "Harga", // F
                "Keperluan", // G (Dapur, Barista, Waiters, Kasir, Kafe)
                "Keterangan", // H
                "Penginput", // I
            ];
            await this.sheetsClient.spreadsheets.values.update({
                spreadsheetId: sheetId,
                range: this.dataRincianTitle + "!A1:I1",
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [dataHeaders],
                },
            });
            // Dropdown validation sources (K1:L2 only)
            await this.sheetsClient.spreadsheets.values.update({
                spreadsheetId: sheetId,
                range: this.dataRincianTitle + "!K1:L2",
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [
                        ["ID_Pengeluaran", "Tanggal_Pengeluaran"],
                        [
                            '={"SEMUA"; IFERROR(FILTER(Transaksi!A2:A; Transaksi!D2:D="Pengeluaran"; Transaksi!A2:A<>""); "")}',
                            '={"SEMUA"; IFERROR(UNIQUE(FILTER(TEXT(Transaksi!C2:C; "yyyy-mm-dd"); Transaksi!D2:D="Pengeluaran"; Transaksi!C2:C<>"")); "")}',
                        ],
                    ],
                },
            });
            // 2. Ensure 'Rincian Belanja' sheet exists
            let rincianSheet = existingSheets.find((s) => s.properties?.title === this.rincianTitle);
            // If Rincian Belanja already exists, do not overwrite user's custom formatting
            if (rincianSheet) {
                logger.info({ sheetId }, "Rincian Belanja tab already exists - preserving user custom layout");
                return;
            }
            let rincianSheetId;
            const addRincian = await this.sheetsClient.spreadsheets.batchUpdate({
                spreadsheetId: sheetId,
                requestBody: {
                    requests: [
                        {
                            addSheet: {
                                properties: {
                                    title: this.rincianTitle,
                                    gridProperties: {
                                        rowCount: 60,
                                        columnCount: 10,
                                        frozenRowCount: 4,
                                    },
                                },
                            },
                        },
                    ],
                },
            });
            rincianSheetId = addRincian.data.replies?.[0]?.addSheet?.properties?.sheetId || 0;
            // Build values for Rincian Belanja tab matching user's photo
            const rincianValues = [];
            // Row 1: Title
            rincianValues.push(["BELANJA HARIAN", "", "", "", "", "", ""]);
            // Row 2: Control Selector (ID Dropdown + Native Calendar Popup + Divisi Dropdown + Reset Filter Button)
            rincianValues.push([
                "🔘 ID PENGELUARAN:",
                "SEMUA",
                "📅 FILTER TANGGAL:",
                "",
                "🏷️ KEPERLUAN:",
                "SEMUA",
                '=IF(AND(B2<>""; B2<>"SEMUA"); IFERROR("📅 Tgl: " & TEXT(VLOOKUP(B2; Transaksi!A:C; 3; FALSE); "dd/mm/yyyy") & " | 👤 " & VLOOKUP(B2; Transaksi!A:J; 10; FALSE) & " | 💰 " & TEXT(VLOOKUP(B2; Transaksi!A:G; 7; FALSE); "Rp #,##0"); "-"); IF(ISDATE(D2); "📅 Belanja Tgl: " & TEXT(D2; "dd/mm/yyyy"); "💡 Klik 2x sel D2 untuk buka kalender"))',
                false,
                "🔄 RESET FILTER",
            ]);
            // Row 3: Spacer
            rincianValues.push(["", "", "", "", "", "", "", "", ""]);
            // Row 4: Table Headers
            rincianValues.push([
                "NO.",
                "TANGGAL PEMBELIAN",
                "JENIS BELANJA",
                "JUMLAH SATUAN",
                "HARGA",
                "KEPERLUAN",
                "KETERANGAN",
                "",
                "",
            ]);
            // Row 5: Dynamic Multi-Filter Query
            rincianValues.push([
                '=IF(B5<>""; 1; "")',
                '=IFERROR(FILTER(Data_Rincian!C2:H; (Data_Rincian!A2:A<>"") * (IF(OR(B2=""; B2="SEMUA"); 1; Data_Rincian!B2:B=B2)) * (IF(OR(D2=""; D2="SEMUA"; D2="-"); 1; (Data_Rincian!C2:C=D2) + (TEXT(Data_Rincian!C2:C; "yyyy-mm-dd")=TEXT(D2; "yyyy-mm-dd")) + (Data_Rincian!C2:C=TEXT(D2; "yyyy-mm-dd")))) * (IF(OR(F2=""; F2="SEMUA"); 1; UPPER(Data_Rincian!G2:G)=UPPER(F2)))); "")',
                "",
                "",
                "",
                "",
                "",
                "",
                "",
            ]);
            // Rows 6..35: Numbering formulas
            for (let r = 6; r <= 35; r++) {
                rincianValues.push([`=IF(B${r}<>""; ${r - 4}; "")`, "", "", "", "", "", "", "", ""]);
            }
            // Row 36: Empty Spacer
            rincianValues.push(["", "", "", "", "", "", "", "", ""]);
            // Row 37: Subtotal Baris
            rincianValues.push(["JUMLAH", "", "", "", '=SUM(E5:E35)', "", "", "", ""]);
            // Row 38..43: Breakdown per Keperluan (Sesuai Foto)
            rincianValues.push(["JUMLAH  PENGELUARAN", "", "", "DAPUR", '=SUMIFS(E5:E35; F5:F35; "Dapur")', "", "", "", ""]);
            rincianValues.push(["", "", "", "BARISTA", '=SUMIFS(E5:E35; F5:F35; "Barista")', "", "", "", ""]);
            rincianValues.push(["", "", "", "WAITERS", '=SUMIFS(E5:E35; F5:F35; "Waiters")', "", "", "", ""]);
            rincianValues.push(["", "", "", "KASIR", '=SUMIFS(E5:E35; F5:F35; "Kasir")', "", "", "", ""]);
            rincianValues.push(["", "", "", "KAFE", '=SUMIFS(E5:E35; F5:F35; "Kafe")', "", "", "", ""]);
            rincianValues.push(["", "", "", "JUMLAH", '=SUM(E38:E42)', "", "", "", ""]);
            await this.sheetsClient.spreadsheets.values.update({
                spreadsheetId: sheetId,
                range: this.rincianTitle + "!A1:I43",
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: rincianValues,
                },
            });
            // Format cells, merges, borders, and styles
            if (rincianSheetId !== undefined) {
                const formatRequests = [
                    // 1. Merge Title A1:G1
                    {
                        mergeCells: {
                            range: { sheetId: rincianSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 },
                            mergeType: "MERGE_ALL",
                        },
                    },
                    // 2. Title Styling (A1:G1)
                    {
                        repeatCell: {
                            range: { sheetId: rincianSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 },
                            cell: {
                                userEnteredFormat: {
                                    horizontalAlignment: "CENTER",
                                    verticalAlignment: "MIDDLE",
                                    textFormat: { bold: true, fontSize: 13, foregroundColor: { red: 0.1, green: 0.1, blue: 0.1 } },
                                },
                            },
                            fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat)",
                        },
                    },
                    // 3. Control Row (A2:G2) Styling
                    {
                        repeatCell: {
                            range: { sheetId: rincianSheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 7 },
                            cell: {
                                userEnteredFormat: {
                                    backgroundColor: { red: 0.95, green: 0.96, blue: 0.98 },
                                    verticalAlignment: "MIDDLE",
                                    textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 0.15, green: 0.2, blue: 0.3 } },
                                },
                            },
                            fields: "userEnteredFormat(backgroundColor,verticalAlignment,textFormat)",
                        },
                    },
                    // 4. Data Validation: ID Pengeluaran Dropdown on B2 (Only Pengeluaran IDs)
                    {
                        setDataValidation: {
                            range: {
                                sheetId: rincianSheetId,
                                startRowIndex: 1,
                                endRowIndex: 2,
                                startColumnIndex: 1,
                                endColumnIndex: 2,
                            },
                            rule: {
                                condition: {
                                    type: "ONE_OF_RANGE",
                                    values: [{ userEnteredValue: "=Data_Rincian!K2:K" }],
                                },
                                showCustomUi: true,
                                strict: false,
                            },
                        },
                    },
                    // 5. Data Validation: Native Calendar Popup on D2 (Cell D2)
                    {
                        setDataValidation: {
                            range: {
                                sheetId: rincianSheetId,
                                startRowIndex: 1,
                                endRowIndex: 2,
                                startColumnIndex: 3,
                                endColumnIndex: 4,
                            },
                            rule: {
                                condition: {
                                    type: "DATE_IS_VALID",
                                },
                                inputMessage: "Klik ganda (double click) untuk memilih tanggal dari kalender pop-up",
                                showCustomUi: true,
                                strict: false,
                            },
                        },
                    },
                    // 5b. Date format for Cell D2
                    {
                        repeatCell: {
                            range: { sheetId: rincianSheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 3, endColumnIndex: 4 },
                            cell: {
                                userEnteredFormat: {
                                    horizontalAlignment: "CENTER",
                                    numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" },
                                },
                            },
                            fields: "userEnteredFormat(horizontalAlignment,numberFormat)",
                        },
                    },
                    // 6. Data Validation: Department / Keperluan Dropdown on F2 (Cell F2)
                    {
                        setDataValidation: {
                            range: {
                                sheetId: rincianSheetId,
                                startRowIndex: 1,
                                endRowIndex: 2,
                                startColumnIndex: 5,
                                endColumnIndex: 6,
                            },
                            rule: {
                                condition: {
                                    type: "ONE_OF_LIST",
                                    values: [
                                        { userEnteredValue: "SEMUA" },
                                        { userEnteredValue: "Dapur" },
                                        { userEnteredValue: "Barista" },
                                        { userEnteredValue: "Waiters" },
                                        { userEnteredValue: "Kasir" },
                                        { userEnteredValue: "Kafe" },
                                    ],
                                },
                                showCustomUi: true,
                                strict: false,
                            },
                        },
                    },
                    // 6b. Checkbox validation on H2 (Reset Filter)
                    {
                        setDataValidation: {
                            range: {
                                sheetId: rincianSheetId,
                                startRowIndex: 1,
                                endRowIndex: 2,
                                startColumnIndex: 7,
                                endColumnIndex: 8,
                            },
                            rule: {
                                condition: {
                                    type: "BOOLEAN",
                                },
                                showCustomUi: true,
                            },
                        },
                    },
                    // 6c. Styling Reset Button H2:I2
                    {
                        repeatCell: {
                            range: {
                                sheetId: rincianSheetId,
                                startRowIndex: 1,
                                endRowIndex: 2,
                                startColumnIndex: 7,
                                endColumnIndex: 9,
                            },
                            cell: {
                                userEnteredFormat: {
                                    backgroundColor: { red: 0.90, green: 0.93, blue: 0.97 },
                                    verticalAlignment: "MIDDLE",
                                    textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 0.1, green: 0.25, blue: 0.5 } },
                                },
                            },
                            fields: "userEnteredFormat(backgroundColor,verticalAlignment,textFormat)",
                        },
                    },
                    // 6d. Border for Reset Button H2:I2
                    {
                        updateBorders: {
                            range: {
                                sheetId: rincianSheetId,
                                startRowIndex: 1,
                                endRowIndex: 2,
                                startColumnIndex: 7,
                                endColumnIndex: 9,
                            },
                            top: { style: "SOLID", width: 1, color: { red: 0.6, green: 0.7, blue: 0.85 } },
                            bottom: { style: "SOLID", width: 1, color: { red: 0.6, green: 0.7, blue: 0.85 } },
                            left: { style: "SOLID", width: 1, color: { red: 0.6, green: 0.7, blue: 0.85 } },
                            right: { style: "SOLID", width: 1, color: { red: 0.6, green: 0.7, blue: 0.85 } },
                        },
                    },
                    // 7. Table Header (A4:G4) Styling
                    {
                        repeatCell: {
                            range: { sheetId: rincianSheetId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 7 },
                            cell: {
                                userEnteredFormat: {
                                    backgroundColor: { red: 0.92, green: 0.94, blue: 0.96 },
                                    horizontalAlignment: "CENTER",
                                    verticalAlignment: "MIDDLE",
                                    textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 0.1, green: 0.1, blue: 0.1 } },
                                },
                            },
                            fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)",
                        },
                    },
                    // 8. Table Data Rows (A5:G35) Borders & Alignments
                    {
                        updateBorders: {
                            range: { sheetId: rincianSheetId, startRowIndex: 3, endRowIndex: 35, startColumnIndex: 0, endColumnIndex: 7 },
                            top: { style: "SOLID", width: 1, color: { red: 0.7, green: 0.7, blue: 0.7 } },
                            bottom: { style: "SOLID", width: 1, color: { red: 0.7, green: 0.7, blue: 0.7 } },
                            left: { style: "SOLID", width: 1, color: { red: 0.7, green: 0.7, blue: 0.7 } },
                            right: { style: "SOLID", width: 1, color: { red: 0.7, green: 0.7, blue: 0.7 } },
                            innerHorizontal: { style: "SOLID", width: 1, color: { red: 0.85, green: 0.85, blue: 0.85 } },
                            innerVertical: { style: "SOLID", width: 1, color: { red: 0.85, green: 0.85, blue: 0.85 } },
                        },
                    },
                    // 9. Number formatting for Currency Column E (Col 4)
                    {
                        repeatCell: {
                            range: { sheetId: rincianSheetId, startRowIndex: 4, endRowIndex: 43, startColumnIndex: 4, endColumnIndex: 5 },
                            cell: {
                                userEnteredFormat: {
                                    horizontalAlignment: "RIGHT",
                                    numberFormat: { type: "CURRENCY", pattern: '"Rp"#,##0' },
                                },
                            },
                            fields: "userEnteredFormat(horizontalAlignment,numberFormat)",
                        },
                    },
                    // 10. Center alignment for No (Col A), Tanggal (Col B), Qty (Col D), Keperluan (Col F)
                    ...([0, 1, 3, 5].map((cIdx) => ({
                        repeatCell: {
                            range: { sheetId: rincianSheetId, startRowIndex: 4, endRowIndex: 35, startColumnIndex: cIdx, endColumnIndex: cIdx + 1 },
                            cell: {
                                userEnteredFormat: {
                                    horizontalAlignment: "CENTER",
                                },
                            },
                            fields: "userEnteredFormat(horizontalAlignment)",
                        },
                    }))),
                    // 11. Merge Summary Row 37: A37:D37 "JUMLAH"
                    {
                        mergeCells: {
                            range: { sheetId: rincianSheetId, startRowIndex: 36, endRowIndex: 37, startColumnIndex: 0, endColumnIndex: 4 },
                            mergeType: "MERGE_ALL",
                        },
                    },
                    // 12. Merge Summary Row 38..42: A38:C42 "JUMLAH  PENGELUARAN"
                    {
                        mergeCells: {
                            range: { sheetId: rincianSheetId, startRowIndex: 37, endRowIndex: 42, startColumnIndex: 0, endColumnIndex: 3 },
                            mergeType: "MERGE_ALL",
                        },
                    },
                    // 13. Merge Row 43: A43:C43
                    {
                        mergeCells: {
                            range: { sheetId: rincianSheetId, startRowIndex: 42, endRowIndex: 43, startColumnIndex: 0, endColumnIndex: 3 },
                            mergeType: "MERGE_ALL",
                        },
                    },
                    // 14. Summary Borders (Row 37..43)
                    {
                        updateBorders: {
                            range: { sheetId: rincianSheetId, startRowIndex: 36, endRowIndex: 43, startColumnIndex: 0, endColumnIndex: 7 },
                            top: { style: "DOUBLE", width: 2, color: { red: 0.2, green: 0.2, blue: 0.2 } },
                            bottom: { style: "DOUBLE", width: 2, color: { red: 0.2, green: 0.2, blue: 0.2 } },
                            left: { style: "SOLID", width: 1, color: { red: 0.2, green: 0.2, blue: 0.2 } },
                            right: { style: "SOLID", width: 1, color: { red: 0.2, green: 0.2, blue: 0.2 } },
                            innerHorizontal: { style: "SOLID", width: 1, color: { red: 0.7, green: 0.7, blue: 0.7 } },
                            innerVertical: { style: "SOLID", width: 1, color: { red: 0.7, green: 0.7, blue: 0.7 } },
                        },
                    },
                ];
                await this.sheetsClient.spreadsheets.batchUpdate({
                    spreadsheetId: sheetId,
                    requestBody: { requests: formatRequests },
                });
            }
            logger.info({ sheetId }, "Rincian Belanja and Data_Rincian tabs initialized matching reference design");
        }
        catch (err) {
            logger.error({ err, sheetId }, "Failed to setup Rincian Belanja tab");
        }
    }
}
export const googleSheetsService = new GoogleSheetsService();
//# sourceMappingURL=sheets.service.js.map