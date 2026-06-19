import { db } from "@/lib/db";

export async function getActiveCatalog() {
  return db.product.findMany({
    where: { isActive: true },
    include: { variants: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function getVariantPrice(variantId: string) {
  const variant = await db.productVariant.findUnique({
    where: { id: variantId },
    include: { product: true },
  });

  if (!variant) {
    throw new Error("Variant not found");
  }

  const amount = variant.product.basePrice + variant.priceDelta;
  return { variant, amount };
}
