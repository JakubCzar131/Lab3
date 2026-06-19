import { AuditActorType, ConsentType, ModerationTargetType, OrderStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { legalCopy } from "@/lib/legal-copy";
import { createOrderSchema } from "@/lib/validation/schemas";
import { getVariantPrice } from "@/modules/catalog/repository";
import { classifyPromptSafety } from "@/modules/moderation/prompt";
import { toSafetyStatusEnum } from "@/modules/orders/status-mapper";
import { z } from "zod";

type CreateOrderInput = z.infer<typeof createOrderSchema>;

export async function appendStatusHistory(input: {
  orderId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actorType?: AuditActorType;
  actorId?: string;
  note?: string;
}) {
  await db.statusHistory.create({
    data: {
      orderId: input.orderId,
      fromStatus: input.fromStatus ?? undefined,
      toStatus: input.toStatus,
      actorType: input.actorType ?? AuditActorType.SYSTEM,
      actorId: input.actorId,
      note: input.note,
    },
  });
}

export async function setOrderStatus(input: {
  orderId: string;
  nextStatus: OrderStatus;
  actorType?: AuditActorType;
  actorId?: string;
  note?: string;
  rejectionReason?: string;
}) {
  const order = await db.order.findUnique({ where: { id: input.orderId } });
  if (!order) throw new Error("Order not found");
  if (order.status === input.nextStatus && !input.rejectionReason) {
    return order;
  }

  const updated = await db.order.update({
    where: { id: order.id },
    data: {
      status: input.nextStatus,
      rejectionReason: input.rejectionReason ?? order.rejectionReason,
    },
  });

  await appendStatusHistory({
    orderId: order.id,
    fromStatus: order.status,
    toStatus: input.nextStatus,
    actorType: input.actorType,
    actorId: input.actorId,
    note: input.note,
  });

  return updated;
}

export async function createOrderWithPromptModeration(
  input: CreateOrderInput,
  meta: { ipAddress?: string; userAgent?: string },
) {
  const { variant, amount } = await getVariantPrice(input.variantId);
  if (variant.productId !== input.productId) {
    throw new Error("Product and variant mismatch");
  }

  const promptModeration = await classifyPromptSafety(input.customerPrompt);
  if (promptModeration.status === "rejected") {
    return {
      order: null,
      promptModeration,
      error: "Prompt narusza zasady i nie może zostać przyjęty.",
    };
  }

  const order = await db.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        email: input.email,
        productId: input.productId,
        variantId: input.variantId,
        size: input.size,
        color: input.color,
        customerPrompt: input.customerPrompt,
        selectedStyle: input.selectedStyle,
        transformationLevel: input.transformationLevel,
        status: OrderStatus.PENDING_PAYMENT,
      },
    });

    await tx.orderItem.create({
      data: {
        orderId: created.id,
        productId: input.productId,
        variantId: input.variantId,
        unitPrice: amount,
        totalPrice: amount,
        quantity: 1,
        size: input.size,
        color: input.color,
      },
    });

    await tx.shippingInfo.create({
      data: {
        orderId: created.id,
        fullName: input.shippingInfo.fullName,
        line1: input.shippingInfo.line1,
        line2: input.shippingInfo.line2 || null,
        city: input.shippingInfo.city,
        postalCode: input.shippingInfo.postalCode,
        country: input.shippingInfo.country,
        phone: input.shippingInfo.phone || null,
      },
    });

    const consentEntries: Array<{ consentType: ConsentType; consentText: string }> = [
      { consentType: ConsentType.RIGHTS_TO_IMAGE, consentText: legalCopy.rightsToImage },
      { consentType: ConsentType.MYSTERY_NO_PREVIEW, consentText: legalCopy.noPreviewBeforePrint },
      { consentType: ConsentType.CREATIVE_VARIANCE, consentText: "Rozumiem, że efekt AI może kreatywnie różnić się od oczekiwań." },
      { consentType: ConsentType.NO_RETURN_CHANGE_OF_MIND, consentText: legalCopy.noReturnChangeOfMind },
    ];

    if (input.consents.faceConsent) {
      consentEntries.push({
        consentType: ConsentType.FACE_CONSENT,
        consentText: "Potwierdzam zgodę na wykorzystanie wizerunku osób widocznych na zdjęciu.",
      });
    }

    await tx.consentLog.createMany({
      data: consentEntries.map((entry) => ({
        orderId: created.id,
        consentType: entry.consentType,
        consentText: entry.consentText,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      })),
    });

    await tx.moderationResult.create({
      data: {
        orderId: created.id,
        targetType: ModerationTargetType.PROMPT,
        status: toSafetyStatusEnum(promptModeration.status),
        categories: promptModeration.categories,
        reasons: promptModeration.reasons,
        confidence: promptModeration.confidence,
        rawJson: promptModeration,
        detectedText: [],
      },
    });

    await tx.statusHistory.create({
      data: {
        orderId: created.id,
        toStatus: OrderStatus.PENDING_PAYMENT,
        actorType: AuditActorType.SYSTEM,
        note: "Order created",
      },
    });

    return created;
  });

  return { order, promptModeration, error: null };
}

