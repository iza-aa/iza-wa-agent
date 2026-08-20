import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageHandler } from "../../src/bot/handlers/message.handler.js";

describe("E2E WhatsApp Flow Integration (Baileys)", () => {
  let mockUserRepo: any;
  let mockTrxRepo: any;
  let mockChatRepo: any;
  let messageHandler: MessageHandler;
  let mockSock: any;

  beforeEach(() => {
    mockUserRepo = {
      isSuperAdmin: vi.fn().mockReturnValue(true),
      isWhitelisted: vi.fn().mockResolvedValue(true),
      getUser: vi.fn().mockResolvedValue({
        phone_number: "6281346367235",
        name: "Ayah",
        role: "super_admin",
        status: "active",
      }),
      upsertUser: vi.fn().mockResolvedValue({}),
      listActiveUsers: vi.fn().mockResolvedValue([]),
    };

    mockTrxRepo = {
      generateTransactionId: vi.fn().mockReturnValue("TRX-20260820-E2E1"),
      createTransaction: vi.fn().mockResolvedValue({
        id: "TRX-20260820-E2E1",
        user_phone: "6281346367235",
        user_name: "Ayah",
        date: "2026-08-20",
        merchant: "Pertamina SPBU",
        category: "Transportasi & Bensin",
        total_amount: 100000,
        payment_method: "Cash",
      }),
      getRecentTransactions: vi.fn().mockResolvedValue([]),
      updateGSheetRow: vi.fn().mockResolvedValue(undefined),
    };

    mockChatRepo = {
      logMessage: vi.fn().mockResolvedValue(undefined),
      getRecentChatHistory: vi.fn().mockResolvedValue([]),
    };

    mockSock = {
      sendMessage: vi.fn().mockResolvedValue({}),
    };

    messageHandler = new MessageHandler(mockUserRepo, mockTrxRepo, mockChatRepo);
  });

  it("should process /help command properly via Baileys socket", async () => {
    const mockWAMessage: any = {
      key: {
        fromMe: false,
        remoteJid: "6281346367235@s.whatsapp.net",
      },
      pushName: "Ayah",
      message: {
        conversation: "/help",
      },
    };

    await messageHandler.processIncomingMessage(mockSock, mockWAMessage);
    expect(mockSock.sendMessage).toHaveBeenCalled();
    const sentPayload = mockSock.sendMessage.mock.calls[0][1];
    expect(sentPayload.text).toContain("PANDUAN PENGGUNAAN BOT KEUANGAN");
  });
});
