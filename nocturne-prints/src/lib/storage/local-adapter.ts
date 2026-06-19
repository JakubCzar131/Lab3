import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import type { PutObjectInput, StorageAdapter } from "./types";

/**
 * Lokalny adapter storage dla MVP / developmentu.
 * Pliki trzymane sa poza public/ i serwowane przez chroniony route /api/assets,
 * dzieki czemu uploady uzytkownikow nie sa publicznie listowalne.
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly driver = "local";
  private baseDir: string;

  constructor() {
    this.baseDir = path.resolve(process.cwd(), env.LOCAL_STORAGE_DIR);
  }

  private resolve(key: string): string {
    // Zabezpieczenie przed path traversal: normalizujemy i sprawdzamy prefix.
    const safeKey = key.replace(/\\/g, "/").replace(/^\/+/, "");
    const full = path.resolve(this.baseDir, safeKey);
    if (!full.startsWith(this.baseDir)) {
      throw new Error("Nieprawidlowy klucz storage (path traversal).");
    }
    return full;
  }

  async put(input: PutObjectInput): Promise<{ key: string }> {
    const full = this.resolve(input.key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, input.body);
    // Zapisujemy content-type obok pliku, by adapter byl bezstanowy przy odczycie.
    await fs.writeFile(`${full}.meta`, input.contentType, "utf8");
    return { key: input.key };
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    try {
      const full = this.resolve(key);
      const body = await fs.readFile(full);
      let contentType = "application/octet-stream";
      try {
        contentType = (await fs.readFile(`${full}.meta`, "utf8")).trim();
      } catch {
        // brak meta — uzyj domyslnego
      }
      return { body, contentType };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const full = this.resolve(key);
      await fs.unlink(full).catch(() => undefined);
      await fs.unlink(`${full}.meta`).catch(() => undefined);
    } catch {
      // idempotentne usuwanie
    }
  }

  getPublicUrl(key: string): string {
    const base = env.LOCAL_STORAGE_PUBLIC_BASE.replace(/\/$/, "");
    return `${base}/${encodeURIComponent(key)}`;
  }
}
