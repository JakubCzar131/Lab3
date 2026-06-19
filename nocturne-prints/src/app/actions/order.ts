"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { createOrderSchema } from "@/lib/validation";
import { CONSENT_DEFINITIONS } from "@/lib/brand-copy";
import { createCheckoutSession } from "@/lib/checkout";
import type { ConsentType } from "@prisma/client";

export interface CreateOrderState {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

/**
 * Server action: tworzy zamowienie + zgody + sesje platnosci.
 *
 * Bezpieczenstwo:
 *  - pelna walidacja Zod (nie ufamy klientowi),
 *  - cena liczona po stronie serwera ze snapshotu produktu/wariantu,
 *  - jesli na zdjeciu wykryto twarz, wymagamy zgody na wizerunek (nawet jesli
 *    klient jej nie zaznaczyl, blokujemy),
 *  - kazda zgoda zapisywana jako snapshot tekstu + IP + user agent (audyt).
 */
export async function createOrderAction(
  _prev: CreateOrderState,
  formData: FormData
): Promise<CreateOrderState> {
  const raw = {
    email: String(formData.get("email") ?? ""),
    productId: String(formData.get("productId") ?? ""),
    variantId: String(formData.get("variantId") ?? ""),
    size: String(formData.get("size") ?? ""),
    color: String(formData.get("color") ?? ""),
    customerPrompt: String(formData.get("customerPrompt") ?? ""),
    selectedStyle: String(formData.get("selectedStyle") ?? ""),
    transformationLevel: String(formData.get("transformationLevel") ?? ""),
    consentImageRights: formData.get("consentImageRights") === "on" || formData.get("consentImageRights") === "true",
    consentMysteryNoPreview: formData.get("consentMysteryNoPreview") === "on" || formData.get("consentMysteryNoPreview") === "true",
    consentCreativeVariation: formData.get("consentCreativeVariation") === "on" || formData.get("consentCreativeVariation") === "true",
    consentNoWithdrawal: formData.get("consentNoWithdrawal") === "on" || formData.get("consentNoWithdrawal") === "true",
    consentFaceLikeness: formData.get("consentFaceLikeness") === "on" || formData.get("consentFaceLikeness") === "true",
    uploadAssetId: String(formData.get("uploadAssetId") ?? ""),
  };

  const parsed = createOrderSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  }
  const data = parsed.data;

  // Produkt + wariant (snapshot ceny po stronie serwera).
  const variant = await prisma.productVariant.findUnique({
    where: { id: data.variantId },
    include: { product: true },
  });
  if (!variant || variant.productId !== data.productId) {
    return { ok: false, error: "Wybrany wariant produktu nie istnieje." };
  }
  if (variant.size !== data.size || variant.color !== data.color) {
    return { ok: false, error: "Niespójny wariant (kolor/rozmiar)." };
  }

  const asset = await prisma.uploadedAsset.findUnique({ where: { id: data.uploadAssetId } });
  if (!asset) {
    return { ok: false, error: "Nie znaleziono przesłanego zdjęcia. Prześlij je ponownie." };
  }
  if (asset.orderId) {
    return { ok: false, error: "To zdjęcie zostało już użyte w innym zamówieniu." };
  }

  // Jesli wykryto twarz — zgoda na wizerunek jest OBOWIAZKOWA.
  if (asset.faceDetected && !data.consentFaceLikeness) {
    return {
      ok: false,
      fieldErrors: {
        consentFaceLikeness: ["Na zdjęciu wykryto twarz — wymagana jest zgoda na wykorzystanie wizerunku."],
      },
    };
  }

  const amountTotal = variant.product.basePrice + variant.priceDiff;

  const hdrs = headers();
  const ipAddress = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = hdrs.get("user-agent") ?? null;

  // Budujemy snapshoty zgod (tekst pokazany klientowi).
  const consentMap: Record<string, boolean> = {
    image_rights: data.consentImageRights,
    mystery_no_preview: data.consentMysteryNoPreview,
    creative_variation: data.consentCreativeVariation,
    no_withdrawal_personalized: data.consentNoWithdrawal,
    face_likeness: data.consentFaceLikeness,
  };

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        email: data.email.toLowerCase(),
        productId: data.productId,
        variantId: data.variantId,
        size: data.size,
        color: data.color,
        customerPrompt: data.customerPrompt,
        selectedStyle: data.selectedStyle,
        transformationLevel: data.transformationLevel,
        status: "pending_payment",
        amountTotal,
        currency: env.CURRENCY,
        items: {
          create: {
            description: `${variant.product.name} — ${data.color} / ${data.size} (AI mystery print)`,
            quantity: 1,
            unitPrice: amountTotal,
          },
        },
      },
    });

    await tx.uploadedAsset.update({ where: { id: asset.id }, data: { orderId: created.id } });

    for (const def of CONSENT_DEFINITIONS) {
      if (consentMap[def.type]) {
        await tx.consentLog.create({
          data: {
            orderId: created.id,
            consentType: def.type as ConsentType,
            consentText: def.text,
            ipAddress,
            userAgent,
          },
        });
      }
    }

    await tx.statusHistory.create({
      data: { orderId: created.id, toStatus: "pending_payment", actor: "system", note: "Zamówienie utworzone." },
    });

    return created;
  });

  const full = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    include: { product: true },
  });

  const { url } = await createCheckoutSession(full);
  redirect(url);
}
