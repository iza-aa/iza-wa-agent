import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { compressReceiptImage } from "../../../src/utils/image-optimizer.js";

describe("Google Services & Image Optimization", () => {
  it("should compress a valid image buffer into webp format", async () => {
    const validPngBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();

    const result = await compressReceiptImage(validPngBuffer);
    expect(result.mimeType).toBe("image/webp");
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.optimizedSize).toBeGreaterThan(0);
  });
});
