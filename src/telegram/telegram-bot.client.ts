import { Bot, InlineKeyboard, InputFile } from "grammy";
import { getSupabaseClient } from "../db/supabase.js";
import { UserRepository } from "../db/repositories/user.repository.js";
import { TransactionRepository } from "../db/repositories/transaction.repository.js";
import { ChatRepository } from "../db/repositories/chat.repository.js";
import { PendingActionRepository } from "../db/repositories/pending-action.repository.js";
import { AgentEngine } from "../meta-agent/agent-engine.js";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { normalizePhoneNumber } from "../utils/phone.utils.js";

export class TelegramAssistantBot {
  private bot: Bot;
  private userRepo: UserRepository;
  private trxRepo: TransactionRepository;
  private chatRepo: ChatRepository;
  private pendingRepo: PendingActionRepository;
  private agentEngine: AgentEngine;
  private userPhoneMap: Map<number, string> = new Map(); // tgUserId -> phoneNumber

  constructor() {
    const token = config.TELEGRAM_BOT_TOKEN || "8881925496:AAFUCvYB2yyCFNxQQlcgOB5KGR3oWwBTs1U";
    this.bot = new Bot(token);

    const supabase = getSupabaseClient();
    this.userRepo = new UserRepository(supabase, config.SUPER_ADMIN_PHONE);
    this.trxRepo = new TransactionRepository(supabase);
    this.chatRepo = new ChatRepository(supabase);
    this.pendingRepo = new PendingActionRepository(supabase);

    this.agentEngine = new AgentEngine(
      supabase,
      this.trxRepo,
      this.userRepo,
      this.chatRepo,
      this.pendingRepo
    );

    this.setupHandlers();
  }

