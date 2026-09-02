import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConfirmationFlow } from "../../../src/meta-agent/confirmation-flow.js";
import { KnowledgeLoader } from "../../../src/meta-agent/knowledge-loader.js";
import { MetaApiClient } from "../../../src/meta-agent/meta-api.client.js";
import { ContextBuilder } from "../../../src/meta-agent/context-builder.js";
import { buildSystemPrompt } from "../../../src/meta-agent/agent-persona.js";

describe("Meta WA True AI Agent Test Suite", () => {
  describe("ConfirmationFlow", () => {
    let mockPendingRepo: any;
    let mockTrxRepo: any;
    let mockUserRepo: any;
    let flow: ConfirmationFlow;

    beforeEach(() => {
      mockPendingRepo = {
        createPendingAction: vi.fn().mockImplementation((phone, name, type, payload) => ({
          id: "draft_123",
          user_phone: phone,
          user_name: name,
          action_type: type,
          payload,
          status: "PENDING",
        })),
        getPendingByUser: vi.fn().mockResolvedValue(null),
        confirmAction: vi.fn().mockResolvedValue(true),
        cancelAction: vi.fn().mockResolvedValue(true),
        updatePayload: vi.fn().mockResolvedValue(true),
      };
      mockTrxRepo = {
        generateTransactionId: vi.fn().mockResolvedValue("T026-H123"),
        createTransaction: vi.fn().mockResolvedValue({ id: "T026-H123" }),
        updateGSheetRow: vi.fn().mockResolvedValue(true),
        getWalletBalance: vi.fn().mockResolvedValue({ balance: 5000000 }),
      };
      mockUserRepo = {
        isSuperAdminAsync: vi.fn().mockResolvedValue(true),
      };

      flow = new ConfirmationFlow(mockPendingRepo, mockTrxRepo, mockUserRepo);
    });

    it("should classify affirmative answers as CONFIRM", () => {
      expect(flow.classifyUserDecision("ya")).toEqual({ type: "CONFIRM" });
      expect(flow.classifyUserDecision("Oke")).toEqual({ type: "CONFIRM" });
      expect(flow.classifyUserDecision("gas")).toEqual({ type: "CONFIRM" });
      expect(flow.classifyUserDecision("simpan")).toEqual({ type: "CONFIRM" });
      expect(flow.classifyUserDecision("CONFIRM_ACTION")).toEqual({ type: "CONFIRM" });
      expect(flow.classifyUserDecision("✅ Simpan Sekarang")).toEqual({ type: "CONFIRM" });
    });

    it("should classify negative answers as CANCEL", () => {
      expect(flow.classifyUserDecision("batal")).toEqual({ type: "CANCEL" });
      expect(flow.classifyUserDecision("cancel")).toEqual({ type: "CANCEL" });
      expect(flow.classifyUserDecision("gak jadi")).toEqual({ type: "CANCEL" });
      expect(flow.classifyUserDecision("CANCEL_ACTION")).toEqual({ type: "CANCEL" });
      expect(flow.classifyUserDecision("❌ Batalkan")).toEqual({ type: "CANCEL" });
    });

    it("should classify modification requests as MODIFY", () => {
      const decision = flow.classifyUserDecision("ganti jadi bayar pakai Mandiri");
      expect(decision.type).toBe("MODIFY");
      if (decision.type === "MODIFY") {
        expect(decision.modificationText).toBe("ganti jadi bayar pakai Mandiri");
      }
    });

    it("should create and format draft preview properly", async () => {
      const draft = {
        merchant: "Pasar Tradisional",
        date: "2026-08-28",
        type: "expense" as const,
        category: "Makanan & Minuman",
        subtotal: 70000,
        total_amount: 70000,
        payment_method: "Cash",
        items: [
          {
            item_name: "Ayam Potong",
            qty: 2,
            unit: "kg",
            price: 35000,
            total_price: 70000,
            department: "Dapur",
          },
        ],
      };

      const record = await flow.createDraft("6281805332250", "Ayah", draft);
      expect(record.id).toBe("draft_123");

      const preview = flow.formatDraftPreview(draft);
      expect(preview).toContain("Pasar Tradisional");
      expect(preview).toContain("Ayam Potong");
      expect(preview).toContain("Dapur");
      expect(preview).toContain("Cash");
    });
  });

  describe("KnowledgeLoader", () => {
    it("should load knowledge files and cache them", async () => {
      const loader = new KnowledgeLoader();
      const content = await loader.loadAllKnowledge(true);
      expect(content).toContain("Aturan Bisnis & Pedoman Operasional Kas");
      expect(content).toContain("Dapur (Kitchen)");
      expect(content).toContain("Barista (Beverage Bar)");
      expect(content).toContain("Daftar Metode Pembayaran");
    });
  });

  describe("MetaApiClient", () => {
    it("should verify webhook challenge correctly", () => {
      const client = new MetaApiClient();
      const validQuery = new URLSearchParams({
        "hub.mode": "subscribe",
        "hub.verify_token": "iza_wa_bot_secret_2026",
        "hub.challenge": "CHALLENGE_ACCEPTED_123",
      });

      expect(client.verifyWebhook(validQuery)).toBe("CHALLENGE_ACCEPTED_123");

      const invalidQuery = new URLSearchParams({
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong_token",
        "hub.challenge": "CHALLENGE_ACCEPTED_123",
      });

      expect(client.verifyWebhook(invalidQuery)).toBeNull();
    });
  });

  describe("AgentPersona", () => {
    it("should build structured system prompt with knowledge and context", () => {
      const prompt = buildSystemPrompt("KNOWLEDGE_DOCS_SAMPLE", "LIVE_DATABASE_CONTEXT_SAMPLE");
      expect(prompt).toContain("IZA — Asisten Eksekutif");
      expect(prompt).toContain("KNOWLEDGE_DOCS_SAMPLE");
      expect(prompt).toContain("LIVE_DATABASE_CONTEXT_SAMPLE");
      expect(prompt).toContain("DRAFT_TRANSACTION");
    });
  });
});
