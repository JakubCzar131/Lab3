import {
  classifyImageSafety,
  getImageModerationProvider,
  type ProcessedImage,
} from "./image";
import {
  combineStatuses,
  type GeneratedDesignModerationResult,
  type ModerationCategory,
  type ModerationStatus,
} from "./types";

/**
 * Moderacja FINALNEGO projektu AI.
 *
 * Po wygenerowaniu grafiki sprawdzamy ja ponownie — model moze przypadkiem
 * wygenerowac logo, znana postac, nagosc czy symbol nienawisci, mimo czystego
 * promptu. To krytyczna warstwa: nie ufamy generatorowi na slowo.
 *
 * Zasada fail-safe: niepewnosc -> needs_manual_review (admin ocenia recznie).
 */
export async function moderateGeneratedDesign(
  design: ProcessedImage
): Promise<GeneratedDesignModerationResult> {
  // Wykorzystujemy te sama analize obrazu (NSFW/przemoc/logo/OCR/celebryta).
  const provider = getImageModerationProvider();
  const imageResult = await classifyImageSafety(design, provider);

  const categories = new Set<ModerationCategory>(imageResult.categories);
  const reasons = [...imageResult.reasons];
  const statuses: ModerationStatus[] = [imageResult.status];

  // Dla wygenerowanego projektu jeszcze ostrozniej traktujemy logo i twarze:
  // nawet pojedyncza twarz wygenerowana przez AI moze przypominac realna osobe.
  if (imageResult.possibleLogoDetected) {
    reasons.push("Wygenerowany projekt może zawierać logo/markę — wstrzymano do weryfikacji.");
    statuses.push("needs_manual_review");
  }
  if (imageResult.categories.includes("possible_celebrity")) {
    reasons.push("Wygenerowany projekt może przypominać znaną osobę — weryfikacja ręczna.");
    statuses.push("needs_manual_review");
  }

  const status = combineStatuses(statuses);

  return {
    status,
    categories: Array.from(categories),
    reasons: Array.from(new Set(reasons)),
    detectedText: imageResult.detectedText,
    confidence: imageResult.confidence,
  };
}
