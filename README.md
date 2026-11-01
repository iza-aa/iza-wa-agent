# IZA WA-Agent — Autonomous WhatsApp Commerce & Financial Assistant

![Baileys](https://img.shields.io/badge/WhatsApp-Baileys%20Multi--Device-25D366?style=flat-square&logo=whatsapp)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?style=flat-square&logo=typescript)
![Gemini AI](https://img.shields.io/badge/Gemini-2.5%20Flash%20Multimodal-orange?style=flat-square&logo=google)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-emerald?style=flat-square&logo=supabase)
![Vitest](https://img.shields.io/badge/Tests-14%20Suites%20%7C%20115%20Passing-brightgreen?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)

An enterprise-grade, autonomous WhatsApp conversational commerce and transaction management system engineered for Indonesian retail and MSME operators. Directly connects to the WhatsApp Web multi-device protocol via Baileys, ingesting physical receipt photos, Indonesian voice notes, and informal natural chat to execute idempotent accounting records in Supabase PostgreSQL and collaborative Google Sheets.

Live Webhook / Portal: [https://iza-wa-agent.vercel.app](https://iza-wa-agent.vercel.app)

---

## 🏛️ System Architecture Topology

```
+--------------------+        +-----------------------------+        +---------------------------+
| WhatsApp Customers | -----> | Baileys Multi-Device Socket | -----> | Meta-Agent Context Engine |
| & Cashier Staff    | <----- | (Session Credential Lock)   | <----- | (Persona & Rules Routing) |
+--------------------+        +-----------------------------+        +---------------------------+
                                             |                                     |
                                             v                                     v
                              +-----------------------------+        +---------------------------+
                              | Deduplication Ledger Engine | <----- | 3-Tier Regex Parser Guard |
                              | (Idempotent Supabase Commit)|        | (Zero Raw JSON Leakage)   |
                              +-----------------------------+        +---------------------------+
                                             |
                                             v
                              +-----------------------------+
                              | Multi-Storage Media Vault   |
                              | - WebP 80% Sharp Optimizer  |
                              | - Google Drive & Sheets Sync|
                              | - Bank Statement PDF Engine |
                              +-----------------------------+
```

---

## 🌟 Key Capabilities & Engineering Guardrails

### 1. Multimodal Conversational Ingestion
- 📸 **Receipt & Invoice OCR Vision:** Ingests paper receipts, physical cash slips, and bank transfer screenshots, extracting merchant names, line items, VAT, discounts, and net totals.
- 🎙️ **Voice Note Processing:** Transcribes native WhatsApp audio messages directly, parsing conversational numbers (*"tadi beli telur 2 kilo 56 ribu"*).
- 💬 **Natural Indonesian Slang Parsing:** Understands casual Indonesian expense notation (*"kopi 25k"*, *"bensin 50rb"*).

### 2. 3-Tier Bulletproof Anti-Leak Parsing Guardrail
- LLMs occasionally prepend conversational preambles or generate malformed markdown around structured outputs.
- A proprietary 3-tier regex and bracket-balancing engine guarantees that raw JSON structures never leak into end-user WhatsApp chat bubbles.
- Automated sanitization removes unescaped control characters before schema validation.

### 3. Idempotent Deduplication Engine
- Automatic sliding-window duplicate detection prevents double entry of receipts if users resend photos or click confirmation buttons multiple times.
- Outdated inline buttons automatically unbind upon user action to prevent race conditions.

### 4. Departmental PDF Statement Generation
- Dynamic PDF statement generator (`pdf-report.service.ts`) producing formal bank-statement style ledger exports broken down by operational departments (Kitchen, Barista, Cashier).

---

## 📂 Project Structure

```
wa-agent/
├── src/
│   ├── bot/                    # Baileys WhatsApp client, message and command handlers
│   ├── meta-agent/             # Context builder, persona rules, and webhook connectors
│   ├── ai/                     # Multimodal Gemini parsers (receipt vision, audio, text)
│   ├── db/                     # Supabase client and domain repositories
│   ├── google/                 # Google Drive Media Vault and Google Sheets sync
│   ├── services/               # Deduplication, PDF report generator, cron scheduler
│   └── utils/                  # Phone sanitization, image optimization, logger
├── supabase/                   # PostgreSQL schema migrations (4 migrations, 7 tables)
├── tests/                      # 14 Vitest automated test suites (115 passing test cases)
├── docker-compose.evolution.yml# Evolution API container orchestrator
├── Dockerfile                  # Containerized deployment manifest
└── LICENSE                     # MIT License
```

---

## 🧪 Testing & Verifiable Quality

The codebase enforces strict test-driven validation covering parsers, deduplication algorithms, and repository state machines:

```bash
# Run all 14 test suites (115 automated test cases)
npm test

# Run tests in watch mode
npm run test:watch
```

Verified test coverage includes:
- `receipt-vision.test.ts` — Complex wrinkled receipt parsing
- `duplicate-detector.test.ts` — Sliding-window collision avoidance
- `confirmation-flow.test.ts` — Interactive state machine verification
- `phone-utils.test.ts` — Indonesian phone number normalization (+62 / 08)

---

## 🚀 Getting Started

### Prerequisites
- Node.js `>= 20.x`
- Supabase Project & Google Cloud Service Account

### Quickstart

1. Clone and install dependencies:
   ```bash
   git clone https://github.com/iza-aa/iza-wa-agent.git
   cd iza-wa-agent
   npm install
   ```

2. Configure environment:
   ```bash
   cp .env.example .env
   ```
   Configure Supabase URL, Gemini API keys, Google Service Account, and admin phone numbers.

3. Start development server:
   ```bash
   npm run dev
   ```

4. Link WhatsApp:
   Scan the generated terminal QR code using WhatsApp on your device (**Linked Devices** -> **Link a Device**).

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
