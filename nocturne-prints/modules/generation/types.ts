export type ImageGenerationInput = {
  customerPrompt: string;
  selectedStyle: string;
  productType: string;
  transformationLevel: string;
  safetyDirectives: string[];
};

export type ImageGenerationOutput = {
  imageBuffer: Buffer;
  mimeType: string;
  provider: string;
  meta?: Record<string, unknown>;
};

export interface ImageGenerationProvider {
  generateDesign(input: ImageGenerationInput): Promise<ImageGenerationOutput>;
}
