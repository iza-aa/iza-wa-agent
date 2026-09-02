import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BaileysInteractiveClient,
  InteractiveButton,
} from "../../../src/meta-agent/baileys-interactive.client.js";
import {
  setExecutiveSocket,
  getExecutiveStatus,
  setExecutiveStatus,
} from "../../../src/meta-agent/executive-socket-holder.js";

describe("Baileys Interactive Client Test Suite (NativeFlow Buttons & Lists)", () => {
  let client: BaileysInteractiveClient;
  let mockSocket: any;

  beforeEach(() => {
    client = new BaileysInteractiveClient();
    mockSocket = {
      sendMessage: vi.fn().mockResolvedValue({ key: { id: "MOCK_MSG_ID" } }),
      relayMessage: vi.fn().mockResolvedValue({ key: { id: "MOCK_MSG_ID" } }),
      sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
      readMessages: vi.fn().mockResolvedValue(undefined),
    };
    setExecutiveSocket(mockSocket);
    setExecutiveStatus("open");
  });

  it("should send text message successfully via Baileys socket", async () => {
    const result = await client.sendTextMessage("087864550486", "Halo dari Executive Baileys!");
    expect(result).toBe(true);
    expect(mockSocket.sendMessage).toHaveBeenCalledWith(
      "6287864550486@s.whatsapp.net",
      { text: "Halo dari Executive Baileys!" }
    );
  });

  it("should send interactive buttons via NativeFlowMessage (viewOnceMessage wrapper)", async () => {
    const buttons: InteractiveButton[] = [
      { id: "BTN_CONFIRM", title: "✅ Simpan" },
      { id: "BTN_CANCEL", title: "❌ Batal" },
    ];

    const result = await client.sendInteractiveButtons(
      "6287864550486",
      "Apakah data transaksi ini sudah benar?",
      buttons,
      "Konfirmasi Transaksi"
    );

    expect(result).toBe(true);
    // Either relayMessage or sendMessage was called with native flow structure
    const call = mockSocket.relayMessage.mock.calls[0] || mockSocket.sendMessage.mock.calls[0];
    expect(call).toBeDefined();
    expect(call[0]).toBe("6287864550486@s.whatsapp.net");
  });

  it("should send interactive List dropdown menu via NativeFlow single_select", async () => {
    const sections = [
      {
        title: "Pilihan Aksi",
        rows: [
          { id: "CHECK_BALANCE", title: "📊 Cek Saldo", description: "Cek saldo kas" },
          { id: "GOOGLE_DRIVE", title: "📁 Google Drive", description: "Buka folder nota" },
        ],
      },
    ];

    const result = await client.sendInteractiveList(
      "6287864550486",
      "Menu Utama",
      "Silakan pilih aksi:",
      "📋 Buka Menu",
      sections
    );

    expect(result).toBe(true);
    const call = mockSocket.relayMessage.mock.calls[0] || mockSocket.sendMessage.mock.calls[0];
    expect(call).toBeDefined();
    expect(call[0]).toBe("6287864550486@s.whatsapp.net");
  });

  it("should send typing presence indicator", async () => {
    const result = await client.sendPresence("087864550486", "composing");
    expect(result).toBe(true);
    expect(mockSocket.sendPresenceUpdate).toHaveBeenCalledWith(
      "composing",
      "6287864550486@s.whatsapp.net"
    );
  });

  it("should mark message as read (blue tick)", async () => {
    const result = await client.markAsRead("087864550486", "MSG_12345");
    expect(result).toBe(true);
    expect(mockSocket.readMessages).toHaveBeenCalledWith([
      {
        remoteJid: "6287864550486@s.whatsapp.net",
        id: "MSG_12345",
        fromMe: false,
      },
    ]);
  });

  it("should handle disconnected socket gracefully", async () => {
    setExecutiveSocket(null);
    setExecutiveStatus("close");

    const textResult = await client.sendTextMessage("087864550486", "Test offline");
    expect(textResult).toBe(false);

    const buttonResult = await client.sendInteractiveButtons("087864550486", "Test offline", [
      { id: "1", title: "One" },
    ]);
    expect(buttonResult).toBe(false);
  });
});
