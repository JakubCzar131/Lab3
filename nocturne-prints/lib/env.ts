import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://postgres:postgres@localhost:5432/nocturne_prints?schema=public"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  ADMIN_EMAIL: z.string().email().default("admin@nocturneprints.com"),
  ADMIN_PASSWORD_HASH: z
    .string()
    .min(1)
    .default("$2b$12$9x4R3RJd2vMThQ2Wf6fagOT2tKVfSEfXvBy06SnVAk0nnBYnCTsRm"),
  ADMIN_JWT_SECRET: z.string().min(32).default("replace-this-secret-in-production-nocturne-prints"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_CURRENCY: z.string().default("pln"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default("./storage"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("eu-central-1"),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  QUEUE_DRIVER: z.enum(["local", "bullmq"]).default("local"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => issue.message).join("; ");
  throw new Error(`Invalid environment variables: ${issues}`);
}

export const env = parsed.data;
