import { z } from "zod";

/**
 * Centralna walidacja zmiennych srodowiskowych.
 * Sekrety NIGDY nie sa trzymane w kodzie — czytamy je wylacznie z process.env.
 * Wartosci opcjonalne maja sensowne defaulty dla lokalnego MVP, ale produkcyjne
 * integracje (Stripe, S3) sa walidowane dopiero w momencie uzycia adaptera.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1).default("postgresql://nocturne:nocturne@localhost:5432/nocturne?schema=public"),

  ADMIN_EMAIL: z.string().email().default("admin@nocturne.local"),
  ADMIN_PASSWORD: z.string().optional(),
  ADMIN_PASSWORD_HASH: z.string().optional(),
  AUTH_SECRET: z.string().min(16).default("dev-only-secret-change-me-please-32x"),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default("./storage/uploads"),
  LOCAL_STORAGE_PUBLIC_BASE: z.string().default("/api/assets"),

  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_BASE_URL: z.string().optional(),

  QUEUE_DRIVER: z.enum(["memory", "bullmq"]).default("memory"),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  CURRENCY: z.string().default("pln"),

  IMAGE_MODERATION_DRIVER: z.enum(["mock", "external"]).default("mock"),
  IMAGE_MODERATION_API_URL: z.string().optional(),
  IMAGE_MODERATION_API_KEY: z.string().optional(),
  PROMPT_MODERATION_DRIVER: z.enum(["rules", "llm"]).default("rules"),
  LLM_MODERATION_API_URL: z.string().optional(),
  LLM_MODERATION_API_KEY: z.string().optional(),

  IMAGE_GENERATION_DRIVER: z.enum(["mock", "external"]).default("mock"),
  IMAGE_GENERATION_API_URL: z.string().optional(),
  IMAGE_GENERATION_API_KEY: z.string().optional(),

  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10_485_760),
  MAX_IMAGE_DIMENSION: z.coerce.number().int().positive().default(6000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Niepoprawna konfiguracja srodowiska:", parsed.error.flatten().fieldErrors);
  throw new Error("Niepoprawna konfiguracja srodowiska (.env). Sprawdz logi powyzej.");
}

export const env = parsed.data;

export type Env = z.infer<typeof envSchema>;

export const isStripeConfigured = (): boolean =>
  Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_SECRET_KEY.length > 0);
