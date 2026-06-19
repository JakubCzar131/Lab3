/**
 * Abstrakcja storage. Pozwala wymienic backend (local <-> S3/R2)
 * bez zmiany kodu domeny. Klucze (`storageKey`) sa zapisywane w bazie.
 */
export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface StorageAdapter {
  readonly driver: string;
  /** Zapisuje obiekt i zwraca jego klucz. */
  put(input: PutObjectInput): Promise<{ key: string }>;
  /** Pobiera obiekt jako Buffer (np. do moderacji lub serwowania). */
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  /** Usuwa obiekt. */
  delete(key: string): Promise<void>;
  /** Zwraca publiczny / serwowalny URL dla klucza. */
  getPublicUrl(key: string): string;
}
