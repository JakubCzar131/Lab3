import { prisma } from "@/lib/db";
import { getQueue, markWorkersRegistered, type JobPayload } from "@/lib/queue";
import { getStorage } from "@/lib/storage";
import { transitionOrder } from "@/lib/orders";
import {
  classifyImageSafety,
  classifyPromptSafety,
  moderateGeneratedDesign,
  type ImageModerationResult,
  type ModerationStatus,
  type ProcessedImage,
} from "@/lib/moderation";
import {
  buildProductionPrompt,
  getImageGenerationProvider,
} from "@/lib/generation";
import type { ModerationTarget, SafetyStatus } from "@prisma/client";

/**
 * Pipeline przetwarzania zamowienia po platnosci.
 *
 *  paid -> moderation_pending --[moderate_order]--> generation_pending | needs_manual_review | rejected
 *  generation_pending --[generate_design]--> generated
 *  generated --[moderate_generated]--> production_ready | needs_manual_review | rejected
 *
 * Wszystkie etapy sa FAIL-SAFE: blad lub niepewnosc -> needs_manual_review,
 * nigdy automatyczne przejscie do druku.
 */

function moderationToSafety(status: ModerationStatus): SafetyStatus {
  if (status === "allowed") return "allowed";
  if (status === "rejected") return "rejected";
  return "needs_manual_review";
}

async function saveModerationResult(
  orderId: string,
  targetType: ModerationTarget,
  result: { status: ModerationStatus; categories: string[]; reasons: string[]; confidence: number }
) {
  await prisma.moderationResult.create({
    data: {
      orderId,
      targetType,
      status: result.status,
      categories: result.categories,
      reasons: result.reasons,
      confidence: result.confidence,
      rawJson: result as unknown as object,
    },
  });
}

