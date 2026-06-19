import { OrderConfiguratorForm } from "@/components/forms/order-configurator-form";
import { getActiveCatalog } from "@/modules/catalog/repository";

export const dynamic = "force-dynamic";

export default async function ConfiguratorPage() {
  const products = await getActiveCatalog();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold text-zinc-100">Konfigurator</h1>
        <p className="mt-2 max-w-3xl text-zinc-300">
          Wybierz produkt, dodaj zdjęcie i prompt. Moderacja bezpieczeństwa działa warstwowo i fail-safe.
        </p>
      </header>
      <OrderConfiguratorForm
        products={products.map((product) => ({
          id: product.id,
          name: product.name,
          description: product.description,
          variants: product.variants.map((variant) => ({
            id: variant.id,
            colorName: variant.colorName,
            availableSizes: variant.availableSizes,
          })),
        }))}
      />
    </div>
  );
}
