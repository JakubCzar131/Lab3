import { env } from "@/lib/env";
import { LocalStorageAdapter } from "@/lib/storage/local-storage";
import { S3StorageAdapter } from "@/lib/storage/s3-storage";
import type { StorageAdapter } from "@/lib/storage/types";

let adapter: StorageAdapter | null = null;

export function getStorageAdapter(): StorageAdapter {
  if (adapter) {
    return adapter;
  }

  adapter = env.STORAGE_DRIVER === "s3" ? new S3StorageAdapter() : new LocalStorageAdapter();
  return adapter;
}
