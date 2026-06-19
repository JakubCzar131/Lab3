import type { ExternalImageModerationProvider, ImageModerationSignals } from "@/modules/moderation/types";

export class MockImageModerationProvider implements ExternalImageModerationProvider {
  async analyzeImage(buffer: Buffer, mimeType: string): Promise<ImageModerationSignals> {
    void buffer;
    void mimeType;
    return {
      nsfwScore: 0.03,
      goreScore: 0.02,
      extremistScore: 0.01,
      logoScore: 0.04,
      publicFigureScore: 0.08,
      faceCount: 0,
      extractedText: [],
    };
  }
}
