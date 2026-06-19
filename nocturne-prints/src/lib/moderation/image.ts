import crypto from "node:crypto";
import sharp from "sharp";
import { env } from "@/lib/env";
import { aggressiveNormalize } from "./normalize";
import { DICTIONARY_RULES } from "./dictionaries";
import {
  combineStatuses,
  type ImageModerationResult,
  type ModerationCategory,
  type ModerationStatus,
} from "./types";

export const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME)[number];

export interface ImageInput {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

export interface ProcessedImage {
  buffer: Buffer; // przetworzony obraz (bez EXIF)
  mimeType: AllowedImageMime;
  width: number;
  height: number;
  size: number;
  exifRemoved: boolean;
  safeFilename: string;
}

export interface FileValidationError {
  ok: false;
  reason: string;
}

export type FileValidationResult = ({ ok: true } & ProcessedImage) | FileValidationError;

/** Tworzy bezpieczna nazwe pliku (bez sciezek, znakow specjalnych, z losowym sufiksem). */
export function makeSafeFilename(original: string, ext: string): string {
  const base = original
    .replace(/\.[^.]+$/, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "upload";
  const rand = crypto.randomBytes(6).toString("hex");
  return `${base}-${rand}.${ext}`;
}

/**
 * Walidacja i przetwarzanie pliku obrazu:
 *  - typ MIME (whitelist),
 *  - maksymalny rozmiar,
 *  - wymiary (min/max),
 *  - usuniecie metadanych EXIF (sharp re-enkoduje bez metadanych),
 *  - bezpieczna nazwa pliku.
 *
 * EXIF usuwamy zawsze: chroni prywatnosc (geolokalizacja) i usuwa potencjalnie
 * spreparowane metadane.
 */
export async function validateAndProcessImage(input: ImageInput): Promise<FileValidationResult> {
  if (!ALLOWED_IMAGE_MIME.includes(input.mimeType as AllowedImageMime)) {
    return { ok: false, reason: `Niedozwolony typ pliku: ${input.mimeType}. Dozwolone: JPEG, PNG, WEBP.` };
  }
  if (input.buffer.length === 0) {
    return { ok: false, reason: "Plik jest pusty." };
  }
  if (input.buffer.length > env.MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      reason: `Plik jest za duży (max ${(env.MAX_UPLOAD_BYTES / 1_048_576).toFixed(1)} MB).`,
    };
  }

  let meta: sharp.Metadata;
  try {
    meta = await sharp(input.buffer).metadata();
  } catch {
    return { ok: false, reason: "Nie udało się odczytać pliku jako obrazu." };
  }

  if (!meta.width || !meta.height) {
    return { ok: false, reason: "Nie udało się ustalić wymiarów obrazu." };
  }
  if (meta.width < 256 || meta.height < 256) {
    return { ok: false, reason: "Obraz jest za mały (minimum 256x256 px)." };
  }
  if (meta.width > env.MAX_IMAGE_DIMENSION || meta.height > env.MAX_IMAGE_DIMENSION) {
    return { ok: false, reason: `Obraz przekracza maksymalny wymiar ${env.MAX_IMAGE_DIMENSION}px.` };
  }

  // Re-enkodowanie do PNG bez metadanych (EXIF/GPS/ICC zostaja odrzucone).
  const processed = await sharp(input.buffer)
    .rotate() // zastosuj orientacje EXIF zanim ja usuniemy
    .png({ quality: 90 })
    .toBuffer({ resolveWithObject: true });

  return {
    ok: true,
    buffer: processed.data,
    mimeType: "image/png",
    width: processed.info.width,
    height: processed.info.height,
    size: processed.data.length,
    exifRemoved: true,
    safeFilename: makeSafeFilename(input.filename, "png"),
  };
}

// ---------------------------------------------------------------------------
// Analiza obrazu (NSFW / przemoc / symbole / OCR / twarze / logo)
// ---------------------------------------------------------------------------

export interface ImageModerationSignals {
  nsfwScore: number; // 0..1
  violenceScore: number; // 0..1
  extremismScore: number; // 0..1
  faceCount: number;
  possibleLogo: boolean;
  possibleCelebrity: boolean;
  ocrText: string[];
}

export interface ImageModerationProvider {
  readonly name: string;
  analyze(image: ProcessedImage): Promise<ImageModerationSignals>;
}

/**
 * MOCK provider analizy obrazu.
 *
 * To NIE jest prawdziwa detekcja. Symuluje sygnaly w sposob deterministyczny
 * (na podstawie hasha tresci), aby:
 *  - dac powtarzalne wyniki w testach,
 *  - pokazac sciezki kodu (twarz -> wymog zgody, logo -> review/reject),
 *  - NIE udawac, ze moderacja jest idealna.
 *
 * Dodatkowo wspiera "hinty" w nazwie pliku (np. "nsfw", "logo", "face"),
 * co ulatwia manualne testowanie sciezek decyzyjnych w MVP.
 */
export class MockImageModerationProvider implements ImageModerationProvider {
  readonly name = "mock";

