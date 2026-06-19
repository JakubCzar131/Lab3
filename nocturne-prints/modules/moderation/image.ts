import sharp from "sharp";
import { imageModerationProvider } from "@/modules/moderation/providers";
import type { ImageSafetyResult, SafetyStatus } from "@/modules/moderation/types";

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 10 * 1024 * 1024;
const MIN_DIMENSION = 512;
const MAX_DIMENSION = 6000;

type ClassifyImageInput = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  faceConsent: boolean;
};

type PreparedImage = {
  cleanedBuffer: Buffer;
  width: number;
  height: number;
  mimeType: string;
  exifRemoved: boolean;
};

function joinDecision(current: SafetyStatus, next: SafetyStatus): SafetyStatus {
  if (current === "rejected" || next === "rejected") return "rejected";
  if (current === "needs_manual_review" || next === "needs_manual_review") return "needs_manual_review";
  return "allowed";
}

function collectTextSignals(text: string[]) {
  const merged = text.join(" ").toLowerCase();
  const hasTrademark = /\b(nike|adidas|supreme|apple|bmw|marvel|disney|pokemon)\b/.test(merged);
  const hasHate = /\b(nazi|swastika|white power)\b/.test(merged);
  const hasSexual = /\b(xxx|porn|nude|onlyfans)\b/.test(merged);
  return { hasTrademark, hasHate, hasSexual };
}

export async function prepareImageForStorage(input: {
  buffer: Buffer;
  mimeType: string;
}): Promise<PreparedImage> {
  if (!allowedMimeTypes.has(input.mimeType)) {
    throw new Error("Unsupported image type. Allowed: JPEG, PNG, WEBP.");
  }
  if (input.buffer.byteLength > MAX_BYTES) {
    throw new Error("Image is too large. Max size is 10MB.");
  }

  const source = sharp(input.buffer, { failOn: "none", sequentialRead: true }).rotate();
  const metadata = await source.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
    throw new Error("Image is too small. Minimum dimensions are 512x512.");
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error("Image is too large in dimensions. Maximum is 6000x6000.");
  }

  const pipeline = source.withMetadata({ orientation: undefined });
  let cleanedBuffer: Buffer;

  if (input.mimeType === "image/png") {
    cleanedBuffer = await pipeline.png({ quality: 90 }).toBuffer();
  } else if (input.mimeType === "image/webp") {
    cleanedBuffer = await pipeline.webp({ quality: 90 }).toBuffer();
  } else {
    cleanedBuffer = await pipeline.jpeg({ quality: 90 }).toBuffer();
  }

  return {
    cleanedBuffer,
    width,
    height,
    mimeType: input.mimeType,
    exifRemoved: true,
  };
}

export async function classifyImageSafety(input: ClassifyImageInput): Promise<ImageSafetyResult> {
  const categories = new Set<string>();
  const reasons = new Set<string>();
  const detectedText = new Set<string>();
  let status: SafetyStatus = "allowed";
  let confidence = 0.5;

  const prepared = await prepareImageForStorage({
    buffer: input.buffer,
    mimeType: input.mimeType,
  });

  const providerSignals = await imageModerationProvider.analyzeImage(prepared.cleanedBuffer, prepared.mimeType);
  providerSignals.extractedText.forEach((value) => detectedText.add(value));

  const filenameSignal = input.filename.toLowerCase();
  if (/(nike|adidas|logo|brand|marvel|disney|pokemon)/.test(filenameSignal)) {
    detectedText.add(filenameSignal);
  }
  const filenameFaceSignal = /(face|selfie|portrait|person|celeb|influencer)/.test(filenameSignal);

  const textSignals = collectTextSignals([...detectedText]);

  if (providerSignals.nsfwScore >= 0.8 || textSignals.hasSexual) {
    status = joinDecision(status, "rejected");
    categories.add("sexual_nudity");
    reasons.add("Wykryto wysokie ryzyko nagości lub treści seksualnych.");
    confidence = Math.max(confidence, 0.95);
  } else if (providerSignals.nsfwScore >= 0.5) {
    status = joinDecision(status, "needs_manual_review");
    categories.add("possible_nsfw");
    reasons.add("Wykryto niejednoznaczny sygnał NSFW.");
    confidence = Math.max(confidence, 0.72);
  }

  if (providerSignals.goreScore >= 0.7) {
    status = joinDecision(status, "rejected");
    categories.add("graphic_violence");
    reasons.add("Wykryto sygnał drastycznej przemocy/gore.");
    confidence = Math.max(confidence, 0.93);
  } else if (providerSignals.goreScore >= 0.45) {
    status = joinDecision(status, "needs_manual_review");
    categories.add("possible_graphic_violence");
    reasons.add("Wykryto niejednoznaczny sygnał przemocy.");
    confidence = Math.max(confidence, 0.7);
  }

  if (providerSignals.extremistScore >= 0.6 || textSignals.hasHate) {
    status = joinDecision(status, "rejected");
    categories.add("hate_or_extremism");
    reasons.add("Wykryto możliwe symbole ekstremistyczne lub mowę nienawiści.");
    confidence = Math.max(confidence, 0.96);
  }

  const possibleLogoDetected = providerSignals.logoScore >= 0.45 || textSignals.hasTrademark;
  if (providerSignals.logoScore >= 0.8 || textSignals.hasTrademark) {
    status = joinDecision(status, "rejected");
    categories.add("trademark_logo");
    reasons.add("Wykryto potencjalny logotyp lub znak towarowy.");
    confidence = Math.max(confidence, 0.9);
  } else if (possibleLogoDetected) {
    status = joinDecision(status, "needs_manual_review");
    categories.add("possible_trademark_logo");
    reasons.add("Wykryto niejednoznaczny sygnał logotypu.");
    confidence = Math.max(confidence, 0.67);
  }

  const faceDetected = providerSignals.faceCount > 0 || filenameFaceSignal;
  if (faceDetected && !input.faceConsent) {
    status = joinDecision(status, "rejected");
    categories.add("missing_face_consent");
    reasons.add("Wykryto twarz, ale brak zgody na wykorzystanie wizerunku.");
    confidence = Math.max(confidence, 0.98);
  }

  if (providerSignals.faceCount > 1 || providerSignals.publicFigureScore >= 0.6) {
    status = joinDecision(status, "needs_manual_review");
    categories.add("public_figure_or_multiple_faces");
    reasons.add("Wykryto wiele twarzy lub ryzyko osoby publicznej.");
    confidence = Math.max(confidence, 0.77);
  }

  if (categories.size === 0) {
    confidence = 0.9;
  }

  return {
    status,
    categories: [...categories],
    reasons: [...reasons],
    detectedText: [...detectedText],
    faceDetected,
    possibleLogoDetected,
    confidence: Number(confidence.toFixed(2)),
  };
}