// --- Etap 1: moderacja promptu + zdjecia ---
async function handleModerateOrder(payload: JobPayload) {
  const order = await prisma.order.findUnique({
    where: { id: payload.orderId },
    include: { uploadedAssets: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!order) return;
  if (order.status !== "moderation_pending" && order.status !== "paid") return;

  const statuses: ModerationStatus[] = [];
  const reasons: string[] = [];

  // 1a. Prompt
  const promptResult = await classifyPromptSafety(order.customerPrompt);
  await saveModerationResult(order.id, "prompt", promptResult);
  statuses.push(promptResult.status);
  reasons.push(...promptResult.reasons);

  // 1b. Zdjecie
  const asset = order.uploadedAssets[0];
  if (asset) {
    const stored = await getStorage().get(asset.storageKey);
    if (!stored) {
      statuses.push("needs_manual_review");
      reasons.push("Nie udało się odczytać przesłanego zdjęcia — weryfikacja ręczna.");
    } else {
      const processed: ProcessedImage = {
        buffer: stored.body,
        mimeType: "image/png",
        width: asset.width ?? 0,
        height: asset.height ?? 0,
        size: asset.size,
        exifRemoved: asset.exifRemoved,
        safeFilename: asset.originalFilename,
      };
      const imageResult: ImageModerationResult = await classifyImageSafety(processed);
      await saveModerationResult(order.id, "uploaded_image", imageResult);
      await prisma.uploadedAsset.update({
        where: { id: asset.id },
        data: { safetyStatus: moderationToSafety(imageResult.status) },
      });
      statuses.push(imageResult.status);
      reasons.push(...imageResult.reasons);
    }
  } else {
    statuses.push("needs_manual_review");
    reasons.push("Brak przesłanego zdjęcia — weryfikacja ręczna.");
  }

  // Decyzja laczona (najbardziej restrykcyjny status wygrywa).
  if (statuses.includes("rejected")) {
    await transitionOrder({
      orderId: order.id,
      to: "rejected",
      actor: "system",
      note: `Moderacja: ${reasons.join(" ")}`.slice(0, 500),
      data: { rejectionReason: reasons.join(" ").slice(0, 500) },
    });
    return;
  }
  if (statuses.includes("needs_manual_review")) {
    await transitionOrder({
      orderId: order.id,
      to: "needs_manual_review",
      actor: "system",
      note: `Wymaga weryfikacji: ${reasons.join(" ")}`.slice(0, 500),
    });
    return;
  }

  // Wszystko allowed -> generujemy.
  await transitionOrder({ orderId: order.id, to: "generation_pending", actor: "system" });
  await getQueue().enqueue("generate_design", { orderId: order.id });
}

// --- Etap 2: generowanie grafiki ---
async function handleGenerateDesign(payload: JobPayload) {
  const order = await prisma.order.findUnique({
    where: { id: payload.orderId },
    include: { uploadedAssets: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!order || order.status !== "generation_pending") return;

  // Pobierz typ produktu (do opisu produktowego promptu).
  const product = await prisma.product.findUnique({ where: { id: order.productId } });
  const finalProduction = buildProductionPrompt({
    customerPrompt: order.customerPrompt,
    style: order.selectedStyle,
    transformationLevel: order.transformationLevel,
    productType: product?.type ?? "TSHIRT",
  });

  let sourceImage: { buffer: Buffer; mimeType: string } | undefined;
  const asset = order.uploadedAssets[0];
  if (asset) {
    const stored = await getStorage().get(asset.storageKey);
    if (stored) sourceImage = { buffer: stored.body, mimeType: stored.contentType };
  }

  const provider = getImageGenerationProvider();
  const generated = await provider.generate({
    productionPrompt: finalProduction,
    sourceImage,
  });

  const key = `generated/${order.id}/${Date.now()}.png`;
  await getStorage().put({ key, body: generated.buffer, contentType: generated.mimeType });

  await prisma.generatedDesign.create({
    data: {
      orderId: order.id,
      storageKey: key,
      provider: generated.provider,
      productPrompt: finalProduction.prompt,
      safetyStatus: "pending",
    },
  });

  await transitionOrder({ orderId: order.id, to: "generated", actor: "system" });
  await getQueue().enqueue("moderate_generated", { orderId: order.id });
}

// --- Etap 3: moderacja finalnego projektu ---
async function handleModerateGenerated(payload: JobPayload) {
  const order = await prisma.order.findUnique({
    where: { id: payload.orderId },
    include: { generatedDesigns: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!order || order.status !== "generated") return;

  const design = order.generatedDesigns[0];
  if (!design) {
    await transitionOrder({
      orderId: order.id,
      to: "needs_manual_review",
      actor: "system",
      note: "Brak wygenerowanego projektu do moderacji.",
    });
    return;
  }

  const stored = await getStorage().get(design.storageKey);
  if (!stored) {
    await transitionOrder({
      orderId: order.id,
      to: "needs_manual_review",
      actor: "system",
      note: "Nie udało się odczytać wygenerowanego projektu.",
    });
    return;
  }

  const processed: ProcessedImage = {
    buffer: stored.body,
    mimeType: "image/png",
    width: 0,
    height: 0,
    size: stored.body.length,
    exifRemoved: true,
    safeFilename: "generated.png",
  };

  const result = await moderateGeneratedDesign(processed);
  await saveModerationResult(order.id, "generated_design", result);
  await prisma.generatedDesign.update({
    where: { id: design.id },
    data: { safetyStatus: moderationToSafety(result.status) },
  });

  if (result.status === "rejected") {
    await transitionOrder({
      orderId: order.id,
      to: "rejected",
      actor: "system",
      note: `Finalna moderacja odrzuciła projekt: ${result.reasons.join(" ")}`.slice(0, 500),
      data: { rejectionReason: result.reasons.join(" ").slice(0, 500) },
    });
    return;
  }
  if (result.status === "needs_manual_review") {
    await transitionOrder({
      orderId: order.id,
      to: "needs_manual_review",
      actor: "system",
      note: `Finalny projekt wymaga weryfikacji: ${result.reasons.join(" ")}`.slice(0, 500),
    });
    return;
  }

  await transitionOrder({ orderId: order.id, to: "production_ready", actor: "system" });
}

/** Rejestruje handlery w kolejce (idempotentnie). Wolane przez ensureWorkers(). */
export function registerWorkers(): void {
  if (!markWorkersRegistered()) return;
  const queue = getQueue();
  queue.register("moderate_order", handleModerateOrder);
  queue.register("generate_design", handleGenerateDesign);
  queue.register("moderate_generated", handleModerateGenerated);
}

/** Wywolywane przy starcie pipeline'u (np. po platnosci) by zapewnic rejestracje. */
export function ensureWorkers(): void {
  registerWorkers();
}
