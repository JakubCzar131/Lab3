import type { DesignStyle, TransformationLevel } from "@prisma/client";

/**
 * Buduje PROMPT PRODUKCYJNY na podstawie:
 *  - promptu klienta,
 *  - wybranego stylu,
 *  - typu produktu,
 *  - zasad bezpieczenstwa.
 *
 * KLUCZOWE ZASADY BEZPIECZENSTWA:
 *  - prompt produkcyjny NIE moze zawierac marek, postaci, celebrytow ani stylu
 *    konkretnych zyjacych artystow,
 *  - dokladamy twarde negatywne instrukcje (negative prompt),
 *  - prompt klienta jest "opakowany", a nie wstrzykiwany 1:1, by ograniczyc
 *    prompt-injection do generatora.
 */

const STYLE_DESCRIPTORS: Record<DesignStyle, string> = {
  dark_fantasy: "dark fantasy atmosphere, mythical, moody, painterly, dramatic lighting",
  occult: "esoteric occult symbolism, ritual sigils, arcane geometry, candlelit mood",
  cyberpunk: "cyberpunk aesthetic, neon-noir, dystopian city haze, chrome and shadow",
  gothic: "gothic art, cathedral shadows, baroque ornament, melancholic elegance",
  surreal: "surreal dreamlike composition, impossible geometry, soft fog",
  cosmic_horror: "cosmic horror, eldritch unknown, vast void, unsettling sublime",
  vintage_horror: "vintage horror poster, aged grain, muted palette, retro print texture",
};

const TRANSFORMATION_DESCRIPTORS: Record<TransformationLevel, string> = {
  subtle: "subtle stylization while preserving the original subject and composition",
  medium: "balanced creative reinterpretation of the source image",
  strong: "bold artistic transformation, reimagined while keeping a loose nod to the source",
};

const PRODUCT_DESCRIPTORS: Record<string, string> = {
  TSHIRT: "high-contrast print suited for a t-shirt, centered composition, print-ready",
  HOODIE: "bold print suited for a hoodie front, durable contrast, print-ready",
};

/**
 * Negatywny prompt — twarde zakazy. To dodatkowa warstwa ochrony przy generacji
 * (poza moderacja promptu klienta i moderacja finalnego obrazu).
 */
export const SAFETY_NEGATIVE_PROMPT = [
  "no brand logos",
  "no trademarks",
  "no copyrighted characters",
  "no franchise characters",
  "no celebrities",
  "no real public figures",
  "no text of real brand names",
  "no nudity",
  "no sexual content",
  "no minors in sexual context",
  "no gore",
  "no hate symbols",
  "no extremist symbols",
  "no specific living artist style imitation",
].join(", ");

export interface BuildProductionPromptInput {
  customerPrompt: string;
  style: DesignStyle;
  transformationLevel: TransformationLevel;
  productType: string; // ProductType jako string
}

export interface ProductionPrompt {
  prompt: string;
  negativePrompt: string;
}

/**
 * Czysci prompt klienta z fraz proszacych o marki/styl artysty.
 * To NIE zastepuje moderacji — to dodatkowe utwardzenie przed wyslaniem do modelu.
 */
function sanitizeCustomerIntent(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  // usun frazy "w stylu X" / "in the style of X"
  s = s.replace(/\b(w\s+stylu|in\s+the\s+style\s+of)\b[^,.;]*/gi, "");
  // przytnij dlugosc, by ograniczyc injection
  s = s.slice(0, 300).trim();
  return s;
}

export function buildProductionPrompt(input: BuildProductionPromptInput): ProductionPrompt {
  const intent = sanitizeCustomerIntent(input.customerPrompt);
  const style = STYLE_DESCRIPTORS[input.style];
  const transform = TRANSFORMATION_DESCRIPTORS[input.transformationLevel];
  const product = PRODUCT_DESCRIPTORS[input.productType] ?? PRODUCT_DESCRIPTORS.TSHIRT;

  const prompt = [
    "Original, copyright-safe artwork.",
    `Creative interpretation guided by user intent: "${intent}".`,
    `Style: ${style}.`,
    `Transformation: ${transform}.`,
    `Output: ${product}.`,
    "Cohesive, premium, dark and mysterious mood. Do not include any real-world brand, logo, or recognizable copyrighted character.",
  ].join(" ");

  return { prompt, negativePrompt: SAFETY_NEGATIVE_PROMPT };
}
