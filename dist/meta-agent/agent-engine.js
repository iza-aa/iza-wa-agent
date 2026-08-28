import { BudgetRepository } from "../db/repositories/budget.repository.js";
import { BillRepository } from "../db/repositories/bill.repository.js";
import { googleSheetsService } from "../google/sheets.service.js";
import { googleDriveService } from "../google/drive.service.js";
import { pdfReportService } from "../services/pdf-report.service.js";
import { knowledgeLoader } from "./knowledge-loader.js";
import { ContextBuilder } from "./context-builder.js";
import { agyConnector } from "./agy-connector.js";
import { ConfirmationFlow } from "./confirmation-flow.js";
import { buildSystemPrompt } from "./agent-persona.js";
import { parseReceiptVision } from "../ai/parsers/receipt-vision.parser.js";
import { parseAudioVoiceNote } from "../ai/parsers/audio.parser.js";
import { formatRupiah } from "../bot/formatters/reply.formatter.js";
import { logger } from "../utils/logger.js";
export class AgentEngine {
    supabase;
    trxRepo;
    userRepo;
    chatRepo;
    pendingRepo;
    contextBuilder;
    confirmationFlow;
    budgetRepo;
    billRepo;
    constructor(supabase, trxRepo, userRepo, chatRepo, pendingRepo) {
        this.supabase = supabase;
        this.trxRepo = trxRepo;
        this.userRepo = userRepo;
        this.chatRepo = chatRepo;
        this.pendingRepo = pendingRepo;
        this.budgetRepo = new BudgetRepository(supabase);
        this.billRepo = new BillRepository(supabase);
        this.contextBuilder = new ContextBuilder(supabase, trxRepo, chatRepo, userRepo);
        this.confirmationFlow = new ConfirmationFlow(pendingRepo, trxRepo, userRepo, this.budgetRepo, this.billRepo);
    }
    /**
     * Main entry point for processing incoming messages from Meta WhatsApp
     */
    async processIncomingMessage(params) {
        const { userPhone, userName, messageText, mediaBuffer, mediaMimeType, interactiveButtonId } = params;
        const effectiveText = (interactiveButtonId || messageText || "").trim();
        logger.info({ userPhone, userName, hasMedia: !!mediaBuffer, textLength: effectiveText.length }, "AgentEngine: Processing message");
        // 0. Check for Direct Sync Request (/sync or "sinkron")
        if (effectiveText.toLowerCase() === "/sync" ||
            effectiveText.toLowerCase() === "sync" ||
            effectiveText.toLowerCase() === "sinkronkan data") {
            try {
                logger.info({ userPhone }, "Triggering Google Sheets -> Supabase sync");
                await googleSheetsService.syncFromSheetToDatabase(this.trxRepo);
                const wallet = await this.trxRepo.getWalletBalance();
                return {
                    reply: `🔄 *Sinkronisasi Berhasil!*\n\nData dari Google Spreadsheet telah berhasil ditarik dan diselaraskan dengan database Supabase.\n\n💵 *Saldo Kas Terkini:* *${formatRupiah(wallet.balance)}*`,
                    buttons: [{ id: "CHECK_BALANCE", title: "📊 Cek Saldo Kas" }],
                    success: true,
                };
            }
            catch (syncErr) {
                return {
                    reply: `⚠️ Terjadi kendala saat sinkronisasi: ${syncErr?.message || "Koneksi Google Sheets"}`,
                    success: false,
                };
            }
        }
        // 1. Check for Active Pending Draft (Confirmation State Machine)
        const activeDraft = await this.confirmationFlow.getActiveDraft(userPhone);
        if (activeDraft) {
            const decision = this.confirmationFlow.classifyUserDecision(effectiveText);
            // CASE A: User Confirms ("Ya", "Oke", "Gas", [✅ Simpan], [✅ Ya, Lanjutkan])
            if (decision.type === "CONFIRM") {
                logger.info({ userPhone, draftId: activeDraft.id, actionType: activeDraft.action_type }, "User confirmed pending draft");
                const execResult = await this.confirmationFlow.executeConfirmedDraft(activeDraft, mediaBuffer, mediaMimeType);
                return {
                    reply: execResult.replyText,
                    buttons: [{ id: "CHECK_REKAP", title: "📊 Lihat Rekap" }],
                    success: execResult.success,
                };
            }
            // CASE B: User Cancels ("Batal", "Gak jadi", [❌ Batal], [❌ Batalkan])
            if (decision.type === "CANCEL") {
                logger.info({ userPhone, draftId: activeDraft.id }, "User cancelled pending draft");
                const cancelText = await this.confirmationFlow.cancelActiveDraft(activeDraft);
                return {
                    reply: cancelText,
                    success: true,
                };
            }
            // CASE C: User Modifies ("Ganti jadi BCA", "Bukan 50rb tapi 40rb")
            if (decision.type === "MODIFY" && activeDraft.action_type === "CREATE_TRANSACTION") {
                logger.info({ userPhone, modification: decision.modificationText }, "User requested modification on pending draft");
                const knowledgeText = await knowledgeLoader.loadAllKnowledge();
                const dataContext = await this.contextBuilder.buildContext(userPhone, userName, effectiveText);
                const systemPrompt = buildSystemPrompt(knowledgeText, `${dataContext}\n\n--- DRAF AKTIF SAAT INI (YANG INGIN DIUBAH PENGGUNA) ---\n${JSON.stringify(activeDraft.payload, null, 2)}`);
                const aiResponse = await agyConnector.chat(systemPrompt, `Pengguna ingin merevisi draf di atas dengan permintaan: "${decision.modificationText}". Perbarui objek transaction_draft sesuai revisi tersebut.`, userPhone);
                if (aiResponse.transaction_draft && aiResponse.transaction_draft.total_amount > 0) {
                    await this.pendingRepo.updatePayload(activeDraft.id, aiResponse.transaction_draft, userPhone);
                    const preview = this.confirmationFlow.formatDraftPreview(aiResponse.transaction_draft);
                    return {
                        reply: `✏️ *Draf Diperbarui!*\n\n${preview}`,
                        buttons: [
                            { id: "CONFIRM_ACTION", title: "✅ Simpan Sekarang" },
                            { id: "CANCEL_ACTION", title: "❌ Batalkan" },
                        ],
                        success: true,
                    };
                }
            }
        }
        // 2. Handle Media Messages (Image / Receipt Photo / PDF / Voice Note)
        if (mediaBuffer && mediaMimeType) {
            if (mediaMimeType.startsWith("image/") || mediaMimeType.includes("pdf")) {
                try {
                    const parsedReceipt = await parseReceiptVision(mediaBuffer, mediaMimeType, effectiveText);
                    if (parsedReceipt && parsedReceipt.total_amount > 0) {
                        const draft = {
                            merchant: parsedReceipt.merchant || "Toko / Struk",
                            date: parsedReceipt.date || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(new Date()),
                            type: "expense",
                            category: parsedReceipt.category || "Belanja Bulanan",
                            subtotal: parsedReceipt.subtotal || parsedReceipt.total_amount,
                            tax: parsedReceipt.tax || 0,
                            discount: parsedReceipt.discount || 0,
                            total_amount: parsedReceipt.total_amount,
                            payment_method: parsedReceipt.payment_method || "Cash",
                            items: (parsedReceipt.items || []).map((it) => ({
                                item_name: it.item_name,
                                qty: it.qty || 1,
                                unit: it.unit || "unit",
                                price: it.price || 0,
                                total_price: it.total_price || (it.qty || 1) * (it.price || 0),
                                department: it.department || "Kafe",
                            })),
                            raw_text: effectiveText || "Foto Struk Belanja",
                        };
                        await this.confirmationFlow.createDraft(userPhone, userName, "CREATE_TRANSACTION", draft);
                        const preview = this.confirmationFlow.formatDraftPreview(draft);
                        return {
                            reply: `📸 *Foto Struk Terbaca!*\n\n${preview}`,
                            buttons: [
                                { id: "CONFIRM_ACTION", title: "✅ Simpan Sekarang" },
                                { id: "CANCEL_ACTION", title: "❌ Batalkan" },
                            ],
                            success: true,
                        };
                    }
                }
                catch (visionErr) {
                    logger.error({ visionErr }, "Failed to process receipt vision in AgentEngine");
                }
            }
            if (mediaMimeType.startsWith("audio/")) {
                try {
                    const audioResult = await parseAudioVoiceNote(mediaBuffer, mediaMimeType);
                    const transcription = audioResult.transcription || "";
                    if (audioResult.is_question) {
                        return await this.processIncomingMessage({
                            userPhone,
                            userName,
                            messageText: transcription,
                        });
                    }
                    if (audioResult.transaction && audioResult.transaction.total_amount > 0) {
                        const draft = {
                            merchant: audioResult.transaction.merchant || "Pengeluaran Kas",
                            date: audioResult.transaction.date || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(new Date()),
                            type: "expense",
                            category: audioResult.transaction.category || "Makanan & Minuman",
                            subtotal: audioResult.transaction.subtotal || audioResult.transaction.total_amount,
                            total_amount: audioResult.transaction.total_amount,
                            payment_method: audioResult.transaction.payment_method || "Cash",
                            items: (audioResult.transaction.items || []).map((it) => ({
                                item_name: it.item_name,
                                qty: it.qty || 1,
                                unit: it.unit || "unit",
                                price: it.price || 0,
                                total_price: it.total_price || (it.qty || 1) * (it.price || 0),
                                department: it.department || "Kafe",
                            })),
                            raw_text: transcription,
                        };
                        await this.confirmationFlow.createDraft(userPhone, userName, "CREATE_TRANSACTION", draft);
                        const preview = this.confirmationFlow.formatDraftPreview(draft);
                        return {
                            reply: `🎧 *Suara Terdeteksi:* _"${transcription}"_\n\n${preview}`,
                            buttons: [
                                { id: "CONFIRM_ACTION", title: "✅ Simpan Sekarang" },
                                { id: "CANCEL_ACTION", title: "❌ Batalkan" },
                            ],
                            success: true,
                        };
                    }
                    else if (audioResult.clarification_question) {
                        return {
                            reply: `🗣️ *Transkrip Suara:* _"${transcription}"_\n\n❓ ${audioResult.clarification_question}`,
                            success: true,
                        };
                    }
                }
                catch (audioErr) {
                    logger.error({ audioErr }, "Failed to process audio note in AgentEngine");
                }
            }
        }
        // 3. Process Natural Text Message via AI Agent
        const knowledgeText = await knowledgeLoader.loadAllKnowledge();
        const dataContext = await this.contextBuilder.buildContext(userPhone, userName, effectiveText);
        const systemPrompt = buildSystemPrompt(knowledgeText, dataContext);
        const aiResponse = await agyConnector.chat(systemPrompt, effectiveText, userPhone);
        // Case 3A: Propose creating a new transaction
        if (aiResponse.response_type === "DRAFT_TRANSACTION" &&
            aiResponse.transaction_draft &&
            aiResponse.transaction_draft.total_amount > 0) {
            const draft = aiResponse.transaction_draft;
            draft.raw_text = effectiveText;
            await this.confirmationFlow.createDraft(userPhone, userName, "CREATE_TRANSACTION", draft);
            const preview = this.confirmationFlow.formatDraftPreview(draft);
            return {
                reply: `${aiResponse.reply_text ? `${aiResponse.reply_text}\n\n` : ""}${preview}`,
                buttons: [
                    { id: "CONFIRM_ACTION", title: "✅ Simpan Sekarang" },
                    { id: "CANCEL_ACTION", title: "❌ Batalkan" },
                ],
                success: true,
            };
        }
        // Case 3B: Propose deleting a transaction
        if (aiResponse.response_type === "DRAFT_DELETE" && aiResponse.delete_draft?.transaction_id) {
            const del = aiResponse.delete_draft;
            await this.confirmationFlow.createDraft(userPhone, userName, "DELETE_TRANSACTION", del);
            const confirmText = `${aiResponse.reply_text}\n\n⚠️ *KONFIRMASI PENGHAPUSAN:*\n• ID: \`${del.transaction_id}\`\n• Keterangan: ${del.merchant || "-"}\n• Nominal: ${del.total_amount ? formatRupiah(del.total_amount) : "-"}\n\n👉 *Apakah Anda yakin ingin menghapus transaksi ini?*`;
            return {
                reply: confirmText,
                buttons: [
                    { id: "CONFIRM_ACTION", title: "✅ Ya, Hapus" },
                    { id: "CANCEL_ACTION", title: "❌ Batalkan" },
                ],
                success: true,
            };
        }
        // Case 3C: Propose editing a transaction
        if (aiResponse.response_type === "DRAFT_EDIT" && aiResponse.edit_draft?.transaction_id) {
            const ed = aiResponse.edit_draft;
            await this.confirmationFlow.createDraft(userPhone, userName, "EDIT_TRANSACTION", ed);
            const confirmText = `${aiResponse.reply_text}\n\n✏️ *KONFIRMASI PERUBAHAN:*\n• ID: \`${ed.transaction_id}\`\n• Ringkasan Perubahan: ${ed.summary}\n\n👉 *Apakah Anda yakin ingin menyimpan perubahan ini?*`;
            return {
                reply: confirmText,
                buttons: [
                    { id: "CONFIRM_ACTION", title: "✅ Ya, Simpan" },
                    { id: "CANCEL_ACTION", title: "❌ Batalkan" },
                ],
                success: true,
            };
        }
        // Case 3D: Propose Mutasi Antar Rekening (Transfer)
        if (aiResponse.response_type === "DRAFT_TRANSFER" && aiResponse.transfer_draft?.amount) {
            const tr = aiResponse.transfer_draft;
            await this.confirmationFlow.createDraft(userPhone, userName, "TRANSFER_BALANCE", tr);
            const confirmText = `${aiResponse.reply_text}\n\n🔄 *KONFIRMASI MUTASI SALDO:*\n• Dari: *${tr.source_pocket}*\n• Ke: *${tr.target_pocket}*\n• Nominal: *${formatRupiah(tr.amount)}*\n• Keterangan: ${tr.notes || "-"}\n\n👉 *Apakah Anda ingin mencatat mutasi saldo ini?*`;
            return {
                reply: confirmText,
                buttons: [
                    { id: "CONFIRM_ACTION", title: "✅ Ya, Mutasikan" },
                    { id: "CANCEL_ACTION", title: "❌ Batalkan" },
                ],
                success: true,
            };
        }
        // Case 3E: Propose User Management Action (Add, Block, Unblock, Change Role)
        if (aiResponse.response_type === "DRAFT_USER_ACTION" && aiResponse.user_draft?.target_phone) {
            const ud = aiResponse.user_draft;
            await this.confirmationFlow.createDraft(userPhone, userName, "MANAGE_USER", ud);
            const confirmText = `${aiResponse.reply_text}\n\n👥 *KONFIRMASI AKSI PENGGUNA:*\n• Aksi: *${ud.action}*\n• Target: +${ud.target_phone}${ud.target_name ? ` (${ud.target_name})` : ""}\n• Peran: ${ud.role || "-"}\n\n👉 *Apakah Anda yakin ingin mengeksekusi aksi ini?*`;
            return {
                reply: confirmText,
                buttons: [
                    { id: "CONFIRM_ACTION", title: "✅ Ya, Lanjutkan" },
                    { id: "CANCEL_ACTION", title: "❌ Batalkan" },
                ],
                success: true,
            };
        }
        // Case 3F: Propose Budget Management Action
        if (aiResponse.response_type === "DRAFT_BUDGET_ACTION" && aiResponse.budget_draft?.category) {
            const bg = aiResponse.budget_draft;
            await this.confirmationFlow.createDraft(userPhone, userName, "MANAGE_BUDGET", bg);
            const confirmText = `${aiResponse.reply_text}\n\n🎯 *KONFIRMASI PENGATURAN ANGGARAN:*\n• Kategori: *${bg.category}*\n• Limit: *${formatRupiah(bg.limit_amount)}*\n• Periode: ${bg.month}\n\n👉 *Apakah Anda ingin menyimpan anggaran ini?*`;
            return {
                reply: confirmText,
                buttons: [
                    { id: "CONFIRM_ACTION", title: "✅ Ya, Set Budget" },
                    { id: "CANCEL_ACTION", title: "❌ Batalkan" },
                ],
                success: true,
            };
        }
        // Case 3G: Propose Bill Management Action
        if (aiResponse.response_type === "DRAFT_BILL_ACTION" && aiResponse.bill_draft?.bill_name) {
            const bl = aiResponse.bill_draft;
            await this.confirmationFlow.createDraft(userPhone, userName, "MANAGE_BILL", bl);
            const confirmText = `${aiResponse.reply_text}\n\n📅 *KONFIRMASI JADWAL TAGIHAN:*\n• Tagihan: *${bl.bill_name}*\n• Nominal: *${formatRupiah(bl.amount)}*\n• Jatuh Tempo: Tgl ${bl.due_day}\n\n👉 *Apakah Anda ingin mendaftarkan tagihan ini?*`;
            return {
                reply: confirmText,
                buttons: [
                    { id: "CONFIRM_ACTION", title: "✅ Ya, Daftarkan" },
                    { id: "CANCEL_ACTION", title: "❌ Batalkan" },
                ],
                success: true,
            };
        }
        // Case 3H: Direct User Name Update
        if (aiResponse.response_type === "UPDATE_NAME" && aiResponse.new_name) {
            try {
                await this.userRepo.updateUserName(userPhone, aiResponse.new_name);
                return {
                    reply: `✏️ *Nama Berhasil Diperbarui!*\n\nNama tampilan Anda telah diubah menjadi: *${aiResponse.new_name}*.`,
                    success: true,
                };
            }
            catch (nameErr) {
                return {
                    reply: `⚠️ Gagal mengubah nama: ${nameErr?.message || "Kesalahan database"}`,
                    success: false,
                };
            }
        }
        // Case 3I: Export PDF Report
        if (aiResponse.response_type === "EXPORT_PDF") {
            const targetMonth = aiResponse.export_year_month ||
                new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Makassar" }).format(new Date()).slice(0, 7);
            try {
                const summary = await this.trxRepo.getMonthlySummary(targetMonth);
                const [year, month] = targetMonth.split("-");
                const lastDay = new Date(parseInt(year, 10), parseInt(month, 10), 0).getDate();
                const transactions = await this.trxRepo.getTransactionsByDateRange(`${targetMonth}-01`, `${targetMonth}-${lastDay.toString().padStart(2, "0")}`);
                const pdfBuffer = await pdfReportService.generateMonthlyReportPdf({
                    targetMonth,
                    totalIncome: summary.totalIncome || 0,
                    totalExpense: summary.totalExpense !== undefined ? summary.totalExpense : summary.total,
                    netCashflow: summary.netCashflow !== undefined
                        ? summary.netCashflow
                        : (summary.totalIncome || 0) - (summary.totalExpense || summary.total),
                    count: summary.count,
                    byCategory: summary.byCategory || {},
                    transactions,
                });
                // Upload PDF to Google Drive so user can click and view immediately
                const uploadRes = await googleDriveService.uploadReceipt(pdfBuffer, `Laporan_Keuangan_${targetMonth}`, userName, true);
                return {
                    reply: `📄 *Dokumen PDF Laporan Keuangan (${targetMonth}) Selesai Dibuat!*\n\n• Total Pemasukan: ${formatRupiah(summary.totalIncome || 0)}\n• Total Pengeluaran: ${formatRupiah(summary.totalExpense || summary.total)}\n• Arus Kas Bersih: ${formatRupiah(summary.netCashflow || 0)}\n• Jumlah Transaksi: ${summary.count} transaksi\n\n🔗 *Unduh & Buka Dokumen PDF:* \n${uploadRes.webViewLink}`,
                    buttons: [{ id: "CHECK_BALANCE", title: "📊 Cek Saldo Kas" }],
                    success: true,
                };
            }
            catch (pdfErr) {
                logger.error({ pdfErr }, "Failed to generate PDF report in Meta WA");
                return {
                    reply: `⚠️ Terjadi kendala saat menyusun dokumen PDF laporan keuangan: ${pdfErr?.message}`,
                    success: false,
                };
            }
        }
        // Otherwise, return AI's natural conversational response
        return {
            reply: aiResponse.reply_text || "Halo! Ada yang bisa saya bantu terkait pencatatan kas?",
            buttons: aiResponse.suggested_buttons,
            success: true,
        };
    }
}
//# sourceMappingURL=agent-engine.js.map