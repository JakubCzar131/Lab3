import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { classifyImageSafety, validateAndProcessImage } from "@/lib/moderation";

export const runtime = "nodejs";

/**
 * Upload zdjecia do konfiguratora.
 *
 * Kroki:
 *  1. Walidacja pliku (MIME, rozmiar, wymiary) + usuniecie EXIF (sharp).
 *  2. Bezpieczna nazwa pliku, zapis do storage.
 *  3. Wstepna moderacja (UX): wykrycie twarzy, oczywiste NSFW/gore -> blokada.
 *     UWAGA: To tylko sygnal wstepny. Kanoniczna moderacja zachodzi po platnosci
 *     w pipeline (fail-safe) — tutaj nie "przepuszczamy" niczego na stale.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Brak pliku." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const processed = await validateAndProcessImage({
      buffer,
      mimeType: file.type,
      filename: file.name || "upload",
    });

    if (!processed.ok) {
      return NextResponse.json({ error: processed.reason }, { status: 422 });
    }

    // Wstepna analiza obrazu (twarz / oczywiste naruszenia).
    const prefilter = await classifyImageSafety(processed);

    // Twardy reject juz na uploadzie dla oczywistych naruszen — oszczedza platnosc.
    if (prefilter.status === "rejected") {
      return NextResponse.json(
        {
          error: "To zdjęcie narusza nasze zasady i nie może zostać użyte.",
          reasons: prefilter.reasons,
        },
        { status: 422 }
      );
    }

    const key = `uploads/${processed.safeFilename}`;
    await getStorage().put({ key, body: processed.buffer, contentType: processed.mimeType });

    const asset = await prisma.uploadedAsset.create({
      data: {
        storageKey: key,
        originalFilename: processed.safeFilename,
        mimeType: processed.mimeType,
        size: processed.size,
        width: processed.width,
        height: processed.height,
        exifRemoved: processed.exifRemoved,
        faceDetected: prefilter.faceDetected,
        prefilterStatus:
          prefilter.status === "allowed" ? "allowed" : "needs_manual_review",
      },
    });

    return NextResponse.json({
      assetId: asset.id,
      previewUrl: getStorage().getPublicUrl(key),
      faceDetected: prefilter.faceDetected,
      needsReview: prefilter.status === "needs_manual_review",
      reasons: prefilter.reasons,
    });
  } catch (err) {
    console.error("[api/upload] blad", err);
    return NextResponse.json({ error: "Błąd serwera podczas uploadu." }, { status: 500 });
  }
}
