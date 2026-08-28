import { SupabaseClient } from "@supabase/supabase-js";
import { TransactionRepository } from "../db/repositories/transaction.repository.js";
import { UserRepository } from "../db/repositories/user.repository.js";
import { ChatRepository } from "../db/repositories/chat.repository.js";
import { PendingActionRepository } from "../db/repositories/pending-action.repository.js";
import { knowledgeLoader } from "./knowledge-loader.js";
import { ContextBuilder } from "./context-builder.js";
import { agyConnector } from "./agy-connector.js";
import { ConfirmationFlow } from "./confirmation-flow.js";
import { buildSystemPrompt, TransactionDraft } from "./agent-persona.js";
import { parseReceiptVision } from "../ai/parsers/receipt-vision.parser.js";
import { parseAudioVoiceNote } from "../ai/parsers/audio.parser.js";
import { metaApiClient, InteractiveButton } from "./meta-api.client.js";
import { logger } from "../utils/logger.js";

export interface AgentProcessResult {
  reply: string;
  buttons?: InteractiveButton[];
  success: boolean;
}

export class AgentEngine {
  private contextBuilder: ContextBuilder;
  private confirmationFlow: ConfirmationFlow;

  constructor(
    private supabase: SupabaseClient,
    private trxRepo: TransactionRepository,
    private userRepo: UserRepository,
    private chatRepo: ChatRepository,
    private pendingRepo: PendingActionRepository
  ) {
    this.contextBuilder = new ContextBuilder(supabase, trxRepo, chatRepo, userRepo);
    this.confirmationFlow = new ConfirmationFlow(pendingRepo, trxRepo, userRepo);
  }

  /**
   * Main entry point for processing incoming messages from Meta WhatsApp
   */
  async processIncomingMessage(params: {
    userPhone: string;
    userName: string;
    messageText: string;
    mediaBuffer?: Buffer;
    mediaMimeType?: string;
    interactiveButtonId?: string;
  }): Promise<AgentProcessResult> {
    const { userPhone, userName, messageText, mediaBuffer, mediaMimeType, interactiveButtonId } = params;
    const effectiveText = (interactiveButtonId || messageText || "").trim();

    logger.info({ userPhone, userName, hasMedia: !!mediaBuffer, textLength: effectiveText.length }, "AgentEngine: Processing message");

    // 1. Check for Active Pending Draft (Confirmation State Machine)
    const activeDraft = await this.confirmationFlow.getActiveDraft(userPhone);

    if (activeDraft) {
      const decision = this.confirmationFlow.classifyUserDecision(effectiveText);

      // CASE A: User Confirms ("Ya", "Oke", "Gas", [✅ Simpan])
      if (decision.type === "CONFIRM") {
        logger.info({ userPhone, draftId: activeDraft.id }, "User confirmed pending draft");
        const execResult = await this.confirmationFlow.executeConfirmedDraft(
          activeDraft,
          mediaBuffer,
          mediaMimeType
        );
        return {
          reply: execResult.replyText,
          success: execResult.success,
        };
      }

      // CASE B: User Cancels ("Batal", "Gak jadi", [❌ Batal])
      if (decision.type === "CANCEL") {
        logger.info({ userPhone, draftId: activeDraft.id }, "User cancelled pending draft");
        const cancelText = await this.confirmationFlow.cancelActiveDraft(activeDraft);
        return {
          reply: cancelText,
          success: true,
        };
      }

      // CASE C: User Modifies ("Ganti jadi BCA", "Bukan 50rb tapi 40rb")
      if (decision.type === "MODIFY") {
        logger.info({ userPhone, modification: decision.modificationText }, "User requested modification on pending draft");
        // We will feed the modification back to AI along with the previous draft
        const knowledgeText = await knowledgeLoader.loadAllKnowledge();
        const dataContext = await this.contextBuilder.buildContext(userPhone, userName, effectiveText);
        const systemPrompt = buildSystemPrompt(
          knowledgeText,
          `${dataContext}\n\n--- DRAF AKTIF SAAT INI (YANG INGIN DIUBAH PENGGUNA) ---\n${JSON.stringify(activeDraft.payload, null, 2)}`
        );

        const aiResponse = await agyConnector.chat(
          systemPrompt,
          `Pengguna ingin merevisi draf di atas dengan permintaan: "${decision.modificationText}". Perbarui objek transaction_draft sesuai revisi tersebut.`,
          userPhone
        );

        if (aiResponse.transaction_draft && aiResponse.transaction_draft.total_amount > 0) {
          // Update draft in database
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
      // Image / PDF Receipt
      if (mediaMimeType.startsWith("image/") || mediaMimeType.includes("pdf")) {
        try {
          const parsedReceipt = await parseReceiptVision(mediaBuffer, mediaMimeType, effectiveText);
          if (parsedReceipt && parsedReceipt.total_amount > 0) {
            const draft: TransactionDraft = {
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

            await this.confirmationFlow.createDraft(userPhone, userName, draft);
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
        } catch (visionErr) {
          logger.error({ visionErr }, "Failed to process receipt vision in AgentEngine");
        }
      }

      // Audio / Voice Note
      if (mediaMimeType.startsWith("audio/")) {
        try {
          const audioResult = await parseAudioVoiceNote(mediaBuffer, mediaMimeType);
          const transcription = audioResult.transcription || "";

          if (audioResult.is_question) {
            // Forward voice question to text reasoning below
            return await this.processIncomingMessage({
              userPhone,
              userName,
              messageText: transcription,
            });
          }

          if (audioResult.transaction && audioResult.transaction.total_amount > 0) {
            const draft: TransactionDraft = {
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

            await this.confirmationFlow.createDraft(userPhone, userName, draft);
            const preview = this.confirmationFlow.formatDraftPreview(draft);

            return {
              reply: `🎧 *Suara Terdeteksi:* _"${transcription}"_\n\n${preview}`,
              buttons: [
                { id: "CONFIRM_ACTION", title: "✅ Simpan Sekarang" },
                { id: "CANCEL_ACTION", title: "❌ Batalkan" },
              ],
              success: true,
            };
          } else if (audioResult.clarification_question) {
            return {
              reply: `🗣️ *Transkrip Suara:* _"${transcription}"_\n\n❓ ${audioResult.clarification_question}`,
              success: true,
            };
          }
        } catch (audioErr) {
          logger.error({ audioErr }, "Failed to process audio note in AgentEngine");
        }
      }
    }

    // 3. Process Natural Text Message via AI Agent
    const knowledgeText = await knowledgeLoader.loadAllKnowledge();
    const dataContext = await this.contextBuilder.buildContext(userPhone, userName, effectiveText);
    const systemPrompt = buildSystemPrompt(knowledgeText, dataContext);

    const aiResponse = await agyConnector.chat(systemPrompt, effectiveText, userPhone);

    // If AI wants to propose a transaction draft
    if (
      aiResponse.response_type === "DRAFT_TRANSACTION" &&
      aiResponse.transaction_draft &&
      aiResponse.transaction_draft.total_amount > 0
    ) {
      const draft = aiResponse.transaction_draft;
      draft.raw_text = effectiveText;

      await this.confirmationFlow.createDraft(userPhone, userName, draft);
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

    // Otherwise, return AI's natural conversational response
    return {
      reply: aiResponse.reply_text || "Halo! Ada yang bisa saya bantu terkait pencatatan kas?",
      buttons: aiResponse.suggested_buttons,
      success: true,
    };
  }
}