  async analyze(image: ProcessedImage): Promise<ImageModerationSignals> {
    const hash = crypto.createHash("sha256").update(image.buffer).digest();
    const f = (i: number) => hash[i] / 255; // pseudolosowe 0..1 z tresci
    const name = image.safeFilename.toLowerCase();

    const hint = (k: string) => name.includes(k);

    const nsfwScore = hint("nsfw") || hint("nude") ? 0.95 : f(0) * 0.3;
    const violenceScore = hint("gore") || hint("violence") ? 0.9 : f(1) * 0.25;
    const extremismScore = hint("nazi") || hint("hate") ? 0.92 : f(2) * 0.15;
    // Twarz: czesto wystepuje, wiec mock zaklada umiarkowane prawdopodobienstwo.
    const faceCount = hint("face") || hint("portrait") ? 1 : f(3) > 0.6 ? 1 : f(4) > 0.92 ? 2 : 0;
    const possibleLogo = hint("logo") || hint("brand") || f(5) > 0.9;
    const possibleCelebrity = hint("celeb") || f(6) > 0.95;
    const ocrText: string[] = [];
    if (hint("text") || f(7) > 0.85) ocrText.push("sample detected text");
    // Symulacja wykrycia marki w tekscie na zdjeciu:
    if (hint("nike")) ocrText.push("nike");

    return {
      nsfwScore,
      violenceScore,
      extremismScore,
      faceCount,
      possibleLogo,
      possibleCelebrity,
      ocrText,
    };
  }
}

/**
 * External provider (STUB).
 * Docelowo: wywolaj IMAGE_MODERATION_API_URL z kluczem, zmapuj odpowiedz
 * (np. AWS Rekognition / Google Vision / Hive) do ImageModerationSignals,
 * oraz osobne API OCR i detekcji logo. Bez konfiguracji -> rzuca, a orkiestrator
 * lapie blad i ustawia needs_manual_review (fail-safe).
 */
export class ExternalImageModerationProvider implements ImageModerationProvider {
  readonly name = "external";

