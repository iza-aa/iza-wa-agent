import sharp from "sharp";
import { logger } from "./logger.js";

export interface OptimizedImageResult {
  buffer: Buffer;
  mimeType: string;
  originalSize: number;
  optimizedSize: number;
  savedPercent: number;
}

export async function compressReceiptImage(
  inputBuffer: Buffer,
  maxWidth: number = 1200,
  quality: number = 80
): Promise<OptimizedImageResult> {
  const originalSize = inputBuffer.length;
  try {
    const optimizedBuffer = await sharp(inputBuffer)
      .resize({ width: maxWidth, withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();

    const optimizedSize = optimizedBuffer.length;
    const savedPercent = Math.round(((originalSize - optimizedSize) / originalSize) * 100);

    logger.debug(
      { originalSize, optimizedSize, savedPercent },
      "Receipt image compressed successfully"
    );

    return {
      buffer: optimizedBuffer,
      mimeType: "image/webp",
      originalSize,
      optimizedSize,
      savedPercent,
    };
  } catch (error) {
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
