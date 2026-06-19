export type PutObjectInput = {
  keyPrefix: string;
  filename: string;
  mimeType: string;
  body: Buffer;
};

export type PutObjectResult = {
  storageKey: string;
  publicUrl: string;
};

export interface StorageAdapter {
  putObject(input: PutObjectInput): Promise<PutObjectResult>;
}
