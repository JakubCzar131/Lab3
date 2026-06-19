import { z } from "zod";

export const DESIGN_STYLES = [
  "dark_fantasy",
  "occult",
  "cyberpunk",
  "gothic",
  "surreal",
  "cosmic_horror",
  "vintage_horror",
] as const;

export const TRANSFORMATION_LEVELS = ["subtle", "medium", "strong"] as const;

export const STYLE_LABELS: Record<(typeof DESIGN_STYLES)[number], string> = {
  dark_fantasy: "Dark fantasy",
  occult: "Occult",
  cyberpunk: "Cyberpunk",
  gothic: "Gothic",
  surreal: "Surreal",
  cosmic_horror: "Cosmic horror",
  vintage_horror: "Vintage horror",
};

export const TRANSFORMATION_LABELS: Record<(typeof TRANSFORMATION_LEVELS)[number], string> = {
  subtle: "Subtelny",
  medium: "Średni",
  strong: "Mocny",
};

/** Walidacja danych zamowienia (tworzenie). */
export const createOrderSchema = z.object({
  email: z.string().email("Podaj poprawny adres e-mail."),
  productId: z.string().min(1, "Wybierz produkt."),
  variantId: z.string().min(1, "Wybierz wariant (kolor + rozmiar)."),
  size: z.string().min(1, "Wybierz rozmiar."),
  color: z.string().min(1, "Wybierz kolor."),
  customerPrompt: z
    .string()
    .min(3, "Opisz swoją intencję (min. 3 znaki).")
    .max(600, "Prompt jest za długi (max 600 znaków)."),
  selectedStyle: z.enum(DESIGN_STYLES, { errorMap: () => ({ message: "Wybierz styl." }) }),
  transformationLevel: z.enum(TRANSFORMATION_LEVELS, {
    errorMap: () => ({ message: "Wybierz poziom transformacji." }),
  }),
  // Zgody prawne — wszystkie wymagane musza byc true.
  consentImageRights: z.literal(true, {
    errorMap: () => ({ message: "Musisz potwierdzić prawa do zdjęcia." }),
  }),
  consentMysteryNoPreview: z.literal(true, {
    errorMap: () => ({ message: "Musisz zaakceptować brak podglądu." }),
  }),
  consentCreativeVariation: z.literal(true, {
    errorMap: () => ({ message: "Musisz zaakceptować zmienność efektu AI." }),
  }),
  consentNoWithdrawal: z.literal(true, {
    errorMap: () => ({ message: "Musisz zaakceptować zasady zwrotu." }),
  }),
  // Zgoda na wizerunek — wymagana warunkowo (gdy wykryto twarz). Walidowana po stronie serwera.
  consentFaceLikeness: z.boolean().optional().default(false),
  uploadAssetId: z.string().min(1, "Najpierw prześlij zdjęcie."),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/** Walidacja statusu w panelu admina. */
export const adminUpdateStatusSchema = z.object({
  orderId: z.string().min(1),
  action: z.enum([
    "approve_manual",
    "reject",
    "regenerate",
    "mark_production_ready",
    "mark_printed",
    "mark_shipped",
    "cancel",
  ]),
  reason: z.string().max(500).optional(),
});

export type AdminUpdateStatusInput = z.infer<typeof adminUpdateStatusSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
