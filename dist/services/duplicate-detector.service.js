import { logger } from "../utils/logger.js";
export class DuplicateDetectorService {
    trxRepo;
    constructor(trxRepo) {
        this.trxRepo = trxRepo;
    }
    async detectDuplicate(amount, merchant, minutesWindow = 10) {
        if (!amount || amount <= 0)
            return null;
        try {
            const similar = await this.trxRepo.findRecentSimilarTransaction(amount, merchant, minutesWindow);
            if (similar) {
                logger.warn({ amount, merchant, matchingId: similar.id }, "Potential duplicate transaction detected");
                return similar;
            }
        }
        catch (err) {
            logger.error({ err }, "Error checking duplicate transaction");
        }
        return null;
    }
}
//# sourceMappingURL=duplicate-detector.service.js.map