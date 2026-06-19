import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import {
  ConfiguratorForm,
  type ConfiguratorProduct,
} from "@/components/shop/configurator-form";

export const metadata: Metadata = { title: "Konfigurator" };
export const dynamic = "force-dynamic";

export default async function ConfiguratorPage({
  searchParams,
}: {
  searchParams: { product?: string };
}) {
  const products = await prisma.product.findMany({
    where: { active: true },
    include: { variants: { orderBy: [{ color: "asc" }, { size: "asc" }] } },
    orderBy: { basePrice: "asc" },
  });

  const serialized: ConfiguratorProduct[] = products.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    type: p.type,
    basePrice: p.basePrice,
    mockupUrl: p.mockupUrl,
    variants: p.variants.map((v) => ({
      id: v.id,
      color: v.color,
      colorHex: v.colorHex,
      size: v.size,
      priceDiff: v.priceDiff,
    })),
  }));

  return (
    <div className="container py-12">
      <header className="mb-10">
        <h1 className="font-display text-4xl font-semibold text-gradient">Konfigurator</h1>
        <p className="mt-2 max-w-xl text-muted-foreground">
          Masz wpływ na nośnik, kolor, rozmiar, styl i intencję. Reszta to rytuał — efekt poznasz po otwarciu paczki.
        </p>
      </header>

      {serialized.length === 0 ? (
        <p className="text-muted-foreground">
          Brak produktów. Uruchom <code className="text-gold">npm run db:seed</code>.
        </p>
      ) : (
        <ConfiguratorForm products={serialized} initialSlug={searchParams.product} />
      )}
    </div>
  );
}
