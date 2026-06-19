import crypto from "node:crypto";
import sharp from "sharp";
import { env } from "@/lib/env";
import type { ProductionPrompt } from "./prompt-builder";

/**
 * Interfejs dostawcy generowania grafiki AI.
 *
 * Celowo NIE wpinamy zadnego konkretnego dostawcy na sztywno.
 * MockImageGenerationProvider zwraca placeholder. Pod produkcje mozna podpiac:
 *  - lokalny model (np. Stable Diffusion przez ComfyUI/API),
 *  - zewnetrzne API (IMAGE_GENERATION_API_URL/KEY),
 * implementujac ten sam interfejs.
 */
export interface GenerateImageInput {
  productionPrompt: ProductionPrompt;
  sourceImage?: { buffer: Buffer; mimeType: string };
  seed?: number;
}

export interface GeneratedImageOutput {
  buffer: Buffer;
  mimeType: "image/png";
  provider: string;
}

export interface ImageGenerationProvider {
  readonly name: string;
  generate(input: GenerateImageInput): Promise<GeneratedImageOutput>;
}

/**
 * MOCK provider — generuje deterministyczny placeholder (SVG -> PNG),
 * by przejsc caly przeplyw bez prawdziwego modelu AI.
 */
export class MockImageGenerationProvider implements ImageGenerationProvider {
  readonly name = "mock";

  async generate(input: GenerateImageInput): Promise<GeneratedImageOutput> {
    const seedSource = input.seed?.toString() ?? input.productionPrompt.prompt;
    const hash = crypto.createHash("sha256").update(seedSource).digest("hex");
    const hue = parseInt(hash.slice(0, 2), 16) % 360;
    const hue2 = (hue + 60) % 360;

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="g" cx="50%" cy="40%" r="70%">
      <stop offset="0%" stop-color="hsl(${hue}, 55%, 22%)"/>
      <stop offset="60%" stop-color="hsl(${hue2}, 40%, 8%)"/>
      <stop offset="100%" stop-color="#050407"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#g)"/>
  <circle cx="512" cy="430" r="240" fill="none" stroke="hsl(${hue}, 50%, 60%)" stroke-opacity="0.35" stroke-width="2"/>
  <circle cx="512" cy="430" r="180" fill="none" stroke="hsl(${hue2}, 60%, 70%)" stroke-opacity="0.25" stroke-width="1"/>
  <text x="512" y="780" font-family="Georgia, serif" font-size="42" fill="hsl(45, 60%, 70%)" text-anchor="middle" opacity="0.85">NOCTURNE</text>
  <text x="512" y="830" font-family="Georgia, serif" font-size="22" fill="hsl(0,0%,80%)" text-anchor="middle" opacity="0.6">mystery design • ${hash.slice(0, 8)}</text>
</svg>`;

    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    return { buffer, mimeType: "image/png", provider: this.name };
  }
}

/**
 * External provider (STUB).
 * Docelowo: POST do IMAGE_GENERATION_API_URL z promptem + (opcjonalnie) obrazem,
 * odbior wygenerowanego obrazu i zwrot jako PNG.
 */
export class ExternalImageGenerationProvider implements ImageGenerationProvider {
  readonly name = "external";

  async generate(_input: GenerateImageInput): Promise<GeneratedImageOutput> {
    if (!env.IMAGE_GENERATION_API_URL || !env.IMAGE_GENERATION_API_KEY) {
      throw new Error("Brak konfiguracji IMAGE_GENERATION_API_URL/KEY dla providera external.");
    }
    throw new Error("ExternalImageGenerationProvider nie jest jeszcze zaimplementowany (stub).");
  }
}

let cached: ImageGenerationProvider | null = null;
export function getImageGenerationProvider(): ImageGenerationProvider {
  if (cached) return cached;
  cached =
    env.IMAGE_GENERATION_DRIVER === "external"
      ? new ExternalImageGenerationProvider()
      : new MockImageGenerationProvider();
  return cached;
}
