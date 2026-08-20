import sharp from "sharp";
import { logger } from "./logger.js";
// Limit Sharp to 1 concurrent thread and 16MB memory cache to keep 1GB VPS ultra-cool
try {
    sharp.concurrency(1);
    sharp.cache({ memory: 16, files: 0, items: 20 });
}
catch {
    // Ignore in environments where sharp settings are restricted
}
export async function compressReceiptImage(inputBuffer, maxWidth = 1200, quality = 80) {
    const originalSize = inputBuffer.length;
    try {
        const optimizedBuffer = await sharp(inputBuffer)
            .resize({ width: maxWidth, withoutEnlargement: true })
            .webp({ quality })
            .toBuffer();
        const optimizedSize = optimizedBuffer.length;
        const savedPercent = Math.round(((originalSize - optimizedSize) / originalSize) * 100);
        logger.debug({ originalSize, optimizedSize, savedPercent }, "Receipt image compressed successfully");
        return {
            buffer: optimizedBuffer,
            mimeType: "image/webp",
            originalSize,
            optimizedSize,
            savedPercent,
        };
    }
    catch (error) {
        logger.warn({ error }, "Sharp compression failed, falling back to original buffer");
        return {
            buffer: inputBuffer,
            mimeType: "image/jpeg",
            originalSize,
            optimizedSize: originalSize,
            savedPercent: 0,
        };
    }
}
//# sourceMappingURL=image-optimizer.js.map