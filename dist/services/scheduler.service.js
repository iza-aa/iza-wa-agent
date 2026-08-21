import { getGlobalSocket } from "../bot/socket-holder.js";
import { formatDailyRecap, formatBillReminder } from "../bot/formatters/reply.formatter.js";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";
export class SchedulerService {
    trxRepo;
    userRepo;
    billRepo;
    timer = null;
    lastRecapDate = "";
    lastBillCheckDate = "";
    constructor(trxRepo, userRepo, billRepo) {
        this.trxRepo = trxRepo;
        this.userRepo = userRepo;
        this.billRepo = billRepo;
    }
    start() {
        logger.info("Starting background scheduler service (Makassar / WITA timezone)...");
        // Check every 30 seconds
        this.timer = setInterval(async () => {
            try {
                await this.checkScheduledTasks();
            }
            catch (err) {
                logger.error({ err }, "Error in scheduler background cycle");
            }
        }, 30_000);
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    async checkScheduledTasks() {
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
        // 1. Morning Bill Reminders at 08:00 WITA (between 08:00 and 08:05)
        if (hour === 8 && minute < 5 && this.lastBillCheckDate !== datePart) {
            logger.info({ makassarTimeStr }, "Triggering morning bill reminders to Super Admins...");
            await this.sendMorningBillReminders(datePart);
            this.lastBillCheckDate = datePart;
        }
        // 2. Daily Recap at 20:00 WITA (between 20:00 and 20:05)
        if (hour === 20 && minute < 5 && this.lastRecapDate !== datePart) {
            logger.info({ makassarTimeStr }, "Triggering nightly daily recap to Super Admins...");
            await this.sendNightlyRecap(datePart);
            this.lastRecapDate = datePart;
        }
    }
    async getSuperAdminJids() {
        const phones = new Set();
        // 1. From environment config
        for (const p of config.SUPER_ADMIN_PHONE) {
            if (p && p.length <= 14) {
                phones.add(p);
            }
        }
        // 2. From database
        try {
            const users = await this.userRepo.listActiveUsers();
            for (const u of users) {
                if (u.role === "super_admin" && u.status === "active" && u.phone_number.length <= 14) {
                    phones.add(u.phone_number);
                }
            }
        }
        catch (err) {
            logger.warn({ err }, "Could not fetch users from database for Super Admin notifications, using config phones");
        }
        return Array.from(phones).map((p) => `${p}@s.whatsapp.net`);
    }
    async sendMorningBillReminders(targetDate) {
        if (!this.billRepo)
            return { success: false, reminderCount: 0 };
        const dateStr = targetDate || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(new Date());
        const [year, month, dayStr] = dateStr.split("-");
        const currentDay = parseInt(dayStr, 10);
        const currentMonth = `${year}-${month}`;
        const sock = getGlobalSocket();
        if (!sock)
            return { success: false, reminderCount: 0 };
        try {
            const bills = await this.billRepo.listActiveBills();
            const superAdminJids = await this.getSuperAdminJids();
            let reminderCount = 0;
            for (const bill of bills) {
                if (bill.last_paid_period === currentMonth)
                    continue;
                const reminderDays = bill.reminder_days_before || 3;
                const daysLeft = bill.due_day - currentDay;
                // Trigger reminder if due today or within reminder window (e.g. H-3 to H-0)
                if (daysLeft >= 0 && daysLeft <= reminderDays) {
                    const reminderText = formatBillReminder(bill, daysLeft);
                    for (const jid of superAdminJids) {
                        try {
                            await sock.sendMessage(jid, { text: reminderText });
                            reminderCount++;
                        }
                        catch (err) {
                            logger.error({ err, jid }, "Failed to send bill reminder");
                        }
                    }
                }
            }
            return { success: true, reminderCount };
        }
        catch (err) {
            logger.error({ err }, "Error sending morning bill reminders");
            return { success: false, reminderCount: 0 };
        }
    }
    async sendNightlyRecap(targetDate) {
        const dateStr = targetDate ||
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
            const superAdminJids = await this.getSuperAdminJids();
            if (superAdminJids.length === 0) {
                logger.warn("No active Super Admins found to receive nightly recap");
                return { success: false, recipientCount: 0 };
            }
            let sentCount = 0;
            for (const jid of superAdminJids) {
                try {
                    await sock.sendMessage(jid, { text: messageText });
                    logger.info({ jid }, "Nightly recap sent to Super Admin");
                    sentCount++;
                }
                catch (sendErr) {
                    logger.error({ sendErr, jid }, "Failed to send nightly recap to Super Admin");
                }
            }
            return { success: true, recipientCount: sentCount };
        }
        catch (err) {
            logger.error({ err }, "Error generating nightly recap");
            return { success: false, recipientCount: 0 };
        }
    }
}
//# sourceMappingURL=scheduler.service.js.map