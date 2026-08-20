import { google } from "googleapis";
import { config } from "../src/config/env.js";

export async function setupExactDashboard(sheetId: string = config.GOOGLE_SHEET_ID) {
  const auth = new google.auth.JWT({
    email: config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: config.GOOGLE_PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const existingSheets = spreadsheet.data.sheets || [];

  // 1. Ensure 'Transaksi' sheet exists
  let trxSheet = existingSheets.find((s: any) => s.properties?.title === "Transaksi");
  if (!trxSheet) {
    const oldSheet = existingSheets.find((s: any) => s.properties?.title === "Data Transaksi");
    if (oldSheet) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId: oldSheet.properties.sheetId,
                  title: "Transaksi",
                },
                fields: "title",
              },
            },
          ],
        },
      });
      trxSheet = oldSheet;
    } else {
      const addRes = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: "Transaksi",
                  gridProperties: { frozenRowCount: 1 },
                },
              },
            },
          ],
        },
      });
      trxSheet = addRes.data.replies?.[0]?.addSheet;
    }
  }

  // Ensure Headers in Transaksi (A1:L1)
  const trxHeaders = [
    "ID",
    "Timestamp",
    "Tanggal",
    "Jenis",
    "Kategori",
    "Keterangan",
    "Nominal",
    "Metode",
    "Nomor WhatsApp",
    "Nama",
    "Link Bukti",
    "Pesan Asli",
  ];
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "Transaksi!A1:L1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [trxHeaders] },
  });

  // 2. Recreate or ensure clean 'Dashboard' sheet
  const oldDash = existingSheets.find(
    (s: any) => s.properties?.title === "Dashboard" || s.properties?.title === "Dasbor"
  );
  if (oldDash) {
    await sheets.spreadsheets.batchUpdate({
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

  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: "Dashboard",
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

  // 3. Write Dashboard Values & Formulas (Indonesian Locale)
  const dashboardValues = [
    // Row 1 (Index 0): Empty
    ["", "", "", "", "", "", "", "", "", "", "", ""],
    // Row 2 (Index 1): Header Banner
    ["DASHBOARD KEUANGAN", "", "", "", "", "", "", "", "", "", "", ""],
    // Row 3 (Index 2): Top KPI Headers
    ["TOTAL PEMASUKAN", "", "TOTAL PENGELUARAN", "", "SALDO / SELISIH", "", "TRANSAKSI", "", "", "", "", ""],
    // Row 4 (Index 3): Top KPI Values
    [
      '=SUMIF(Transaksi!D2:D; "Pemasukan"; Transaksi!G2:G)',
      "",
      '=SUMIF(Transaksi!D2:D; "Pengeluaran"; Transaksi!G2:G)',
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
    // Row 5 (Index 4): Empty (part of merged value row)
    ["", "", "", "", "", "", "", "", "", "", "", ""],
    // Row 6 (Index 5): Blank separator
    ["", "", "", "", "", "", "", "", "", "", "", ""],
    // Row 7 (Index 6): Monthly Section Banner
    ['=CONCATENATE("RINGKASAN BULAN "; UPPER(TEXT(TODAY(); "MMMM YYYY")))', "", "", "", "", "", "", "", "", "", "", ""],
    // Row 8 (Index 7): Monthly Headers
    ["Pemasukan", "", "Pengeluaran", "", "Selisih", "", "Transaksi", "", "", "", "", ""],
    // Row 9 (Index 8): Monthly Values
    [
      '=SUMIFS(Transaksi!G2:G; Transaksi!D2:D; "Pemasukan"; Transaksi!C2:C; ">="&TEXT(TODAY(); "YYYY-MM")&"-01"; Transaksi!C2:C; "<="&TEXT(TODAY(); "YYYY-MM")&"-31")',
      "",
      '=SUMIFS(Transaksi!G2:G; Transaksi!D2:D; "Pengeluaran"; Transaksi!C2:C; ">="&TEXT(TODAY(); "YYYY-MM")&"-01"; Transaksi!C2:C; "<="&TEXT(TODAY(); "YYYY-MM")&"-31")',
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
    // Row 10 (Index 9): Empty (part of merged monthly value row)
    ["", "", "", "", "", "", "", "", "", "", "", ""],
    // Row 11 (Index 10): Blank separator
    ["", "", "", "", "", "", "", "", "", "", "", ""],
    // Row 12 (Index 11): Section Titles
    ["TRANSAKSI TERBARU", "", "", "", "Pengeluaran per Kategori - Bulan Ini", "", "", "", "", "", "", ""],
    // Row 13 (Index 12): Table Headers
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
    // Row 14 (Index 13): Live Query for Transaksi Terbaru and Category Query for Pie Chart
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

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: "Dashboard!A1:L14",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: dashboardValues },
  });

  // 4. Batch Formatting: Merges, Borders, Colors, Fonts, and Pie Chart
  const requests: any[] = [
    // Merge Header Banner A2:H2 (Row 1, Cols 0-8)
    {
      mergeCells: {
        range: {
          sheetId: dashSheetId,
          startRowIndex: 1,
          endRowIndex: 2,
          startColumnIndex: 0,
          endColumnIndex: 8,
        },
        mergeType: "MERGE_ALL",
      },
    },
    // Merge Top KPI Headers (Row 2, Cols 0-2, 2-4, 4-6, 6-8)
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
    // Merge Top KPI Values (Rows 3-5, Cols 0-2, 2-4, 4-6, 6-8)
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
    // Merge Monthly Section Banner A7:H7 (Row 6, Cols 0-8)
    {
      mergeCells: {
        range: { sheetId: dashSheetId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 0, endColumnIndex: 8 },
        mergeType: "MERGE_ALL",
      },
    },
    // Merge Monthly Headers (Row 7, Cols 0-2, 2-4, 4-6, 6-8)
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
    // Merge Monthly Values (Rows 8-10, Cols 0-2, 2-4, 4-6, 6-8)
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

    // --- Styling Header Banner (Row 1) ---
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

    // --- Styling Top KPI Headers (Row 2) ---
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

    // --- Styling Top KPI Values (Rows 3-5) ---
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

    // --- Styling Monthly Banner (Row 6) ---
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

    // --- Styling Monthly Headers (Row 7) ---
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

    // --- Styling Monthly Values (Rows 8-10) ---
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

    // --- Styling Section Titles (Row 11) ---
    {
      repeatCell: {
        range: { sheetId: dashSheetId, startRowIndex: 11, endRowIndex: 12, startColumnIndex: 0, endColumnIndex: 1 },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: "LEFT",
            verticalAlignment: "MIDDLE",
            textFormat: { bold: true, fontSize: 12, foregroundColor: { red: 0.1, green: 0.1, blue: 0.1 } },
          },
        },
        fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat)",
      },
    },

    // --- Styling Transaksi Terbaru Headers (Row 12, Cols 0-4) ---
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

    // --- Styling Date Column in Transaksi Terbaru (Rows 13-35, Col 0) ---
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

    // --- Styling Nominal Column in Transaksi Terbaru (Rows 13-35, Col 3) ---
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

    // Borders for Top Cards
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
    // Borders for Monthly Summary Card
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
    // Borders for Transaksi Terbaru Table Header
    {
      updateBorders: {
        range: { sheetId: dashSheetId, startRowIndex: 12, endRowIndex: 13, startColumnIndex: 0, endColumnIndex: 4 },
        top: { style: "SOLID", color: { red: 0.8, green: 0.8, blue: 0.8 } },
        bottom: { style: "SOLID", color: { red: 0.8, green: 0.8, blue: 0.8 } },
        left: { style: "SOLID", color: { red: 0.8, green: 0.8, blue: 0.8 } },
        right: { style: "SOLID", color: { red: 0.8, green: 0.8, blue: 0.8 } },
        innerVertical: { style: "SOLID", color: { red: 0.85, green: 0.85, blue: 0.85 } },
      },
    },

    // Column Width Adjustments
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

    // Add Embedded Pie Chart for "Pengeluaran per Kategori - Bulan Ini"
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

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: { requests },
  });

  console.log("✅ Exact Dashboard with Pie Chart & Full Indonesian formatting completed!");
}

if (process.argv[1]?.endsWith("setup-exact-dashboard.ts")) {
  setupExactDashboard();
}
