/**
 * Wspolne typy dla warstwowego systemu moderacji.
 *
 * Zasada nadrzedna: FAIL-SAFE. Jesli system nie jest pewny -> needs_manual_review.
 * Nigdy nie podnosimy automatycznie statusu do "allowed" przy watpliwosciach.
 */

export type ModerationStatus = "allowed" | "rejected" | "needs_manual_review";

/** Kategorie naruszen — wspolne dla promptu, zdjecia i finalnego projektu. */
export type ModerationCategory =
  | "brand_trademark"
  | "protected_franchise"
  | "public_figure"
  | "artist_style"
  | "hate_extremism"
  | "sexual_nudity"
  | "csae" // child sexual abuse/exploitation — najwyzszy priorytet, zawsze reject
  | "violence_gore"
  | "defamation"
  | "personal_data_doxxing"
  | "impersonation"
  | "illegal"
  | "nsfw_image"
  | "logo_detected"
  | "face_detected"
  | "multiple_faces"
  | "possible_celebrity"
  | "ocr_flagged";

export interface PromptModerationResult {
  status: ModerationStatus;
  categories: ModerationCategory[];
  reasons: string[];
  confidence: number; // 0..1 — pewnosc decyzji
}

export interface ImageModerationResult {
  status: ModerationStatus;
  categories: ModerationCategory[];
  reasons: string[];
  detectedText: string[];
  faceDetected: boolean;
  possibleLogoDetected: boolean;
  confidence: number;
}

export interface GeneratedDesignModerationResult {
  status: ModerationStatus;
  categories: ModerationCategory[];
  reasons: string[];
  detectedText: string[];
  confidence: number;
}

/**
 * Laczy wyniki czastkowe wybierajac NAJBARDZIEJ restrykcyjny status.
 * Kolejnosc surowosci: rejected > needs_manual_review > allowed.
 */
export function combineStatuses(statuses: ModerationStatus[]): ModerationStatus {
  if (statuses.includes("rejected")) return "rejected";
  if (statuses.includes("needs_manual_review")) return "needs_manual_review";
  return "allowed";
}
