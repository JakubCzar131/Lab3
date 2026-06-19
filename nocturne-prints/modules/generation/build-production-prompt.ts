import { normalizePrompt } from "@/lib/validation/sanitization";

const bannedTokens = [
  "nike",
  "adidas",
  "supreme",
  "apple",
  "bmw",
  "marvel",
  "disney",
  "pokemon",
  "star wars",
  "harry potter",
  "in the style of",
  "w stylu",
];

function removeBannedReferences(prompt: string) {
  let sanitized = prompt;
  for (const token of bannedTokens) {
    sanitized = sanitized.replace(new RegExp(token, "gi"), "");
  }
  return sanitized.replace(/\s+/g, " ").trim();
}

export function buildProductionPrompt(input: {
  customerPrompt: string;
  selectedStyle: string;
  productType: string;
  transformationLevel: string;
}) {
  const normalized = normalizePrompt(input.customerPrompt);
  const sanitized = removeBannedReferences(normalized);

  return [
    "Create a premium print composition for apparel.",
    `Style direction: ${input.selectedStyle}.`,
    `Garment type: ${input.productType}.`,
    `Transformation strength: ${input.transformationLevel}.`,
    `Customer intent: ${sanitized || "dark symbolic abstract aura"}.`,
    "Hard constraints: no logos, no existing characters, no celebrity likeness, no known franchise elements, no text-based trademarks.",
    "Aesthetic: mysterious, elegant, dark, high contrast, tactile texture, ritual-like energy, without kitsch.",
  ].join(" ");
}
