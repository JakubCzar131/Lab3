import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatPrice } from "@/lib/utils";

export const metadata: Metadata = { title: "Katalog" };
export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const products = await prisma.product.findMany({
    where: { active: true },
    include: { variants: true },
    orderBy: { basePrice: "asc" },
  });

  return (
    <div className="container py-16">
      <header className="mb-12 text-center">
        <h1 className="font-display text-4xl font-semibold text-gradient">Katalog</h1>
        <p className="mt-3 text-muted-foreground">
          Wybierz nośnik. Resztą — nadrukiem — zajmie się algorytm.
        </p>
      </header>

      {products.length === 0 ? (
        <p className="text-center text-muted-foreground">
          Brak produktów. Uruchom <code className="text-gold">npm run db:seed</code>.
        </p>
      ) : (
        <div className="grid gap-8 sm:grid-cols-2">
          {products.map((product) => {
            const colors = Array.from(new Map(product.variants.map((v) => [v.color, v])).values());
            const sizes = Array.from(new Set(product.variants.map((v) => v.size)));
            return (
              <Card key={product.id} className="overflow-hidden">
                <div className="aspect-square w-full overflow-hidden bg-background/50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={product.mockupUrl ?? "/mockups/tshirt.svg"}
                    alt={`Mockup: ${product.name}`}
                    className="h-full w-full object-cover"
                  />
                </div>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-xl font-semibold">{product.name}</h2>
                    <Badge variant="gold">{formatPrice(product.basePrice)}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{product.description}</p>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {colors.map((v) => (
                      <span
                        key={v.color}
                        title={v.color}
                        aria-label={`Kolor: ${v.color}`}
                        className="h-6 w-6 rounded-full border border-border"
                        style={{ backgroundColor: v.colorHex }}
                      />
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {sizes.map((s) => (
                      <Badge key={s} variant="secondary">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
                <CardFooter>
                  <Button asChild variant="gold" className="w-full">
                    <Link href={`/konfigurator?product=${product.slug}`}>Konfiguruj</Link>
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
