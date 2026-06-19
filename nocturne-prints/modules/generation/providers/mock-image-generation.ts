import sharp from "sharp";
import type { ImageGenerationInput, ImageGenerationOutput, ImageGenerationProvider } from "@/modules/generation/types";

export class MockImageGenerationProvider implements ImageGenerationProvider {
  async generateDesign(input: ImageGenerationInput): Promise<ImageGenerationOutput> {
    const svg = `
      <svg width="1400" height="1800" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stop-color="#07070b"/>
            <stop offset="100%" stop-color="#1f1335"/>
          </linearGradient>
        </defs>
        <rect width="1400" height="1800" fill="url(#bg)" />
        <circle cx="700" cy="900" r="380" fill="none" stroke="#8d6ce8" stroke-width="5" opacity="0.5" />
        <circle cx="700" cy="900" r="260" fill="none" stroke="#ccb57a" stroke-width="3" opacity="0.35" />
        <text x="700" y="860" text-anchor="middle" fill="#e5ddc6" font-size="58" font-family="serif">NOCTURNE</text>
        <text x="700" y="940" text-anchor="middle" fill="#a594cd" font-size="30" font-family="sans-serif">MYSTERY PRINT</text>
        <text x="700" y="1010" text-anchor="middle" fill="#9a8ab8" font-size="26" font-family="sans-serif">${input.selectedStyle}</text>
      </svg>
    `;

    const imageBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

    return {
      imageBuffer,
      mimeType: "image/png",
      provider: "mock-image-generation-provider",
      meta: {
        transformationLevel: input.transformationLevel,
      },
    };
  }
}
