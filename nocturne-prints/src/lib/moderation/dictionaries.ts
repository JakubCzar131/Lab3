import type { ModerationCategory, ModerationStatus } from "./types";

/**
 * Slowniki i heurystyki moderacji promptu.
 *
 * WAZNE:
 *  - To MVP oparte na regulach. Listy NIE sa kompletne i nie maja byc.
 *    Stanowia warstwe wstepna; docelowo uzupelnia je adapter LLM (patrz providers.ts).
 *  - Decyzje sa fail-safe: kategorie niepewne (osoby publiczne, styl artysty)
 *    daja "needs_manual_review", a nie "rejected".
 *  - Listy celowo NIE zawieraja przykladow obraznych/ekstremistycznych wprost —
 *    uzywamy ogolnych markerow, aby nie hostowac szkodliwych tresci w repo.
 */

export interface DictionaryRule {
  category: ModerationCategory;
  /** Status nadawany przy trafieniu. */
  status: ModerationStatus;
  /** Czytelny powod (PL) pokazywany w panelu admina / logach. */
  reason: string;
  /** Slowa/frazy kluczowe (po normalizacji agresywnej). */
  terms: string[];
  /** Dodatkowe wyrazenia regularne (opcjonalnie), testowane na 'basic'. */
  patterns?: RegExp[];
}

