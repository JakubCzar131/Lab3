/**
 * Normalizacja tekstu na potrzeby moderacji.
 *
 * Cel: utrudnic proste obejscia filtra (leetspeak, znaki specjalne, spacje,
 * diakrytyki, powtorzenia znakow). To NIE jest zabezpieczenie idealne —
 * to warstwa podnoszaca koszt obejscia. Klasyfikator i tak jest fail-safe.
 */

const LEET_MAP: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "9": "g",
  "@": "a",
  $: "s",
  "!": "i",
  "+": "t",
  "(": "c",
  "€": "e",
  "£": "l",
};

/** Usuwa diakrytyki (np. "ż" -> "z"), aby porownania byly odporne. */
export function stripDiacritics(input: string): string {
  return input.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

/** Podstawowa normalizacja: lowercase, trim, redukcja bialych znakow. */
export function basicNormalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Agresywna normalizacja pod detekcje obejsc:
 *  - lowercase + usuniecie diakrytykow
 *  - mapowanie leetspeak
 *  - redukcja powtorzonych liter (np. "niiiike" -> "nike")
 *  - usuniecie znakow niealfanumerycznych poza spacja
 */
export function aggressiveNormalize(input: string): string {
  let s = stripDiacritics(input.toLowerCase());
  s = s.replace(/[0-9@$!+()€£]/g, (ch) => LEET_MAP[ch] ?? ch);
  // usuwamy wszystko poza literami i spacja
  s = s.replace(/[^a-z\s]/g, " ");
  // redukcja powtorzen: 3+ tej samej litery -> 1
  s = s.replace(/([a-z])\1{2,}/g, "$1");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Wersja "zbita" — usuwa wszystkie spacje, by wykryc obejscia typu
 * "n i k e" albo "n-i-k-e".
 */
export function collapsed(input: string): string {
  return aggressiveNormalize(input).replace(/\s+/g, "");
}

/** Zwraca zestaw wariantow tekstu uzywanych przy dopasowywaniu wzorcow. */
export function normalizationVariants(input: string): {
  basic: string;
  aggressive: string;
  collapsed: string;
} {
  return {
    basic: basicNormalize(input),
    aggressive: aggressiveNormalize(input),
    collapsed: collapsed(input),
  };
}