  /**
   * Resolves phone number and display name for a Telegram user
   */
  private async resolveUserIdentity(from: any): Promise<{ phone: string; name: string; isSuperAdmin: boolean }> {
    const tgId = from.id;
    const rawName = [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || `User_${tgId}`;

    // Check if phone was explicitly mapped in memory or DB
    let phone: string = this.userPhoneMap.get(tgId) || "";

    if (!phone) {
      // Check database users to see if target_sheet_id contains tgId or if name matches
      const { data: matchedUser } = await getSupabaseClient()
        .from("users")
        .select("*")
        .eq("target_sheet_id", `tg_${tgId}`)
        .maybeSingle();

      if (matchedUser && matchedUser.phone_number) {
        phone = matchedUser.phone_number;
      } else {
        // Default to super admin phone for owner/admin if single user setup or map by name
        const superAdmins = config.SUPER_ADMIN_PHONE;
        phone = superAdmins[0] || "6281346367235";
      }
      this.userPhoneMap.set(tgId, phone);
    }

    const user = await this.userRepo.getUser(phone, rawName);
    const displayName = user ? user.name : rawName;
    const isSuperAdmin = await this.userRepo.isSuperAdminAsync(phone);

    return { phone, name: displayName, isSuperAdmin };
  }

  /**
   * Builds Telegram InlineKeyboard from button array
   */
  private buildKeyboard(buttons?: Array<{ id: string; title: string }>): InlineKeyboard | undefined {
    if (!buttons || buttons.length === 0) return undefined;

    const keyboard = new InlineKeyboard();
    // Arrange in rows of 2 or 1 depending on title length
    buttons.forEach((btn, index) => {
      keyboard.text(btn.title, btn.id);
      if ((index + 1) % 2 === 0 && index < buttons.length - 1) {
        keyboard.row();
      }
    });

    return keyboard;
  }

  /**
   * Downloads a Telegram file into a Buffer
   */
  private async downloadFileBuffer(fileId: string): Promise<Buffer | null> {
    try {
      const file = await this.bot.api.getFile(fileId);
      if (!file.file_path) return null;

      const token = config.TELEGRAM_BOT_TOKEN || "8881925496:AAFUCvYB2yyCFNxQQlcgOB5KGR3oWwBTs1U";
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

      const res = await fetch(fileUrl);
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err) {
      logger.error({ err, fileId }, "TelegramAssistantBot: Error downloading file buffer");
      return null;
    }
  }

  /**
   * Sets up all event handlers for Telegram Bot
   */
  private setupHandlers(): void {
    // 1. /start & /menu command
    this.bot.command(["start", "menu", "help"], async (ctx) => {
      const { name } = await this.resolveUserIdentity(ctx.from);

      const welcomeText =
        `👋 *Halo ${name}! Selamat Datang di IZA Executive AI Assistant*\n\n` +
        `Saya adalah asisten keuangan cerdas yang terhubung langsung ke *Google Spreadsheet Kas & Supabase*.\n\n` +
        `✨ *Kemampuan yang bisa Anda gunakan:*\n` +
        `• 💬 *Ketik Transaksi:* _"Beli kopi 25rb cash"_ atau _"Pemasukan 5jt mandiri"_\n` +
        `• 📸 *Kirim Foto Struk/Nota:* Otomatis di-scan OCR & diunggah ke Google Drive\n` +
        `• 🎙️ *Kirim Voice Note:* Otomatis didengarkan & dicatat AI\n` +
        `• 📊 *Tanya Saldo & Laporan:* _"Berapa sisa saldo kas?"_ atau _"Rekap pengeluaran bulan ini"_\n` +
        `• 🔍 *Audit Keuangan:* _"Audit selisih pembukuan kas"_\n\n` +
        `Silakan pilih menu cepat di bawah atau langsung ketik pesan Anda:`;

      const keyboard = new InlineKeyboard()
        .text("💰 Cek Saldo", "CHECK_BALANCE")
        .text("📊 Rekap Kas", "REKAP_KAS")
        .row()
        .text("🔍 Audit Kas", "AUDIT_KAS")
        .text("📄 Spreadsheet", "SPREADSHEET")
        .row()
        .text("📁 Google Drive", "GOOGLE_DRIVE");

      await ctx.reply(welcomeText, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
    });

    // 2. /link command to explicitly link Telegram account with WhatsApp staff phone number
    this.bot.command("link", async (ctx) => {
      const args = ctx.match?.trim();
      if (!args) {
        await ctx.reply(
          `📱 *CARA TAUTKAN NOMOR HP:*\n\nKetik: \`/link [NomorHPAnda]\`\nContoh: \`/link 08123456789\`\n\n_Setelah ditautkan, semua transaksi di Telegram akan otomatis tercatat atas nama Anda di Google Spreadsheet._`,
          { parse_mode: "Markdown" }
        );
        return;
      }

      const targetPhone = normalizePhoneNumber(args);
      const user = await this.userRepo.getUser(targetPhone);

      if (user) {
        await getSupabaseClient()
          .from("users")
          .update({ target_sheet_id: `tg_${ctx.from?.id}`, updated_at: new Date().toISOString() })
          .eq("phone_number", user.phone_number);

        if (ctx.from?.id) {
          this.userPhoneMap.set(ctx.from.id, user.phone_number);
        }

        await ctx.reply(
          `🎉 *AKUN BERHASIL DITAUTKAN!*\n\nHalo *${user.name}*, akun Telegram Anda telah resmi terhubung dengan nomor \`+${user.phone_number}\` (${user.role}).\n\nSekarang Anda dapat langsung mencatat transaksi, kirim foto nota, atau tanya laporan kas.`,
          { parse_mode: "Markdown" }
        );
      } else {
        await ctx.reply(
          `⚠️ Nomor \`+${targetPhone}\` belum terdaftar di database sistem.\n\nPastikan Super Admin telah mendaftarkan nomor Anda terlebih dahulu via \`/tambah ${targetPhone} [NamaAnda]\`.`,
          { parse_mode: "Markdown" }
        );
      }
    });

    // 3. Handle Inline Button Clicks (Callback Queries)
    this.bot.on("callback_query:data", async (ctx) => {
      const buttonId = ctx.callbackQuery.data;
      await ctx.answerCallbackQuery();

      const { phone, name } = await this.resolveUserIdentity(ctx.from);

      // Handle direct link helpers
      if (buttonId === "SPREADSHEET") {
        await ctx.reply(
          `📊 *LINK GOOGLE SPREADSHEET KAS:*\nhttps://docs.google.com/spreadsheets/d/${config.GOOGLE_SHEET_ID}/edit`,
          { parse_mode: "Markdown" }
        );
        return;
      }

      if (buttonId === "GOOGLE_DRIVE") {
        await ctx.reply(
          `📁 *LINK FOLDER GOOGLE DRIVE NOTA:*\nhttps://drive.google.com/drive/folders/${config.GOOGLE_DRIVE_FOLDER_ID}`,
          { parse_mode: "Markdown" }
        );
        return;
      }

      // Send typing status
      await ctx.api.sendChatAction(ctx.chat?.id || ctx.from.id, "typing");

      try {
        const result = await this.agentEngine.processIncomingMessage({
          userPhone: phone,
          userName: name,
          messageText: "",
          interactiveButtonId: buttonId,
        });

        const keyboard = this.buildKeyboard(result.buttons);
        await ctx.reply(result.reply, {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      } catch (err: any) {
        logger.error({ err, buttonId }, "TelegramAssistantBot: Error processing callback query");
        await ctx.reply("⚠️ Terjadi kendala saat memproses pilihan Anda. Silakan coba lagi.");
      }
    });

    // 4. Handle Photos (Receipt / Struk Belanja)
    this.bot.on(":photo", async (ctx) => {
      const { phone, name } = await this.resolveUserIdentity(ctx.from);
      const photos = ctx.message?.photo;
      if (!photos || photos.length === 0) return;

      // Get highest resolution photo (last element in array)
      const bestPhoto = photos[photos.length - 1];
      const caption = ctx.message?.caption || "";

      await ctx.reply("⏳ *Sedang membaca struk belanja dengan AI Vision...*", { parse_mode: "Markdown" });
      await ctx.api.sendChatAction(ctx.chat.id, "typing");

      const buffer = await this.downloadFileBuffer(bestPhoto.file_id);
      if (!buffer) {
        await ctx.reply("⚠️ Gagal mengunduh foto struk dari Telegram. Silakan coba kirim ulang.");
        return;
      }

      try {
        const result = await this.agentEngine.processIncomingMessage({
          userPhone: phone,
          userName: name,
          messageText: caption,
          mediaBuffer: buffer,
          mediaMimeType: "image/jpeg",
        });

        const keyboard = this.buildKeyboard(result.buttons);
        await ctx.reply(result.reply, {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      } catch (err: any) {
        logger.error({ err }, "TelegramAssistantBot: Error processing photo");
        await ctx.reply("⚠️ Terjadi kendala saat menganalisis foto struk. Pastikan foto jelas dan tidak buram.");
      }
    });

    // 5. Handle Voice Notes / Audio
    this.bot.on([":voice", ":audio"], async (ctx) => {
      const { phone, name } = await this.resolveUserIdentity(ctx.from);
      const voice = ctx.message?.voice || ctx.message?.audio;
      if (!voice) return;

      await ctx.reply("🎧 *Mendengarkan rekaman suara & memproses dengan AI...*", { parse_mode: "Markdown" });
      await ctx.api.sendChatAction(ctx.chat.id, "record_voice");

      const buffer = await this.downloadFileBuffer(voice.file_id);
      if (!buffer) {
        await ctx.reply("⚠️ Gagal mengunduh rekaman suara dari Telegram. Silakan coba kirim ulang.");
        return;
      }

      const mimeType = voice.mime_type || "audio/ogg";

      try {
        const result = await this.agentEngine.processIncomingMessage({
          userPhone: phone,
          userName: name,
          messageText: "",
          mediaBuffer: buffer,
          mediaMimeType: mimeType,
        });

        const keyboard = this.buildKeyboard(result.buttons);
        await ctx.reply(result.reply, {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      } catch (err: any) {
        logger.error({ err }, "TelegramAssistantBot: Error processing voice message");
        await ctx.reply("⚠️ Terjadi kendala saat memproses rekaman suara. Silakan coba kembali.");
      }
    });

    // 6. Handle Document (PDF Invoices / Nota file)
    this.bot.on(":document", async (ctx) => {
      const { phone, name } = await this.resolveUserIdentity(ctx.from);
      const doc = ctx.message?.document;
      if (!doc) return;

      const fileName = doc.file_name || "document.pdf";
      const mimeType = doc.mime_type || "application/pdf";
      const isPdf = mimeType.includes("pdf") || fileName.endsWith(".pdf");
      const isImage = mimeType.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(fileName);

      if (!isPdf && !isImage) {
        await ctx.reply("⚠️ Format dokumen tidak didukung. Mohon kirim file berupa PDF atau Foto Struk.");
        return;
      }

      await ctx.reply(
        isPdf ? "⏳ *Sedang membaca dokumen invoice/struk PDF...*" : "⏳ *Sedang menganalisis foto dokumen...*",
        { parse_mode: "Markdown" }
      );
      await ctx.api.sendChatAction(ctx.chat.id, "typing");

      const buffer = await this.downloadFileBuffer(doc.file_id);
      if (!buffer) {
        await ctx.reply("⚠️ Gagal mengunduh file dokumen dari Telegram. Silakan coba kirim ulang.");
        return;
      }

      try {
        const result = await this.agentEngine.processIncomingMessage({
          userPhone: phone,
          userName: name,
          messageText: ctx.message?.caption || "",
          mediaBuffer: buffer,
          mediaMimeType: isPdf ? "application/pdf" : mimeType,
        });

        const keyboard = this.buildKeyboard(result.buttons);
        await ctx.reply(result.reply, {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      } catch (err: any) {
        logger.error({ err }, "TelegramAssistantBot: Error processing document");
        await ctx.reply("⚠️ Terjadi kendala saat memproses dokumen.");
      }
    });

    // 7. Handle Natural Text Messages
    this.bot.on(":text", async (ctx) => {
      const { phone, name } = await this.resolveUserIdentity(ctx.from);
      const text = ctx.message?.text || "";

      if (!text.trim()) return;

      // Send typing action
      await ctx.api.sendChatAction(ctx.chat.id, "typing");

      try {
        const result = await this.agentEngine.processIncomingMessage({
          userPhone: phone,
          userName: name,
          messageText: text,
        });

        const keyboard = this.buildKeyboard(result.buttons);
        await ctx.reply(result.reply, {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        });
      } catch (err: any) {
        logger.error({ err, text }, "TelegramAssistantBot: Error processing text message");
        await ctx.reply("⚠️ Terjadi kendala teknis saat memproses pesan Anda. Silakan coba sesaat lagi.");
      }
    });

    // Global Error Handler
    this.bot.catch((err) => {
      logger.error({ err: err.error, ctx: err.ctx?.update }, "TelegramAssistantBot: Unhandled bot error");
    });
  }

  /**
   * Starts Telegram Bot polling
   */
  async start(): Promise<void> {
    logger.info("Starting Telegram Executive AI Assistant Bot (@IzaExecutiveBot)...");
    this.bot.start({
      onStart: (botInfo) => {
        logger.info({ username: botInfo.username, id: botInfo.id }, "Telegram Executive Bot is ONLINE and LISTENING!");
        console.log(`\n=======================================================`);
        console.log(`🤖 TELEGRAM EXECUTIVE BOT AKTIF: @${botInfo.username}`);
        console.log(`Buka Telegram dan mulai chat: https://t.me/${botInfo.username}`);
        console.log(`=======================================================\n`);
      },
    });
  }

  /**
   * Stops Telegram Bot
   */
  async stop(): Promise<void> {
    await this.bot.stop();
  }
}

export const telegramAssistantBot = new TelegramAssistantBot();