export const DICTIONARY_RULES: DictionaryRule[] = [
  // --- Marki / znaki towarowe -> rejected ---
  {
    category: "brand_trademark",
    status: "rejected",
    reason: "Wykryto markę / znak towarowy. Nie drukujemy cudzych marek.",
    terms: [
      "nike",
      "adidas",
      "puma",
      "reebok",
      "supreme",
      "gucci",
      "prada",
      "louis vuitton",
      "chanel",
      "apple",
      "iphone",
      "samsung",
      "bmw",
      "mercedes",
      "audi",
      "ferrari",
      "lamborghini",
      "coca cola",
      "pepsi",
      "mcdonalds",
      "starbucks",
      "rolex",
      "playstation",
      "xbox",
      "nintendo",
    ],
  },
  // --- Franczyzy / chronione postacie -> rejected ---
  {
    category: "protected_franchise",
    status: "rejected",
    reason: "Wykryto chronioną franczyzę lub postać. Nie kopiujemy cudzych legend.",
    terms: [
      "disney",
      "mickey mouse",
      "marvel",
      "spiderman",
      "spider man",
      "iron man",
      "avengers",
      "batman",
      "superman",
      "dc comics",
      "pokemon",
      "pikachu",
      "star wars",
      "darth vader",
      "yoda",
      "baby yoda",
      "harry potter",
      "hogwarts",
      "lord of the rings",
      "game of thrones",
      "naruto",
      "goku",
      "dragon ball",
      "hello kitty",
      "minecraft",
      "fortnite",
      "mario",
      "zelda",
      "sonic",
    ],
  },
  // --- Osoby publiczne -> needs_manual_review (trudne do pewnej oceny) ---
  {
    category: "public_figure",
    status: "needs_manual_review",
    reason: "Możliwe odniesienie do osoby publicznej. Wymaga weryfikacji zgody/praw.",
    terms: [
      "messi",
      "ronaldo",
      "lewandowski",
      "taylor swift",
      "beyonce",
      "kanye",
      "drake",
      "elon musk",
      "trump",
      "biden",
      "putin",
      "obama",
      "kardashian",
      "billie eilish",
      "lady gaga",
      "eminem",
    ],
    // Heurystyka: "prezydent X", "premier X" itp.
    patterns: [/\b(prezydent|premier|minister|poslanka|posel|senator)\b/i],
  },
  // --- Styl konkretnego artysty / studia -> needs_manual_review ---
  {
    category: "artist_style",
    status: "needs_manual_review",
    reason: "Prośba o styl konkretnego artysty/studia. Nie naśladujemy żyjących twórców ani konkretnych marek.",
    patterns: [
      /\b(w\s+stylu|in\s+the\s+style\s+of|styl)\s+[a-z]/i,
      /\b(jak|niczym|na\s+wzor)\s+(obrazy|prace|grafiki)\b/i,
      /\bstudio\s+ghibli\b/i,
      /\bpixar\b/i,
      /\bdreamworks\b/i,
    ],
  },
  // --- Mowa nienawisci / ekstremizm -> rejected ---
  {
    category: "hate_extremism",
    status: "rejected",
    reason: "Wykryto treści nienawistne / ekstremistyczne / zakazane symbole.",
    terms: [
      "nazi",
      "nazizm",
      "hitler",
      "swastika",
      "swastyka",
      "hakenkreuz",
      "white power",
      "heil",
      "kkk",
      "isis",
      "ku klux klan",
      "sieg heil",
    ],
    patterns: [/\b14\s*88\b/, /\b88\b(?!\d)/],
  },
  // --- CSAE — najwyzszy priorytet, zawsze reject ---
  {
    category: "csae",
    status: "rejected",
    reason: "Wykryto możliwe treści seksualne z udziałem nieletnich. Bezwzględnie zabronione.",
    terms: ["loli", "shota", "cp", "child porn", "preteen sex", "underage sex"],
    patterns: [/\b(dziecko|child|kid|nastolatk\w*|teen|minor)\b[^.]{0,40}\b(nag\w*|sex|seks|erotyk\w*|nude|naked)\b/i],
  },
  // --- Tresci seksualne / nagosc -> rejected ---
  {
    category: "sexual_nudity",
    status: "rejected",
    reason: "Wykryto treści seksualne / nagość.",
    terms: ["porn", "porno", "nude", "naked", "hentai", "xxx", "nsfw", "erotyk", "golizna"],
  },
  // --- Przemoc / gore -> rejected ---
  {
    category: "violence_gore",
    status: "rejected",
    reason: "Wykryto drastyczną przemoc / gore.",
    terms: ["gore", "decapitation", "dismember", "mutilation", "rozczlonkowanie", "krwawa jatka"],
    patterns: [/\b(brutalne|drastyczne)\b[^.]{0,20}\b(zabojstwo|morderstwo|tortury)\b/i],
  },
  // --- Zniesławienie realnych osob -> needs_manual_review ---
  {
    category: "defamation",
    status: "needs_manual_review",
    reason: "Możliwa treść zniesławiająca lub kompromitująca realną osobę.",
    patterns: [/\b([a-z]+)\s+(to|jest)\s+(zlodziej|oszust|pedofil|kryminalista|morderca)\b/i],
  },
  // --- Dane osobowe / doxxing -> needs_manual_review ---
  {
    category: "personal_data_doxxing",
    status: "needs_manual_review",
    reason: "Wykryto możliwe dane osobowe (telefon / adres / PESEL).",
    patterns: [
      /\b(?:\+?\d[\s-]?){9,}\b/, // numery telefonow
      /\b\d{2}-\d{3}\b/, // kod pocztowy PL
      /\bpesel\b/i,
      /\bul\.?\s+[a-z]/i, // "ul. ..."
    ],
  },
  // --- Podszywanie sie pod organizacje -> needs_manual_review ---
  {
    category: "impersonation",
    status: "needs_manual_review",
    reason: "Możliwe podszywanie się pod organizację / urząd / partię.",
    patterns: [/\b(policja|wojsko|urzad|ministerstwo|partia|nfz|zus)\b/i],
  },
  // --- Tresci nielegalne -> rejected ---
  {
    category: "illegal",
    status: "rejected",
    reason: "Treść nielegalna lub zachęcająca do przestępstwa.",
    terms: ["how to make a bomb", "jak zrobic bombe", "kup narkotyki", "buy drugs", "counterfeit money"],
  },
];
