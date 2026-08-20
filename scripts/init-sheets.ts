import { googleSheetsService } from "../src/google/sheets.service.js";

async function initializeSheets() {
  console.log("Initializing Google Sheets schema and Dasbor...");
  await googleSheetsService.ensureSheetInitialized();
  console.log("✅ Google Sheets initialized successfully with Dasbor!");
}

initializeSheets();
