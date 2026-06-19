import Link from "next/link";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getActiveCatalog } from "@/modules/catalog/repository";

export const dynamic = "force-dynamic";

function formatPrice(cents: number) {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(cents / 100);
}

export default async function CatalogPage() {
  const products = await getActiveCatalog();

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-zinc-100">Katalog</h1>
        <p className="text-zinc-300">Koszulki i bluzy mystery print w mrocznej estetyce premium.</p>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        {products.map((product) => (
          <Card key={product.id}>
            <CardTitle>{product.name}</CardTitle>
            <CardDescription className="mt-2">{product.description}</CardDescription>
            <div className="mt-4 space-y-3">
              {product.variants.map((variant) => (
                <div key={variant.id} className="rounded-md border border-zinc-800 p-3 text-sm text-zinc-300">
                  <div className="flex items-center justify-between">
                    <span>{variant.colorName}</span>
                    <span className="font-semibold text-zinc-100">
                      {formatPrice(product.basePrice + variant.priceDelta)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-400">Rozmiary: {variant.availableSizes.join(", ")}</p>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Link href="/konfigurator">
        <Button size="lg">Przejdź do konfiguratora</Button>
      </Link>
    </div>
  );
}