  async analyze(_image: ProcessedImage): Promise<ImageModerationSignals> {
    if (!env.IMAGE_MODERATION_API_URL || !env.IMAGE_MODERATION_API_KEY) {
      throw new Error("Brak konfiguracji IMAGE_MODERATION_API_URL/KEY dla providera external.");
    }
    throw new Error("ExternalImageModerationProvider nie jest jeszcze zaimplementowany (stub).");
  }
}

let cachedImageProvider: ImageModerationProvider | null = null;
export function getImageModerationProvider(): ImageModerationProvider {
  if (cachedImageProvider) return cachedImageProvider;
  cachedImageProvider =
    env.IMAGE_MODERATION_DRIVER === "external"
      ? new ExternalImageModerationProvider()
      : new MockImageModerationProvider();
  return cachedImageProvider;
}

/** Sprawdza, czy wykryty tekst (OCR) zawiera zakazane marki/frazy. */
function scanOcrText(ocr: string[]): { categories: ModerationCategory[]; reasons: string[] } {
  const categories = new Set<ModerationCategory>();
  const reasons: string[] = [];
  const joined = aggressiveNormalize(ocr.join(" "));
  for (const rule of DICTIONARY_RULES) {
    if (rule.category !== "brand_trademark" && rule.category !== "protected_franchise") continue;
    for (const term of rule.terms ?? []) {
      const re = new RegExp(`(^|\\s)${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`);
      if (re.test(joined)) {
        categories.add("ocr_flagged");
        categories.add(rule.category);
        reasons.push(`OCR wykrył tekst powiązany z marką/franczyzą: "${term}".`);
        break;
      }
    }
  }
  return { categories: Array.from(categories), reasons };
}

/**
 * classifyImageSafety(file) — publiczna funkcja zgodna z wymaganiem zadania.
 *
 * Oczekuje JUZ przetworzonego obrazu (ProcessedImage). Walidacja pliku odbywa
 * sie wczesniej w validateAndProcessImage (usuniecie EXIF itd.).
 *
 * Reguly decyzyjne (fail-safe):
 *  - wysoki NSFW/przemoc/ekstremizm -> rejected,
 *  - logo/marka w OCR -> rejected (twarda marka) lub needs_manual_review,
 *  - >=2 twarze lub mozliwy celebryta -> needs_manual_review,
 *  - 1 twarz -> allowed, ale faceDetected=true (UI wymaga zgody na wizerunek),
 *  - blad analizy -> needs_manual_review.
 */
export async function classifyImageSafety(
  image: ProcessedImage,
  provider: ImageModerationProvider = getImageModerationProvider()
): Promise<ImageModerationResult> {
  let signals: ImageModerationSignals;
  try {
    signals = await provider.analyze(image);
  } catch (err) {
    console.error("[moderation:image] blad analizy, fallback do manual review", err);
    return {
      status: "needs_manual_review",
      categories: [],
      reasons: ["Błąd systemu analizy obrazu — wymagana weryfikacja ręczna."],
      detectedText: [],
      faceDetected: false,
      possibleLogoDetected: false,
      confidence: 0,
    };
  }

  const categories = new Set<ModerationCategory>();
  const reasons: string[] = [];
  const statuses: ModerationStatus[] = [];

  if (signals.nsfwScore >= 0.8) {
    categories.add("nsfw_image");
    categories.add("sexual_nudity");
    reasons.push("Wysokie prawdopodobieństwo nagości / treści NSFW na zdjęciu.");
    statuses.push("rejected");
  } else if (signals.nsfwScore >= 0.5) {
    categories.add("nsfw_image");
    reasons.push("Umiarkowane sygnały NSFW — wymagana weryfikacja.");
    statuses.push("needs_manual_review");
  }

  if (signals.violenceScore >= 0.8) {
    categories.add("violence_gore");
    reasons.push("Wysokie prawdopodobieństwo przemocy / gore na zdjęciu.");
    statuses.push("rejected");
  } else if (signals.violenceScore >= 0.5) {
    categories.add("violence_gore");
    reasons.push("Umiarkowane sygnały przemocy — wymagana weryfikacja.");
    statuses.push("needs_manual_review");
  }

  if (signals.extremismScore >= 0.7) {
    categories.add("hate_extremism");
    reasons.push("Możliwe symbole ekstremistyczne / zakazane na zdjęciu.");
    statuses.push("rejected");
  }

  // OCR — tekst na zdjeciu (logotypy, marki, obrazliwe hasla).
  const ocr = scanOcrText(signals.ocrText);
  for (const c of ocr.categories) categories.add(c);
  reasons.push(...ocr.reasons);
  if (ocr.categories.includes("brand_trademark") || ocr.categories.includes("protected_franchise")) {
    statuses.push("rejected");
  }

  // Logo (detekcja wizualna) — niepewna, wiec review (nie twardy reject).
  if (signals.possibleLogo) {
    categories.add("logo_detected");
    reasons.push("Możliwe logo / znak towarowy na zdjęciu — wymaga weryfikacji.");
    statuses.push("needs_manual_review");
  }

  // Twarze.
  const faceDetected = signals.faceCount >= 1;
  if (signals.faceCount >= 2) {
    categories.add("multiple_faces");
    categories.add("face_detected");
    reasons.push("Wykryto wiele twarzy — wymagana weryfikacja praw do wizerunku.");
    statuses.push("needs_manual_review");
  } else if (signals.faceCount === 1) {
    categories.add("face_detected");
    reasons.push("Wykryto twarz — wymagana zgoda na wykorzystanie wizerunku.");
    // 1 twarz nie blokuje, ale UI wymusi dodatkowy checkbox zgody.
  }

  if (signals.possibleCelebrity) {
    categories.add("possible_celebrity");
    reasons.push("Zdjęcie może przedstawiać osobę publiczną — wymagana weryfikacja.");
    statuses.push("needs_manual_review");
  }

  const status = statuses.length === 0 ? "allowed" : combineStatuses(statuses);
  const confidence =
    status === "rejected" ? Math.max(signals.nsfwScore, signals.violenceScore, 0.8) : status === "needs_manual_review" ? 0.5 : 0.65;

  return {
    status,
    categories: Array.from(categories),
    reasons: Array.from(new Set(reasons)),
    detectedText: signals.ocrText,
    faceDetected,
    possibleLogoDetected: signals.possibleLogo,
    confidence,
  };
}
