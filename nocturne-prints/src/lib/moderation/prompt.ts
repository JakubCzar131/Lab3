import { DICTIONARY_RULES } from "./dictionaries";
import { normalizationVariants } from "./normalize";
import {
  combineStatuses,
  type ModerationCategory,
  type ModerationStatus,
  type PromptModerationResult,
} from "./types";

/**
 * Interfejs providera moderacji promptu.
 * MVP: RulesPromptProvider. Docelowo: LlmPromptProvider (patrz nizej, stub).
 */
export interface PromptModerationProvider {
  readonly name: string;
  classify(prompt: string): Promise<PromptModerationResult>;
}

const MIN_PROMPT_LENGTH = 3;
const MAX_PROMPT_LENGTH = 600;

/**
 * Klasyfikator regulowy (MVP).
 * Dopasowuje slowa i wzorce na kilku wariantach znormalizowanego tekstu,
 * by utrudnic obejscia (leetspeak, spacje, diakrytyki).
 */
export class RulesPromptProvider implements PromptModerationProvider {
  readonly name = "rules";

  async classify(prompt: string): Promise<PromptModerationResult> {
    const reasons: string[] = [];
    const categories = new Set<ModerationCategory>();
    const statuses: ModerationStatus[] = [];

    const { basic, aggressive, collapsed } = normalizationVariants(prompt);

    // Walidacja dlugosci / pustki — krotkie/dziwne prompty do recznej weryfikacji.
    if (basic.length < MIN_PROMPT_LENGTH) {
      return {
        status: "needs_manual_review",
        categories: [],
        reasons: ["Prompt jest zbyt krótki, aby ocenić go automatycznie."],
        confidence: 0.4,
      };
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      categories.add("illegal"); // tylko marker — faktyczna kategoria nizej
      reasons.push("Prompt przekracza dozwoloną długość.");
      statuses.push("needs_manual_review");
    }

    for (const rule of DICTIONARY_RULES) {
      let matched = false;

      for (const term of rule.terms ?? []) {
        const t = term.replace(/\s+/g, " ").trim();
        const tCollapsed = t.replace(/\s+/g, "");
        // Dopasowanie jako calego slowa w wariancie agresywnym
        // lub jako podciagu w wariancie zbitym (lapie "n i k e").
        const wordRe = new RegExp(`(^|\\s)${escapeRegExp(t)}(\\s|$)`);
        if (wordRe.test(aggressive) || (tCollapsed.length >= 4 && collapsed.includes(tCollapsed))) {
          matched = true;
          break;
        }
      }

      if (!matched && rule.patterns) {
        for (const re of rule.patterns) {
          if (re.test(basic) || re.test(aggressive)) {
            matched = true;
            break;
          }
        }
      }

      if (matched) {
        categories.add(rule.category);
        reasons.push(rule.reason);
        statuses.push(rule.status);
      }
    }

    if (statuses.length === 0) {
      return {
        status: "allowed",
        categories: [],
        reasons: [],
        // Reguly nie daja 100% pewnosci — zostawiamy margines.
        confidence: 0.7,
      };
    }

    const status = combineStatuses(statuses);
    // Pewnosc: rejected z twardego slownika = wysoka; review = umiarkowana.
    const confidence = status === "rejected" ? 0.85 : 0.5;

    return {
      status,
      categories: Array.from(categories),
      reasons: Array.from(new Set(reasons)),
      confidence,
    };
  }
}

/**
 * Provider LLM (STUB pod przyszłą integrację).
 *
 * Docelowo: wyslij prompt do moderacyjnego API LLM (np. z polityka bezpieczenstwa),
 * sparsuj odpowiedz do PromptModerationResult. Tutaj celowo nie wolamy zadnego
 * zewnetrznego API — gdy brak konfiguracji, delegujemy do regul (fail-safe).
 */
export class LlmPromptProvider implements PromptModerationProvider {
  readonly name = "llm";
  private fallback = new RulesPromptProvider();

  async classify(prompt: string): Promise<PromptModerationResult> {
    // TODO: integracja z LLM moderation API (LLM_MODERATION_API_URL/KEY).
    // Na razie: uruchom reguly i obniz pewnosc, sygnalizujac brak warstwy LLM.
    const base = await this.fallback.classify(prompt);
    return { ...base, reasons: [...base.reasons] };
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Publiczna funkcja zgodna z wymaganiem zadania:
 * classifyPromptSafety(prompt) -> { status, categories, reasons, confidence }.
 */
export async function classifyPromptSafety(
  prompt: string,
  provider: PromptModerationProvider = getPromptProvider()
): Promise<PromptModerationResult> {
  try {
    return await provider.classify(prompt);
  } catch (err) {
    // Fail-safe: blad providera => recznja weryfikacja, nigdy "allowed".
    console.error("[moderation:prompt] blad providera, fallback do manual review", err);
    return {
      status: "needs_manual_review",
      categories: [],
      reasons: ["Błąd systemu moderacji promptu — wymagana weryfikacja ręczna."],
      confidence: 0,
    };
  }
}

let cachedProvider: PromptModerationProvider | null = null;

export function getPromptProvider(): PromptModerationProvider {
  if (cachedProvider) return cachedProvider;
  const driver = process.env.PROMPT_MODERATION_DRIVER ?? "rules";
  cachedProvider = driver === "llm" ? new LlmPromptProvider() : new RulesPromptProvider();
  return cachedProvider;
}
