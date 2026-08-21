import { TransactionRepository } from "../db/repositories/transaction.repository.js";
import { UserRepository } from "../db/repositories/user.repository.js";
import { getGlobalSocket } from "../bot/socket-holder.js";
import { formatDailyRecap } from "../bot/formatters/reply.formatter.js";
import { logger } from "../utils/logger.js";

export class SchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private lastRecapDate: string = "";

  constructor(
    private trxRepo: TransactionRepository,
    private userRepo: UserRepository
  ) {}

  start(): void {
    logger.info("Starting background scheduler service (Makassar / WITA timezone)...");

    // Check every 30 seconds
    this.timer = setInterval(async () => {
      try {
        await this.checkScheduledTasks();
      } catch (err) {
        logger.error({ err }, "Error in scheduler background cycle");
      }
    }, 30_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async checkScheduledTasks(): Promise<void> {
    const now = new Date();
    const makassarTimeStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Makassar",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(now);

    // Format: "YYYY-MM-DD, HH:mm"
    const [datePart, timePart] = makassarTimeStr.split(", ");
    const [hourStr, minuteStr] = timePart.split(":");
    const hour = parseInt(hourStr, 10);
    const minute = parseInt(minuteStr, 10);

    // 1. Daily Recap at 20:00 WITA (between 20:00 and 20:05)
    if (hour === 20 && minute < 5 && this.lastRecapDate !== datePart) {
      logger.info({ makassarTimeStr }, "Triggering nightly daily recap to Super Admins...");
      await this.sendNightlyRecap(datePart);
      this.lastRecapDate = datePart;
    }
  }

  async sendNightlyRecap(targetDate?: string): Promise<{ success: boolean; recipientCount: number }> {
    const dateStr =
      targetDate ||
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(new Date());

    const sock = getGlobalSocket();
    if (!sock) {
      logger.warn("WhatsApp socket not connected yet, skipping scheduled recap");
      return { success: false, recipientCount: 0 };
    }

    try {
      const dailySummary = await this.trxRepo.getDailyTransactionsSummary(dateStr);
      const wallet = await this.trxRepo.getWalletBalance();
      const messageText = formatDailyRecap(dailySummary, wallet);

      // Get active super admins from database
      const users = await this.userRepo.listActiveUsers();
      const superAdmins = users.filter((u) => u.role === "super_admin" && u.status === "active");

      if (superAdmins.length === 0) {
        logger.warn("No active Super Admins found in DB to receive nightly recap");
        return { success: false, recipientCount: 0 };
      }

      let sentCount = 0;
      for (const admin of superAdmins) {
        const jid = `${admin.phone_number}@s.whatsapp.net`;
        try {
          await sock.sendMessage(jid, { text: messageText });
          logger.info({ jid, phone: admin.phone_number }, "Nightly recap sent to Super Admin");
          sentCount++;
        } catch (sendErr) {
          logger.error({ sendErr, phone: admin.phone_number }, "Failed to send nightly recap to Super Admin");
        }
      }

      return { success: true, recipientCount: sentCount };
    } catch (err) {
      logger.error({ err }, "Error generating nightly recap");
      return { success: false, recipientCount: 0 };
    }
  }
}
