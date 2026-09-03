import { Bot, InlineKeyboard, InputFile } from "grammy";
import crypto from "crypto";
import { getSupabaseClient } from "../db/supabase.js";
import { UserRepository } from "../db/repositories/user.repository.js";
import { TransactionRepository } from "../db/repositories/transaction.repository.js";
import { ChatRepository } from "../db/repositories/chat.repository.js";
import { PendingActionRepository } from "../db/repositories/pending-action.repository.js";
import { AgentEngine } from "../meta-agent/agent-engine.js";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { normalizePhoneNumber } from "../utils/phone.utils.js";

interface InviteTokenRecord {
  code: string;
  phone: string;
  name: string;
  role: "super_admin" | "admin" | "member";
  expiresAt: number;
}

const BUTTON_ID_MAP: Record<string, string> = {
  CHECK_BALANCE: "Berapa total saldo kas dan rekening kita saat ini?",
  REKAP_KAS: "Tampilkan rekap kondisi keuangan kas terbaru bulan ini",
  AUDIT_KAS: "Audit pengeluaran yang belum dirinci dan periksa selisih di pembukuan kas",
  AUDIT_RINCIAN: "Audit pengeluaran yang belum dirinci",
  AUDIT_SELISIH: "Cek apakah ada selisih di pembukuan kas",
  GENERATE_PDF: "Buat dokumen PDF laporan keuangan periode yang baru saja dibahas",
  CONFIRM_ACTION: "Ya, simpan sekarang",
  CANCEL_ACTION: "Batal dan hapus draf",
  EDIT_DRAFT: "Ubah draf transaksi",
  SWITCH_TYPE: "Ubah jenis transaksi (Pemasukan / Pengeluaran)",
  SWITCH_PAYMENT: "Ubah metode pembayaran",
  SWITCH_DEPT: "Ubah divisi",
  DEPT_DAPUR: "Alokasikan untuk divisi Dapur",
  DEPT_BARISTA: "Alokasikan untuk divisi Barista",
  DEPT_WAITERS: "Alokasikan untuk divisi Waiters",
  DEPT_KASIR: "Alokasikan untuk divisi Kasir",
  DEPT_KAFE: "Alokasikan untuk divisi Kafe",
  DUPLICATE_SAVE: "Ya, tetap simpan transaksi ini",
  DUPLICATE_DROP: "Batal dan buang draf ini",
  FILTER_THIS_WEEK: "Tampilkan ringkasan transaksi minggu ini",
  FILTER_THIS_MONTH: "Tampilkan ringkasan transaksi bulan ini",
  FILTER_LAST_MONTH: "Tampilkan ringkasan transaksi bulan lalu",
};

export class TelegramAssistantBot {
  private bot: Bot;
  private userRepo: UserRepository;
  private trxRepo: TransactionRepository;
  private chatRepo: ChatRepository;
  private pendingRepo: PendingActionRepository;
  private agentEngine: AgentEngine;
  private userPhoneMap: Map<number, string> = new Map(); // tgUserId -> phoneNumber
  private activeInvites: Map<string, InviteTokenRecord> = new Map(); // inviteCode -> InviteTokenRecord
  private lastKeyboardMap: Map<number, number> = new Map(); // chatId -> messageId with active inline buttons

