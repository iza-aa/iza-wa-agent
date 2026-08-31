import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EvolutionApiClient } from "../../../src/meta-agent/evolution-api.client.js";

describe("Evolution API v2 Client Test Suite", () => {
  let client: EvolutionApiClient;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    client = new EvolutionApiClient();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should send text message successfully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "SUCCESS" }),
    });
    globalThis.fetch = mockFetch;

    const result = await client.sendTextMessage("6287864550486", "Halo dari Evolution API");
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/message/sendText/iza-executive"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          apikey: "iza_evolution_secret_key_2026",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          number: "6287864550486",
          text: "Halo dari Evolution API",
        }),
      })
    );
  });

  it("should send interactive buttons with Meta-parity payload via sendInteractive", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "SUCCESS" }),
    });
    globalThis.fetch = mockFetch;

    const buttons = [
      { id: "CHECK_BALANCE", title: "📊 Cek Saldo" },
      { id: "GOOGLE_DRIVE", title: "📁 Google Drive" },
      { id: "SPREADSHEET", title: "📑 Spreadsheet" },
    ];

    const result = await client.sendInteractiveButtons(
      "6287864550486",
      "Silakan pilih aksi:",
      buttons,
      "Menu Utama"
    );

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/message/sendInteractive/iza-executive"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          number: "6287864550486",
          interactive: {
            type: "button",
            header: { type: "text", text: "Menu Utama" },
            body: { text: "Silakan pilih aksi:" },
            footer: { text: "IZA Executive Assistant" },
            action: {
              buttons: [
                { type: "reply", reply: { id: "CHECK_BALANCE", title: "📊 Cek Saldo" } },
                { type: "reply", reply: { id: "GOOGLE_DRIVE", title: "📁 Google Drive" } },
                { type: "reply", reply: { id: "SPREADSHEET", title: "📑 Spreadsheet" } },
              ],
            },
          },
        }),
      })
    );
  });

  it("should send typing presence indicator", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "SUCCESS" }),
    });
    globalThis.fetch = mockFetch;

    const result = await client.sendPresence("6287864550486", "composing");
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/chat/sendPresence/iza-executive"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          number: "6287864550486",
          presence: "composing",
        }),
      })
    );
  });
});