export async function attachUploadedAssetToOrder(input: {
  orderId: string;
  storageKey: string;
  originalFilename: string;
  safeFilename: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  exifRemoved: boolean;
  safety: {
    status: "allowed" | "rejected" | "needs_manual_review";
    categories: string[];
    reasons: string[];
    confidence: number;
    detectedText: string[];
    faceDetected: boolean;
    possibleLogoDetected: boolean;
  };
}) {
  const order = await db.order.findUnique({ where: { id: input.orderId } });
  if (!order) throw new Error("Order not found");

  const asset = await db.uploadedAsset.create({
    data: {
      orderId: input.orderId,
      storageKey: input.storageKey,
      originalFilename: input.originalFilename,
      safeFilename: input.safeFilename,
      mimeType: input.mimeType,
      size: input.size,
      width: input.width,
      height: input.height,
      exifRemoved: input.exifRemoved,
      safetyStatus: toSafetyStatusEnum(input.safety.status),
      hasFace: input.safety.faceDetected,
      hasPossibleLogo: input.safety.possibleLogoDetected,
    },
  });

  await db.moderationResult.create({
    data: {
      orderId: input.orderId,
      targetType: ModerationTargetType.UPLOADED_IMAGE,
      status: toSafetyStatusEnum(input.safety.status),
      categories: input.safety.categories,
      reasons: input.safety.reasons,
      confidence: input.safety.confidence,
      rawJson: input.safety,
      detectedText: input.safety.detectedText,
      faceDetected: input.safety.faceDetected,
      possibleLogoDetected: input.safety.possibleLogoDetected,
    },
  });

  return asset;
}

export async function getOrderStatusPublic(orderId: string) {
  return db.order.findUnique({
    where: { id: orderId },
    include: {
      statusHistory: {
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export async function getOrderForAdmin(orderId: string) {
  return db.order.findUnique({
    where: { id: orderId },
    include: {
      product: true,
      variant: true,
      uploadedAssets: { orderBy: { createdAt: "desc" } },
      generatedDesigns: { orderBy: { createdAt: "desc" } },
      moderationResults: { orderBy: { createdAt: "desc" } },
      statusHistory: { orderBy: { createdAt: "desc" } },
      shippingInfo: true,
      consentLogs: { orderBy: { acceptedAt: "asc" } },
      payments: { orderBy: { createdAt: "desc" } },
    },
  });
}

export async function listOrdersForAdmin() {
  return db.order.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      product: true,
      variant: true,
      moderationResults: {
        orderBy: { createdAt: "desc" },
        take: 2,
      },
    },
  });
}
