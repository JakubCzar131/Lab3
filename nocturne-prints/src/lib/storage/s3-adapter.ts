import { env } from "@/lib/env";
import type { PutObjectInput, StorageAdapter } from "./types";

/**
 * Adapter S3 / Cloudflare R2 (R2 jest API-kompatybilne z S3).
 *
 * To jest STUB pod pozniejsza implementacje. Aby go wlaczyc:
 *  1. Zainstaluj `@aws-sdk/client-s3`.
 *  2. Uzupelnij metody put/get/delete uzywajac S3Client.
 *  3. Ustaw STORAGE_DRIVER="s3" i zmienne S3_* w .env.
 *
 * Celowo nie implementujemy tego na sztywno — interfejs jest gotowy,
 * wystarczy podpiac realne SDK bez zmiany kodu domeny.
 */
export class S3StorageAdapter implements StorageAdapter {
  readonly driver = "s3";

  constructor() {
    if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
      throw new Error(
        "Adapter S3 wymaga S3_BUCKET, S3_ACCESS_KEY_ID i S3_SECRET_ACCESS_KEY w .env."
      );
    }
  }

  async put(_input: PutObjectInput): Promise<{ key: string }> {
    throw new Error(
      "S3StorageAdapter.put nie jest jeszcze zaimplementowany. Zainstaluj @aws-sdk/client-s3 i uzupelnij stub."
    );
  }

  async get(_key: string): Promise<{ body: Buffer; contentType: string } | null> {
    throw new Error(
      "S3StorageAdapter.get nie jest jeszcze zaimplementowany. Zainstaluj @aws-sdk/client-s3 i uzupelnij stub."
    );
  }

  async delete(_key: string): Promise<void> {
    throw new Error(
      "S3StorageAdapter.delete nie jest jeszcze zaimplementowany. Zainstaluj @aws-sdk/client-s3 i uzupelnij stub."
    );
  }

  getPublicUrl(key: string): string {
    const base = (env.S3_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
    return `${base}/${key}`;
  }
}
