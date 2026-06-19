import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { sanitizeFilename } from "@/lib/validation/sanitization";
import type { PutObjectInput, PutObjectResult, StorageAdapter } from "@/lib/storage/types";

export class LocalStorageAdapter implements StorageAdapter {
  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    const safeFilename = sanitizeFilename(input.filename);
    const key = `${input.keyPrefix}/${randomUUID()}-${safeFilename}`;
    const baseDir = path.resolve(process.cwd(), env.LOCAL_STORAGE_DIR);
    const absolutePath = path.join(baseDir, key);
    const parentDir = path.dirname(absolutePath);

    await mkdir(parentDir, { recursive: true });
    await writeFile(absolutePath, input.body);

    return {
      storageKey: key,
      publicUrl: `/api/assets/${encodeURIComponent(key)}`,
    };
  }
}
