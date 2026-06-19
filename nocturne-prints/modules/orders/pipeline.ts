import { AuditActorType, ModerationTargetType, OrderStatus, Prisma, SafetyStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getQueueAdapter } from "@/lib/queue";
import type { QueueHandlerMap } from "@/lib/queue/types";
import { getStorageAdapter } from "@/lib/storage";
import { classifyImageSafety } from "@/modules/moderation/image";
import { buildProductionPrompt } from "@/modules/generation/build-production-prompt";
import { getImageGenerationProvider } from "@/modules/generation/providers";
import { decideFailSafeModerationStatus, toSafetyStatusEnum } from "@/modules/orders/status-mapper";
import { setOrderStatus } from "@/modules/orders/service";

function normalizeSafetyStatus(status: SafetyStatus) {
  if (status === SafetyStatus.ALLOWED) return "allowed" as const;
  if (status === SafetyStatus.REJECTED) return "rejected" as const;
  return "needs_manual_review" as const;
}

export async function processOrderModeration(orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      moderationResults: {
        orderBy: { createdAt: "desc" },
      },
      uploadedAssets: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!order) {
    throw new Error("Order not found");
  }

  if (!order.uploadedAssets.length) {
    await setOrderStatus({
      orderId,
      nextStatus: OrderStatus.NEEDS_MANUAL_REVIEW,
      note: "Missing uploaded image for moderation",
      actorType: AuditActorType.SYSTEM,
    });
    return;
  }

  const relevant = order.moderationResults.filter(
    (result) =>
      result.targetType === ModerationTargetType.PROMPT ||
      result.targetType === ModerationTargetType.UPLOADED_IMAGE,
  );

  const merged = decideFailSafeModerationStatus(
    relevant.map((result) => ({
      status: normalizeSafetyStatus(result.status),
      categories: result.categories,
      reasons: result.reasons,
      confidence: result.confidence,
      detectedText: result.detectedText,
      faceDetected: result.faceDetected ?? false,
      possibleLogoDetected: result.possibleLogoDetected ?? false,
    })),
  );

  if (merged === "rejected") {
    await setOrderStatus({
      orderId,
      nextStatus: OrderStatus.REJECTED,
      note: "Automatyczna moderacja odrzuciła zamówienie.",
      rejectionReason: "Treść zamówienia narusza zasady bezpieczeństwa.",
      actorType: AuditActorType.SYSTEM,
    });
    return;
  }

  if (merged === "needs_manual_review") {
    await setOrderStatus({
      orderId,
      nextStatus: OrderStatus.NEEDS_MANUAL_REVIEW,
      note: "Niepewny wynik moderacji — wymagany review ręczny.",
      actorType: AuditActorType.SYSTEM,
    });
    return;
  }

  await setOrderStatus({
    orderId,
    nextStatus: OrderStatus.GENERATION_PENDING,
    note: "Moderation passed, design generation queued.",
    actorType: AuditActorType.SYSTEM,
  });

  const queue = getOrderQueue();
  await queue.dispatch("order.generate", { orderId });
}

export async function processOrderGeneration(orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      product: true,
      uploadedAssets: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!order) throw new Error("Order not found");
  if (!order.uploadedAssets[0]) {
    await setOrderStatus({
      orderId,
      nextStatus: OrderStatus.NEEDS_MANUAL_REVIEW,
      note: "No uploaded image available for generation context.",
      actorType: AuditActorType.SYSTEM,
    });
    return;
  }

  const productionPrompt = buildProductionPrompt({
    customerPrompt: order.customerPrompt,
    selectedStyle: order.selectedStyle,
    productType: order.product.type,
    transformationLevel: order.transformationLevel,
  });

  const generationProvider = getImageGenerationProvider();
  const generated = await generationProvider.generateDesign({
    customerPrompt: order.customerPrompt,
    selectedStyle: order.selectedStyle,
    productType: order.product.type,
    transformationLevel: order.transformationLevel,
    safetyDirectives: [
      "no brands",
      "no copyrighted characters",
      "no celebrity likeness",
      "no extremist symbols",
      "no sexual or graphic content",
    ],
  });

  const safety = await classifyImageSafety({
    buffer: generated.imageBuffer,
    filename: `${order.id}-generated.png`,
    mimeType: generated.mimeType,
    faceConsent: true,
  });

  const storage = getStorageAdapter();
  const stored = await storage.putObject({
    keyPrefix: `generated/${order.id}`,
    filename: "generated-design.png",
    mimeType: generated.mimeType,
    body: generated.imageBuffer,
  });

  await db.generatedDesign.create({
    data: {
      orderId,
      provider: generated.provider,
      storageKey: stored.storageKey,
      promptUsed: productionPrompt,
      safetyStatus: toSafetyStatusEnum(safety.status),
      generationMeta: generated.meta as Prisma.InputJsonValue | undefined,
    },
  });

  await db.moderationResult.create({
    data: {
      orderId,
      targetType: ModerationTargetType.GENERATED_DESIGN,
      status: toSafetyStatusEnum(safety.status),
      categories: safety.categories,
      reasons: safety.reasons,
      confidence: safety.confidence,
      detectedText: safety.detectedText,
      faceDetected: safety.faceDetected,
      possibleLogoDetected: safety.possibleLogoDetected,
      rawJson: safety,
    },
  });

  if (safety.status === "rejected") {
    await setOrderStatus({
      orderId,
      nextStatus: OrderStatus.REJECTED,
      note: "Generated design failed safety moderation.",
      rejectionReason: "Wygenerowany projekt narusza zasady bezpieczeństwa treści.",
      actorType: AuditActorType.SYSTEM,
    });
    return;
  }

  if (safety.status === "needs_manual_review") {
    await setOrderStatus({
      orderId,
      nextStatus: OrderStatus.NEEDS_MANUAL_REVIEW,
      note: "Generated design requires manual review.",
      actorType: AuditActorType.SYSTEM,
    });
    return;
  }

  await setOrderStatus({
    orderId,
    nextStatus: OrderStatus.GENERATED,
    note: "Design generated and passed moderation.",
    actorType: AuditActorType.SYSTEM,
  });
}

const queueHandlers: QueueHandlerMap = {
  "order.moderate": async ({ orderId }) => processOrderModeration(orderId),
  "order.generate": async ({ orderId }) => processOrderGeneration(orderId),
  "design.moderate": async ({ orderId }) => processOrderGeneration(orderId),
};

export function getOrderQueue() {
  return getQueueAdapter(queueHandlers);
}
