import { google } from "googleapis";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { TransactionRecord, TransactionItem } from "../db/repositories/transaction.repository.js";

export class GoogleSheetsService {
  private sheetsClient: any;
  private sheetTitle = "Data Transaksi";

  constructor() {
    const auth = new google.auth.JWT({
      email: config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: config.GOOGLE_PRIVATE_KEY,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    this.sheetsClient = google.sheets({ version: "v4", auth });
  }

  async ensureSheetInitialized(sheetId: string = config.GOOGLE_SHEET_ID): Promise<void> {
    try {
      const spreadsheet = await this.sheetsClient.spreadsheets.get({
        spreadsheetId: sheetId,
      });

      const existingSheets = spreadsheet.data.sheets || [];
      const hasTargetSheet = existingSheets.some(
        (s: any) => s.properties?.title === this.sheetTitle
      );

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
          "Waktu Input",
          "Tanggal Transaksi",
          "Nama Penginput",
          "Nomor WhatsApp",
          "Nama Merchant / Tempat",
          "Kategori",
          "Rincian Barang",
          "Subtotal (Rp)",
          "Pajak / PB1 (Rp)",
          "Diskon (Rp)",
          "Total Pengeluaran (Rp)",
          "Metode Pembayaran",
          "Status Verifikasi",
          "Catatan / Raw Text",
          "Link Bukti / Struk",
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
    } catch (error) {
      logger.error({ error, sheetId }, "Error ensuring Google Sheet initialized");
      throw error;
    }
  }

  async appendTransaction(
    trx: TransactionRecord,
    items: TransactionItem[] = [],
    sheetId: string = config.GOOGLE_SHEET_ID
  ): Promise<{ updatedRange: string; rowIndex: number }> {
    await this.ensureSheetInitialized(sheetId);

    const dateObj = new Date(trx.date);
    const year = !isNaN(dateObj.getFullYear()) ? dateObj.getFullYear().toString() : new Date().getFullYear().toString();
    const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    const month = !isNaN(dateObj.getMonth()) ? monthNames[dateObj.getMonth()] : "";

    const nowWIB = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
    const cleanPhone = trx.user_phone.startsWith("62") ? "+" + trx.user_phone : trx.user_phone;

    const itemsSummary = items.length > 0
      ? items.map((it) => it.item_name + " (" + (it.qty || 1) + "x @" + it.price + ")").join(", ")
      : "-";

    const rowData = [
      trx.id, // A: ID Transaksi
      nowWIB, // B: Waktu Input
      trx.date, // C: Tanggal Transaksi
      trx.user_name, // D: Nama Penginput
      cleanPhone, // E: Nomor WhatsApp
      trx.merchant, // F: Nama Merchant / Tempat
      trx.category, // G: Kategori
      itemsSummary, // H: Rincian Barang
      trx.subtotal || trx.total_amount, // I: Subtotal (Rp)
      trx.tax || 0, // J: Pajak / PB1 (Rp)
      trx.discount || 0, // K: Diskon (Rp)
      trx.total_amount, // L: Total Pengeluaran (Rp)
      trx.payment_method || "Cash", // M: Metode Pembayaran
      trx.status || "recorded", // N: Status Verifikasi
      trx.raw_text || "-", // O: Catatan / Raw Text
      trx.gdrive_web_view_link ? "=HYPERLINK(\"" + trx.gdrive_web_view_link + "\"; \"Lihat Foto Struk\")" : "-", // P: Link Bukti / Struk
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

  async updateTransactionRow(
    trx: TransactionRecord,
    items: TransactionItem[] = [],
    sheetId: string = config.GOOGLE_SHEET_ID
  ): Promise<boolean> {
    try {
      const res = await this.sheetsClient.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: this.sheetTitle + "!A:A",
      });

      const rows = res.data.values || [];
      const rowIndex = rows.findIndex((r: any[]) => r && r[0] === trx.id);

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

      const updatedRowData = [
        trx.id, // A: ID Transaksi
        nowWIB, // B: Waktu Input
        trx.date, // C: Tanggal Transaksi
        trx.user_name, // D: Nama Penginput
        cleanPhone, // E: Nomor WhatsApp
        trx.merchant, // F: Nama Merchant / Tempat
        trx.category, // G: Kategori
        itemsSummary, // H: Rincian Barang
        trx.subtotal || trx.total_amount, // I: Subtotal (Rp)
        trx.tax || 0, // J: Pajak / PB1 (Rp)
        trx.discount || 0, // K: Diskon (Rp)
        trx.total_amount, // L: Total Pengeluaran (Rp)
        trx.payment_method || "Cash", // M: Metode Pembayaran
        trx.status || "recorded", // N: Status Verifikasi
        trx.raw_text || "-", // O: Catatan / Raw Text
        trx.gdrive_web_view_link ? "=HYPERLINK(\"" + trx.gdrive_web_view_link + "\"; \"Lihat Foto Struk\")" : "-", // P: Link Bukti / Struk
      ];

      await this.sheetsClient.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: this.sheetTitle + "!A" + sheetRowNumber + ":P" + sheetRowNumber,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [updatedRowData],
        },
      });

      logger.info({ trxId: trx.id, sheetRowNumber }, "Google Sheet row updated successfully");
      return true;
    } catch (err) {
      logger.error({ err, trxId: trx.id }, "Failed to update transaction row in Google Sheet");
      return false;
    }
  }

  async deleteTransactionRow(trxId: string, sheetId: string = config.GOOGLE_SHEET_ID): Promise<boolean> {
    try {
      const res = await this.sheetsClient.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: this.sheetTitle + "!A:A",
      });

      const rows = res.data.values || [];
      const rowIndex = rows.findIndex((r: any[]) => r && r[0] === trxId);

      if (rowIndex === -1) {
        logger.warn({ trxId }, "Transaction ID not found in Google Sheet for deletion");
        return false;
      }

      const meta = await this.sheetsClient.spreadsheets.get({ spreadsheetId: sheetId });
      const sheet = meta.data.sheets?.find((s: any) => s.properties?.title === this.sheetTitle);
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
    } catch (err) {
      logger.error({ err, trxId }, "Failed to delete transaction row from Google Sheet");
      return false;
    }
  }
}

export const googleSheetsService = new GoogleSheetsService();
