export type SafetyStatus = "allowed" | "rejected" | "needs_manual_review";

export type PromptSafetyResult = {
  status: SafetyStatus;
  categories: string[];
  reasons: string[];
  confidence: number;
};

export type ImageSafetyResult = {
  status: SafetyStatus;
  categories: string[];
  reasons: string[];
  detectedText: string[];
  faceDetected: boolean;
  possibleLogoDetected: boolean;
  confidence: number;
};

export type ExternalPromptModerationProvider = {
  classifyPrompt?(prompt: string): Promise<PromptSafetyResult | null>;
};

export type ImageModerationSignals = {
  nsfwScore: number;
  goreScore: number;
  extremistScore: number;
  logoScore: number;
  publicFigureScore: number;
  faceCount: number;
  extractedText: string[];
};

export type ExternalImageModerationProvider = {
  analyzeImage(buffer: Buffer, mimeType: string): Promise<ImageModerationSignals>;
};
