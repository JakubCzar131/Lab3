import { env } from "@/lib/env";
import { LocalStorageAdapter } from "./local-adapter";
import { S3StorageAdapter } from "./s3-adapter";
import type { StorageAdapter } from "./types";

let cached: StorageAdapter | null = null;

/** Fabryka adaptera storage wybierana przez STORAGE_DRIVER. */
export function getStorage(): StorageAdapter {
  if (cached) return cached;
  cached = env.STORAGE_DRIVER === "s3" ? new S3StorageAdapter() : new LocalStorageAdapter();
  return cached;
}

export type { StorageAdapter } from "./types";