  constructor() {
    const token = config.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";
    if (!token) {
      logger.warn("TelegramAssistantBot: TELEGRAM_BOT_TOKEN is not configured in .env");
    }
    this.bot = new Bot(token || "dummy_token");

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
   * Resolves identity and strictly verifies whitelist authorization
   */
  private async resolveUserIdentity(from: any): Promise<{
    phone: string;
    name: string;
    isSuperAdmin: boolean;
    isAllowed: boolean;
  }> {
    const tgId = from.id;
    const rawName = [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || `User_${tgId}`;

    // 1. Check in-memory cache
    let phone: string = this.userPhoneMap.get(tgId) || "";

    // 2. Check database users for linked Telegram ID (tg_<id> or <id>)
    if (!phone) {
      const { data: matchedUser } = await getSupabaseClient()
        .from("users")
        .select("*")
        .or(`target_sheet_id.eq.tg_${tgId},target_sheet_id.eq.${tgId}`)
        .eq("status", "active")
        .maybeSingle();

      if (matchedUser && matchedUser.phone_number) {
        phone = matchedUser.phone_number;
        this.userPhoneMap.set(tgId, phone);
      }
    }

    if (!phone) {
      return { phone: "", name: rawName, isSuperAdmin: false, isAllowed: false };
    }

    const user = await this.userRepo.getUser(phone, rawName);
    if (!user || user.status !== "active") {
      return { phone, name: rawName, isSuperAdmin: false, isAllowed: false };
    }

    const displayName = user.name || rawName;
    const isSuperAdmin = await this.userRepo.isSuperAdminAsync(phone);

    return { phone: user.phone_number, name: displayName, isSuperAdmin, isAllowed: true };
  }

  /**
   * Builds Telegram InlineKeyboard from button array
   */
  private buildKeyboard(buttons?: Array<{ id: string; title: string }>): InlineKeyboard | undefined {
    if (!buttons || buttons.length === 0) return undefined;

    const keyboard = new InlineKeyboard();
    buttons.forEach((btn, index) => {
      keyboard.text(btn.title, btn.id);
      if ((index + 1) % 2 === 0 && index < buttons.length - 1) {
        keyboard.row();
      }
    });

    return keyboard;
  }

  /**
   * Clears previous active inline keyboard in the chat so no stale buttons linger
   */
  private async clearPreviousKeyboard(chatId?: number): Promise<void> {
    if (!chatId) return;
    const prevMsgId = this.lastKeyboardMap.get(chatId);
    if (prevMsgId) {
      this.lastKeyboardMap.delete(chatId);
      await this.bot.api.editMessageReplyMarkup(chatId, prevMsgId, { reply_markup: undefined }).catch(() => {});
    }
  }

  /**
   * Sends a reply with inline buttons and tracks it so future actions automatically clean it up
   */
  private async replyWithTrackedKeyboard(ctx: any, text: string, buttons?: Array<{ id: string; title: string }>): Promise<any> {
    const chatId = ctx.chat?.id || ctx.from?.id;
    if (chatId) {
      await this.clearPreviousKeyboard(chatId);
    }

    const keyboard = this.buildKeyboard(buttons);
    const replyParams = ctx.message?.message_id
      ? { message_id: ctx.message.message_id }
      : undefined;

    let sent: any;
    try {
      sent = await ctx.reply(text, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
        reply_parameters: replyParams,
      });
    } catch (parseErr: any) {
      // If Telegram Markdown parsing fails (e.g. underscore in Google Drive URLs), fallback to plain text without parse_mode
      if (
        parseErr?.description?.includes("can't parse entities") ||
        parseErr?.message?.includes("can't parse entities")
      ) {
        sent = await ctx.reply(text, {
          reply_markup: keyboard,
          reply_parameters: replyParams,
        });
      } else {
        throw parseErr;
      }
    }

    if (buttons && buttons.length > 0 && chatId && sent?.message_id) {
      this.lastKeyboardMap.set(chatId, sent.message_id);
    }

    return sent;
  }

  /**
   * Sends a result reply and if a PDF document is generated, attaches the actual PDF file directly to Telegram chat
   */
  private async sendResultReply(ctx: any, result: any): Promise<any> {
    const replyParams = ctx.message?.message_id
      ? { message_id: ctx.message.message_id }
      : undefined;

    // If PDF document buffer is present, send actual PDF document directly to Telegram chat
    if (result.pdfBuffer) {
      try {
        const docFile = new InputFile(result.pdfBuffer, result.pdfFileName || "Laporan_Keuangan.pdf");
        await ctx.replyWithDocument(docFile, {
          caption: `📄 *Dokumen PDF Laporan Keuangan*\n\nFile resmi telah dilampirkan langsung di atas dan tersimpan di Google Drive.`,
          parse_mode: "Markdown",
          reply_parameters: replyParams,
        });
      } catch (docErr) {
        logger.error({ docErr }, "TelegramAssistantBot: Error sending PDF document directly");
      }
    }

    return await this.replyWithTrackedKeyboard(ctx, result.reply, result.buttons);
  }
  private async downloadFileBuffer(fileId: string): Promise<Buffer | null> {
    try {
      const file = await this.bot.api.getFile(fileId);
      if (!file.file_path) return null;

      const token = config.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";
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
   * Reusable gatekeeper: Checks whitelist or shows access denied message
   */
  private async checkAccessOrDeny(ctx: any, user: { isAllowed: boolean; name: string }): Promise<boolean> {
    if (!user.isAllowed) {
      await ctx.reply(
        `⛔ *AKSES DITOLAK (PRIVAT & TERBATAS)*\n\n` +
        `Akun Telegram Anda belum terhubung dengan staf/admin terdaftar di sistem *IZA Assistant*.\n\n` +
        `👉 *Hanya Super Admin yang dapat membuat link undangan resmi untuk menghubungkan akun Telegram.*`,
        { parse_mode: "Markdown" }
      );
      return false;
    }
    return true;
  }

  /**
   * Sets up all event handlers for Telegram Bot
   */
  private setupHandlers(): void {
    // 1. /myid command: Displays Telegram User ID & Connection Status
    this.bot.command("myid", async (ctx) => {
      await this.clearPreviousKeyboard(ctx.chat?.id);
      const user = await this.resolveUserIdentity(ctx.from);
      const tgId = ctx.from?.id;
      const tgName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ");
      const tgUsername = ctx.from?.username ? `@${ctx.from.username}` : "(tanpa username)";

      let statusDesc = "❌ Belum Terhubung (Tidak Ada Akses)";
      if (user.isAllowed) {
        statusDesc = `✅ Terhubung sebagai *${user.name}* (${user.isSuperAdmin ? "Super Admin" : "Member"}) — +${user.phone}`;
      }

      await ctx.reply(
        `🆔 *INFORMASI IDENTITAS TELEGRAM ANDA:*\n\n` +
        `• *Telegram ID:* \`${tgId}\`\n` +
        `• *Nama Akun:* ${tgName}\n` +
        `• *Username:* ${tgUsername}\n` +
        `• *Status Sistem:* ${statusDesc}\n\n` +
        (user.isSuperAdmin
          ? `👑 *Anda adalah Super Admin.* Ketik \`/invite [NoHP] [Nama]\` untuk mengundang Ayah atau staf lain.`
          : `_ID Telegram Anda bersifat unik dan digunakan untuk memverifikasi hak akses pembukuan kas._`),
        { parse_mode: "Markdown" }
      );
    });

    // 2. /invite command: Super Admin generates a single-use invite token (15 mins validity)
    this.bot.command("invite", async (ctx) => {
      await this.clearPreviousKeyboard(ctx.chat?.id);
      const adminUser = await this.resolveUserIdentity(ctx.from);
      if (!adminUser.isAllowed || !adminUser.isSuperAdmin) {
        await ctx.reply("⛔ Perintah ini hanya dapat dijalankan oleh *Super Admin*.");
        return;
      }

      const args = ctx.match?.trim().split(/\s+/) || [];
      if (args.length === 0 || !args[0]) {
        await ctx.reply(
          `🎟️ *CARA MEMBUAT UNDANGAN STAF/ADMIN:*\n\n` +
          `Ketik: \`/invite [NomorHP] [Nama]\`\n` +
          `Contoh: \`/invite 0811422404 Ayah\`\n` +
          `Contoh: \`/invite 08123456789 Budi Kasir\`\n\n` +
          `_Sistem akan menghasilkan link khusus yang hanya bisa dipakai 1x oleh orang tersebut._`,
          { parse_mode: "Markdown" }
        );
        return;
      }

      const rawPhone = args[0];
      const targetPhone = normalizePhoneNumber(rawPhone);
      const targetName = args.slice(1).join(" ") || "Anggota Tim";

      // Upsert/ensure user exists in DB
      let existingUser = await this.userRepo.getUser(targetPhone);
      if (!existingUser) {
        const isSuperAdminPhone = this.userRepo.isSuperAdmin(targetPhone);
        existingUser = await this.userRepo.upsertUser({
          phone_number: targetPhone,
          name: targetName,
          role: isSuperAdminPhone ? "super_admin" : "member",
          status: "active",
        });
      }

      // Generate 6-char cryptographically random code
      const inviteCode = "INV-" + crypto.randomBytes(3).toString("hex").toUpperCase();
      const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

      this.activeInvites.set(inviteCode, {
        code: inviteCode,
        phone: targetPhone,
        name: existingUser ? existingUser.name : targetName,
        role: existingUser ? existingUser.role : "member",
        expiresAt,
      });

      const inviteLink = `https://t.me/${this.bot.botInfo.username || "izaassistantbot"}?start=${inviteCode}`;

      await ctx.reply(
        `🎟️ *LINK UNDANGAN BERHASIL DIBUAT!*\n\n` +
        `• *Penerima:* ${targetName} (\`+${targetPhone}\`)\n` +
        `• *Peran:* ${existingUser?.role === "super_admin" ? "Super Admin" : "Staf Operasional"}\n` +
        `• *Masa Berlaku:* 15 Menit\n\n` +
        `👉 *Kirimkan link ini langsung ke Telegram penerima:*\n` +
        `${inviteLink}\n\n` +
        `_Begitu penerima mengklik tombol START dari link di atas, akun Telegram mereka akan otomatis terkunci permanen ke nomor tersebut._`,
        { parse_mode: "Markdown" }
      );
    });

    // 3. /start command: Handles both general start and invite claim token (?start=INV-XXXX)
    this.bot.command(["start", "menu", "help"], async (ctx) => {
      await this.clearPreviousKeyboard(ctx.chat?.id);
      const payload = ctx.match?.trim();

      // Case A: User is claiming an invite token
      if (payload && payload.startsWith("INV-")) {
        const invite = this.activeInvites.get(payload);

        if (!invite) {
          await ctx.reply(
            `⚠️ *Link undangan tidak valid atau sudah pernah digunakan.*\n\nSilakan minta Super Admin untuk membuat link undangan baru via \`/invite\`.`,
            { parse_mode: "Markdown" }
          );
          return;
        }

        if (Date.now() > invite.expiresAt) {
          this.activeInvites.delete(payload);
          await ctx.reply(
            `⚠️ *Link undangan telah kedaluwarsa (lewat dari 15 menit).*\n\nSilakan minta Super Admin untuk membuat link undangan baru via \`/invite\`.`,
            { parse_mode: "Markdown" }
          );
          return;
        }

        // Prevent Super Admin creator from accidentally claiming their own invite for someone else
        const currentUser = await this.resolveUserIdentity(ctx.from);
        if (currentUser.isAllowed && currentUser.isSuperAdmin && currentUser.phone !== invite.phone) {
          await ctx.reply(
            `⚠️ *Ini adalah Link Undangan khusus untuk ${invite.name} (+${invite.phone}).*\n\n` +
            `Akun Telegram Anda sudah resmi terdaftar sebagai Super Admin (*${currentUser.name}*).\n\n` +
            `👉 *Jangan klik link ini di akun Anda sendiri, melainkan teruskan/kirim link ini ke Telegram ${invite.name}* agar akun HP beliau yang diverifikasi.`,
            { parse_mode: "Markdown" }
          );
          return;
        }

        // Link Telegram ID permanently to database record
        const tgId = ctx.from?.id;
        await getSupabaseClient()
          .from("users")
          .update({ target_sheet_id: `tg_${tgId}`, updated_at: new Date().toISOString() })
          .eq("phone_number", invite.phone);

        if (tgId) {
          this.userPhoneMap.set(tgId, invite.phone);
        }

        // Single-use: delete invite code
        this.activeInvites.delete(payload);

        const roleDesc = invite.role === "super_admin" ? "Super Admin / Owner" : "Staf Operasional";
        await ctx.reply(
          `🎉 *VERIFIKASI BERHASIL! SELAMAT DATANG!*\n\n` +
          `Halo *${invite.name}*, akun Telegram Anda telah resmi terhubung dan diverifikasi dengan nomor \`+${invite.phone}\` sebagai *${roleDesc}*.\n\n` +
          `Sekarang Anda dapat langsung mencatat transaksi, kirim foto struk/nota, atau tanya saldo kas.`,
          { parse_mode: "Markdown" }
        );
        return;
      }

      // Case B: General /start or /menu
      const user = await this.resolveUserIdentity(ctx.from);
      if (!(await this.checkAccessOrDeny(ctx, user))) return;

      const welcomeText =
        `👋 *Halo ${user.name}! Selamat Datang di IZA Executive AI Assistant*\n\n` +
        `Saya adalah asisten keuangan cerdas yang terhubung langsung ke *Google Spreadsheet Kas & Supabase*.\n\n` +
        `✨ *Kemampuan yang bisa Anda gunakan:*\n` +
        `• 💬 *Ketik Transaksi:* _"Beli kopi 25rb cash"_ atau _"Pemasukan 5jt mandiri"_\n` +
        `• 📸 *Kirim Foto Struk/Nota:* Otomatis di-scan OCR & diunggah ke Google Drive\n` +
        `• 🎙️ *Kirim Voice Note:* Otomatis didengarkan & dicatat AI\n` +
        `• 📊 *Tanya Saldo & Laporan:* _"Berapa sisa saldo kas?"_ atau _"Rekap pengeluaran bulan ini"_\n` +
        `• 🔍 *Audit Keuangan:* _"Audit selisih pembukuan kas"_\n\n` +
        `Silakan pilih menu cepat di bawah atau langsung ketik pesan Anda:`;

      const buttons = [
        { id: "CHECK_BALANCE", title: "💰 Cek Saldo" },
        { id: "REKAP_KAS", title: "📊 Rekap Kas" },
        { id: "AUDIT_KAS", title: "🔍 Audit Kas" },
        { id: "SPREADSHEET", title: "📄 Spreadsheet" },
        { id: "GOOGLE_DRIVE", title: "📁 Google Drive" },
      ];

      await this.replyWithTrackedKeyboard(ctx, welcomeText, buttons);
    });

    // 4. Handle Inline Button Clicks (Callback Queries)
    this.bot.on("callback_query:data", async (ctx) => {
      const buttonId = ctx.callbackQuery.data;
      await ctx.answerCallbackQuery();

      // Cleanly remove the buttons from the clicked message immediately
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

      const user = await this.resolveUserIdentity(ctx.from);
      if (!user.isAllowed) {
        await ctx.reply("⛔ Akses ditolak. Anda belum memiliki izin akses.");
        return;
      }

      if (buttonId === "SPREADSHEET" || buttonId === "SHEET") {
        await ctx.reply(
          `📊 *LINK GOOGLE SPREADSHEET KAS:*\nhttps://docs.google.com/spreadsheets/d/${config.GOOGLE_SHEET_ID}/edit`,
          { parse_mode: "Markdown" }
        );
        return;
      }

      if (buttonId === "GOOGLE_DRIVE" || buttonId === "GDRIVE") {
        await ctx.reply(
          `📁 *LINK FOLDER GOOGLE DRIVE NOTA:*\nhttps://drive.google.com/drive/folders/${config.GOOGLE_DRIVE_FOLDER_ID}`,
          { parse_mode: "Markdown" }
        );
        return;
      }

      await ctx.api.sendChatAction(ctx.chat?.id || ctx.from.id, "typing");

      const mappedPrompt = BUTTON_ID_MAP[buttonId] || "";

      // Log inbound click intent
      await this.chatRepo.logMessage({
        user_phone: user.phone,
        user_name: user.name,
        message_type: "text",
        direction: "inbound",
        content: mappedPrompt || buttonId,
      });

      try {
        const result = await this.agentEngine.processIncomingMessage({
          userPhone: user.phone,
          userName: user.name,
          messageText: mappedPrompt,
          interactiveButtonId: buttonId,
        });

        // Log outbound response
        await this.chatRepo.logMessage({
          user_phone: user.phone,
          user_name: "IZA (AI)",
          message_type: "text",
          direction: "outbound",
          content: result.reply,
        });

        await this.sendResultReply(ctx, result);
      } catch (err: any) {
        logger.error({ err, buttonId }, "TelegramAssistantBot: Error processing callback query");
        await ctx.reply("⚠️ Terjadi kendala saat memproses pilihan Anda. Silakan coba lagi.");
      }
    });

    // 5. Handle Photos (Receipt / Struk Belanja)
    this.bot.on(":photo", async (ctx) => {
      await this.clearPreviousKeyboard(ctx.chat?.id);
      const user = await this.resolveUserIdentity(ctx.from);
      if (!(await this.checkAccessOrDeny(ctx, user))) return;

      const photos = ctx.message?.photo;
      if (!photos || photos.length === 0) return;

      const bestPhoto = photos[photos.length - 1];
      const caption = ctx.message?.caption || "";

      await ctx.reply("⏳ *Sedang membaca struk belanja dengan AI Vision...*", { parse_mode: "Markdown" });
      await ctx.api.sendChatAction(ctx.chat.id, "typing");

      const buffer = await this.downloadFileBuffer(bestPhoto.file_id);
      if (!buffer) {
        await ctx.reply("⚠️ Gagal mengunduh foto struk dari Telegram. Silakan coba kirim ulang.");
        return;
      }

      await this.chatRepo.logMessage({
        user_phone: user.phone,
        user_name: user.name,
        message_type: "image",
        direction: "inbound",
        content: caption || "Foto Struk Belanja",
      });

      try {
        const result = await this.agentEngine.processIncomingMessage({
          userPhone: user.phone,
          userName: user.name,
          messageText: caption,
          mediaBuffer: buffer,
          mediaMimeType: "image/jpeg",
        });

        await this.chatRepo.logMessage({
          user_phone: user.phone,
          user_name: "IZA (AI)",
          message_type: "text",
          direction: "outbound",
          content: result.reply,
        });

        await this.sendResultReply(ctx, result);
      } catch (err: any) {
        logger.error({ err }, "TelegramAssistantBot: Error processing photo");
        await ctx.reply("⚠️ Terjadi kendala saat menganalisis foto struk. Pastikan foto jelas dan tidak buram.");
      }
    });

    // 6. Handle Voice Notes / Audio
    this.bot.on([":voice", ":audio"], async (ctx) => {
      await this.clearPreviousKeyboard(ctx.chat?.id);
      const user = await this.resolveUserIdentity(ctx.from);
      if (!(await this.checkAccessOrDeny(ctx, user))) return;

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

      await this.chatRepo.logMessage({
        user_phone: user.phone,
        user_name: user.name,
        message_type: "audio",
        direction: "inbound",
        content: "Voice Note Audio",
      });

      try {
        const result = await this.agentEngine.processIncomingMessage({
          userPhone: user.phone,
          userName: user.name,
          messageText: "",
          mediaBuffer: buffer,
          mediaMimeType: mimeType,
        });

        await this.chatRepo.logMessage({
          user_phone: user.phone,
          user_name: "IZA (AI)",
          message_type: "text",
          direction: "outbound",
          content: result.reply,
        });

        await this.sendResultReply(ctx, result);
      } catch (err: any) {
        logger.error({ err }, "TelegramAssistantBot: Error processing voice message");
        await ctx.reply("⚠️ Terjadi kendala saat memproses rekaman suara. Silakan coba kembali.");
      }
    });

    // 7. Handle Document (PDF Invoices / Nota file)
    this.bot.on(":document", async (ctx) => {
      await this.clearPreviousKeyboard(ctx.chat?.id);
      const user = await this.resolveUserIdentity(ctx.from);
      if (!(await this.checkAccessOrDeny(ctx, user))) return;

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

      await this.chatRepo.logMessage({
        user_phone: user.phone,
        user_name: user.name,
        message_type: "document",
        direction: "inbound",
        content: `Dokumen: ${fileName}`,
      });

      try {
        const result = await this.agentEngine.processIncomingMessage({
          userPhone: user.phone,
          userName: user.name,
          messageText: ctx.message?.caption || "",
          mediaBuffer: buffer,
          mediaMimeType: isPdf ? "application/pdf" : mimeType,
        });

        await this.chatRepo.logMessage({
          user_phone: user.phone,
          user_name: "IZA (AI)",
          message_type: "text",
          direction: "outbound",
          content: result.reply,
        });

        await this.sendResultReply(ctx, result);
      } catch (err: any) {
        logger.error({ err }, "TelegramAssistantBot: Error processing document");
        await ctx.reply("⚠️ Terjadi kendala saat memproses dokumen.");
      }
    });

    // 8. Handle Natural Text Messages
    this.bot.on(":text", async (ctx) => {
      await this.clearPreviousKeyboard(ctx.chat?.id);
      const user = await this.resolveUserIdentity(ctx.from);
      if (!(await this.checkAccessOrDeny(ctx, user))) return;

      const text = ctx.message?.text || "";
      if (!text.trim()) return;

      await ctx.api.sendChatAction(ctx.chat.id, "typing");

      // Log inbound user message
      await this.chatRepo.logMessage({
        user_phone: user.phone,
        user_name: user.name,
        message_type: "text",
        direction: "inbound",
        content: text,
      });

      try {
        const result = await this.agentEngine.processIncomingMessage({
          userPhone: user.phone,
          userName: user.name,
          messageText: text,
        });

        // Log outbound AI response
        await this.chatRepo.logMessage({
          user_phone: user.phone,
          user_name: "IZA (AI)",
          message_type: "text",
          direction: "outbound",
          content: result.reply,
        });

        await this.sendResultReply(ctx, result);
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
    logger.info("Starting Telegram Executive AI Assistant Bot (@izaassistantbot)...");
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
