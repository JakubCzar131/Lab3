import { jsonError, jsonOk } from "@/lib/http";
import { getStorageAdapter } from "@/lib/storage";
import { sanitizeFilename } from "@/lib/validation/sanitization";
import { classifyImageSafety, prepareImageForStorage } from "@/modules/moderation/image";
import { attachUploadedAssetToOrder } from "@/modules/orders/service";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const orderId = formData.get("orderId");
    const faceConsent = formData.get("faceConsent") === "true";

    if (!(file instanceof File)) {
      throw new Error("Missing image file");
    }
    if (typeof orderId !== "string" || !orderId.trim()) {
      throw new Error("Missing orderId");
    }

    const originalBuffer = Buffer.from(await file.arrayBuffer());
    const prepared = await prepareImageForStorage({
      buffer: originalBuffer,
      mimeType: file.type,
    });

    const moderation = await classifyImageSafety({
      buffer: prepared.cleanedBuffer,
      filename: file.name,
      mimeType: file.type,
      faceConsent,
    });

    const safeFilename = sanitizeFilename(file.name);
    const storage = getStorageAdapter();
    const stored = await storage.putObject({
      keyPrefix: `uploads/${orderId}`,
      filename: safeFilename,
      mimeType: file.type,
      body: prepared.cleanedBuffer,
    });

    const asset = await attachUploadedAssetToOrder({
      orderId,
      storageKey: stored.storageKey,
      originalFilename: file.name,
      safeFilename,
      mimeType: file.type,
      size: prepared.cleanedBuffer.byteLength,
      width: prepared.width,
      height: prepared.height,
      exifRemoved: prepared.exifRemoved,
      safety: moderation,
    });

    return jsonOk({
      assetId: asset.id,
      storageKey: asset.storageKey,
      moderation,
    });
  } catch (error) {
    return jsonError(error, "Image upload failed");
  }
}
