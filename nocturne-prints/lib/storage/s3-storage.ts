import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { sanitizeFilename } from "@/lib/validation/sanitization";
import type { PutObjectInput, PutObjectResult, StorageAdapter } from "@/lib/storage/types";

export class S3StorageAdapter implements StorageAdapter {
  private readonly client: S3Client;

  constructor() {
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT || undefined,
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? {
              accessKeyId: env.S3_ACCESS_KEY_ID,
              secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
  }

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    if (!env.S3_BUCKET) {
      throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
    }

    const safeFilename = sanitizeFilename(input.filename);
    const key = `${input.keyPrefix}/${randomUUID()}-${safeFilename}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: input.body,
        ContentType: input.mimeType,
      }),
    );

    const base = env.S3_ENDPOINT
      ? `${env.S3_ENDPOINT.replace(/\/$/, "")}/${env.S3_BUCKET}`
      : `https://${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com`;

    return {
      storageKey: key,
      publicUrl: `${base}/${key}`,
    };
  }
}
