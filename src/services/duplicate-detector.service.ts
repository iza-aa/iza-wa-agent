import { TransactionRepository, TransactionRecord } from "../db/repositories/transaction.repository.js";
import { logger } from "../utils/logger.js";

export class DuplicateDetectorService {
  constructor(private trxRepo: TransactionRepository) {}

  async detectDuplicate(
    amount: number,
    merchant: string,
    minutesWindow: number = 10
  ): Promise<TransactionRecord | null> {
    if (!amount || amount <= 0) return null;

    try {
      const similar = await this.trxRepo.findRecentSimilarTransaction(
        amount,
        merchant,
        minutesWindow
      );

      if (similar) {
        logger.warn(
          { amount, merchant, matchingId: similar.id },
          "Potential duplicate transaction detected"
        );
        return similar;
      }
    } catch (err) {
      logger.error({ err }, "Error checking duplicate transaction");
    }

    return null;
  }
}
