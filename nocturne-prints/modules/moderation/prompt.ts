import { normalizePrompt } from "@/lib/validation/sanitization";
import { promptModerationProvider } from "@/modules/moderation/providers";
import type { PromptSafetyResult, SafetyStatus } from "@/modules/moderation/types";

type Rule = {
  category: string;
  reason: string;
  pattern: RegExp;
  decision: SafetyStatus;
  weight: number;
};

const rules: Rule[] = [
  {
    category: "trademark_brand",
    reason: "Prompt zawiera nazwę marki, logo albo znak towarowy.",
    pattern:
      /\b(nike|adidas|supreme|apple|bmw|mercedes|gucci|prada|balenciaga|chanel|tesla|playstation|xbox)\b/i,
    decision: "rejected",
    weight: 0.95,
  },
  {
    category: "copyrighted_franchise",
    reason: "Prompt zawiera chronioną franczyzę lub postać.",
    pattern:
      /\b(disney|marvel|pokemon|pokémon|star wars|harry potter|batman|spider[- ]?man|naruto|goku|anime character)\b/i,
    decision: "rejected",
    weight: 0.95,
  },
  {
    category: "public_figure",
    reason: "Prompt może dotyczyć celebryty lub osoby publicznej.",
    pattern:
      /\b(celebrity|celebryta|polityk|influencer|footballer|piłkarz|president|prezydent|elon musk|taylor swift|lewandowski)\b/i,
    decision: "needs_manual_review",
    weight: 0.75,
  },
  {
    category: "artist_style",
    reason: "Prompt zawiera nawiązanie do stylu konkretnego żyjącego artysty/studia.",
    pattern:
      /\b(in the style of|w stylu|style of|jak od)\s+[a-z0-9 .'-]{2,80}/i,
    decision: "needs_manual_review",
    weight: 0.85,
  },
  {
    category: "hate_or_extremism",
    reason: "Prompt zawiera treści nienawistne lub ekstremistyczne.",
    pattern:
      /\b(nazi|nazist|white power|kkk|heil|swastika|rasow[ya]|eksterminacj[ae]|ethnic cleansing|hate speech)\b/i,
    decision: "rejected",
    weight: 0.99,
  },
  {
    category: "sexual_nudity",
    reason: "Prompt zawiera seksualizację lub nagość.",
    pattern:
      /\b(nude|naked|nudity|porn|xxx|seks|erotyczn[yae]|fetish|topless|lingerie)\b/i,
    decision: "rejected",
    weight: 0.99,
  },
  {
    category: "graphic_violence",
    reason: "Prompt zawiera drastyczną przemoc lub gore.",
    pattern:
      /\b(gore|krwaw[yae]|rozczłonkow|dekapitacj[ae]|torture|flayed|dismembered)\b/i,
    decision: "rejected",
    weight: 0.98,
  },
  {
    category: "defamation_or_humiliation",
    reason: "Prompt może upokarzać lub zniesławiać realną osobę.",
    pattern:
      /\b(ośmiesz|kompromituj|poniż|defame|humiliate|shame)\b/i,
    decision: "needs_manual_review",
    weight: 0.8,
  },
  {
    category: "personal_data_or_doxxing",
    reason: "Prompt może zawierać dane osobowe lub doxxing.",
    pattern:
      /\b(ul\.|adres|phone|telefon|dowod osobisty|id card|passport|pesel|mail me at|@gmail\.com)\b/i,
    decision: "rejected",
    weight: 0.97,
  },
  {
    category: "impersonation",
    reason: "Prompt może sugerować podszywanie się pod organizację lub urząd.",
    pattern:
      /\b(official logo|oficjalne logo|government|rząd|policja|fbi|urz[ąa]d|partia)\b/i,
    decision: "needs_manual_review",
    weight: 0.82,
  },
  {
    category: "illegal_activity",
    reason: "Prompt sugeruje treści nielegalne lub zachęcanie do przestępstwa.",
    pattern:
      /\b(how to make bomb|jak zrobić bombę|drug lab|kradzie[żz]|fraud|oszustwo|counterfeit)\b/i,
    decision: "rejected",
    weight: 0.97,
  },
];

const severityRank: Record<SafetyStatus, number> = {
  allowed: 0,
  needs_manual_review: 1,
  rejected: 2,
};

export async function classifyPromptSafety(prompt: string): Promise<PromptSafetyResult> {
  const normalized = normalizePrompt(prompt);
  const categories = new Set<string>();
  const reasons = new Set<string>();
  let confidence = 0.45;
  let status: SafetyStatus = "allowed";

  for (const rule of rules) {
    if (!rule.pattern.test(normalized)) {
      continue;
    }

    categories.add(rule.category);
    reasons.add(rule.reason);
    confidence = Math.max(confidence, rule.weight);
    if (severityRank[rule.decision] > severityRank[status]) {
      status = rule.decision;
    }
  }

  // Security note: obfuscated text increases uncertainty, so fail-safe to manual review.
  const obfuscationSignals = prompt.length - normalized.length > 20 || /[^\p{L}\p{N}\s]/u.test(prompt);
  if (obfuscationSignals && status === "allowed") {
    status = "needs_manual_review";
    categories.add("obfuscation");
    reasons.add("Wykryto możliwą próbę obejścia filtrów przez zapis promptu.");
    confidence = Math.max(confidence, 0.65);
  }

  const providerResult = await promptModerationProvider.classifyPrompt?.(normalized);
  if (providerResult) {
    for (const category of providerResult.categories) categories.add(category);
    for (const reason of providerResult.reasons) reasons.add(reason);
    if (severityRank[providerResult.status] > severityRank[status]) {
      status = providerResult.status;
    }
    confidence = Math.max(confidence, providerResult.confidence);
  }

  if (categories.size === 0) {
    confidence = 0.92;
  }

  return {
    status,
    categories: [...categories],
    reasons: [...reasons],
    confidence: Number(confidence.toFixed(2)),
  };
}
