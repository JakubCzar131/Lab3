import { jsonError, jsonOk } from "@/lib/http";
import { classifyImageSafety } from "@/modules/moderation/image";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const faceConsent = formData.get("faceConsent") === "true";

    if (!(file instanceof File)) {
      throw new Error("Missing image file");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await classifyImageSafety({
      buffer,
      filename: file.name,
      mimeType: file.type,
      faceConsent,
    });

    return jsonOk(result);
  } catch (error) {
    return jsonError(error, "Image moderation failed");
  }
}
