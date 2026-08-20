# WA-Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a robust, scalable WhatsApp AI Agent using TypeScript, `whatsapp-web.js`, Gemini 2.5 Flash with multi-key rotation, Supabase PostgreSQL, Google Drive for media storage, and Google Sheets for live spreadsheet logging.

**Architecture:** Event-driven modular service with separate domain layers: WhatsApp listener -> Whitelist/Auth Check -> Multimodal AI Parser (Vision/Audio/Text) -> Supabase Transaction DB -> Google Drive Compressed Uploader -> Google Sheets API Appender -> WA Confirmation.

**Tech Stack:** TypeScript, Node.js, `whatsapp-web.js`, `@google/genai`, `@supabase/supabase-js`, `googleapis`, `sharp` (image compression), `zod`, `vitest` (TDD tests).

**Spec:** `docs/superpowers/specs/2026-08-19-wa-agent-design.md`

## Global Constraints
- Node.js >= 18.0.0
- TypeScript with strict mode enabled
- Zero secrets committed to git (all credentials sourced from `.env`)
- Gemini Multi-Key Rotation fallback for resilient uptime
- Google Drive receipts compressed to WebP/JPEG (max 1200px) before upload

---

### Task 1: Scaffolding, TypeScript Config, and Environment Validator

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/config/env.ts`
- Create: `src/utils/logger.ts`
- Test: `tests/unit/config/env.test.ts`

**Interfaces:**
- Produces: `config` object validated with Zod schema (`GEMINI_API_KEYS`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPER_ADMIN_PHONE`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`, `GOOGLE_DRIVE_FOLDER_ID`).

- [ ] **Step 1: Write failing unit test for env validator**
- [ ] **Step 2: Run test with vitest to verify it fails**
- [ ] **Step 3: Implement package.json, tsconfig.json, logger, and env.ts**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit changes**

---

### Task 2: Supabase Schema Migration & Database Service

**Files:**
- Create: `supabase/migrations/20260820_initial_schema.sql`
- Create: `src/db/supabase.ts`
- Create: `src/db/repositories/user.repository.ts`
- Create: `src/db/repositories/transaction.repository.ts`
- Create: `src/db/repositories/chat.repository.ts`
- Test: `tests/unit/db/repositories.test.ts`

**Interfaces:**
- Produces: `UserRepository` (`getUser(phone)`, `upsertUser(user)`, `isWhitelisted(phone)`, `isSuperAdmin(phone)`), `TransactionRepository` (`createTransaction(trx, items)`, `getRecentTransactions(phone)`), `ChatRepository` (`logMessage(msg)`).

- [ ] **Step 1: Write SQL migration for users, transactions, receipt_items, chat_logs tables**
- [ ] **Step 2: Write failing unit test for repository interfaces**
- [ ] **Step 3: Implement Supabase client & repositories**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit changes**

---

### Task 3: Multimodal Gemini AI Pipeline with Multi-Key Fallback

**Files:**
- Create: `src/ai/gemini-client.ts`
- Create: `src/ai/schemas/transaction.schema.ts`
- Create: `src/ai/parsers/text.parser.ts`
- Create: `src/ai/parsers/receipt-vision.parser.ts`
- Create: `src/ai/parsers/audio.parser.ts`
- Test: `tests/unit/ai/gemini-parser.test.ts`

**Interfaces:**
- Produces: `aiService.parseText(prompt, context)`, `aiService.parseReceiptImage(imageBuffer, mimeType)`, `aiService.parseAudio(audioBuffer, mimeType)`.
- Feature: Automatic round-robin and fallback if a key encounters rate limit (HTTP 429).

- [ ] **Step 1: Write failing tests for AI parser schemas and fallback mechanism**
- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Implement Gemini client with structured JSON output and multi-key fallback pool**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit changes**

---

### Task 4: Google Drive Media Vault & Google Sheets Sync Service

**Files:**
- Create: `src/google/drive.service.ts`
- Create: `src/google/sheets.service.ts`
- Create: `src/utils/image-optimizer.ts`
- Test: `tests/unit/google/sync.test.ts`

**Interfaces:**
- Produces: `imageOptimizer.compressReceipt(buffer)` -> WebP buffer (<200KB), `driveService.uploadReceipt(buffer, fileName, userFolder)` -> webViewLink, `sheetsService.appendTransaction(transaction, items)`.

- [ ] **Step 1: Write failing tests for image optimizer and Google services**
- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Implement sharp compression, Google Drive JWT auth & upload, and Google Sheets v4 append**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit changes**

---

### Task 5: WhatsApp Worker Core & Message Dispatcher

**Files:**
- Create: `src/bot/client.ts`
- Create: `src/bot/handlers/message.handler.ts`
- Create: `src/bot/handlers/command.handler.ts`
- Create: `src/bot/formatters/reply.formatter.ts`
- Test: `tests/unit/bot/message-handler.test.ts`

**Interfaces:**
- Produces: `startBot()` lifecycle, message router (Text vs Receipt Image vs Voice Note), Whitelist guard, and Super Admin command dispatcher (`/approve`, `/block`, `/rekap`, `/users`).

- [ ] **Step 1: Write failing unit test for message routing & permissions**
- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Implement whatsapp-web.js listener with LocalAuth, media downloader, and command handler**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit changes**

---

### Task 6: End-to-End Orchestrator, CLI Entrypoint & Verification

**Files:**
- Create: `src/index.ts`
- Create: `scripts/setup-db.ts`
- Create: `scripts/test-google-sync.ts`
- Create: `README.md`
- Test: `tests/integration/e2e-flow.test.ts`

**Interfaces:**
- End-to-end integration: User WhatsApp message -> Whitelist Check -> Gemini Multimodal AI -> Supabase Insert -> Google Drive Upload -> Google Sheets Append -> WhatsApp Feedback formatted response.

- [ ] **Step 1: Write integration tests for end-to-end processing pipeline**
- [ ] **Step 2: Implement main `src/index.ts` and helper CLI scripts**
- [ ] **Step 3: Run complete test suite (`npm test`) and verify 100% green**
- [ ] **Step 4: Create README.md with clear setup instructions**
- [ ] **Step 5: Final commit & walkthrough**
