import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { AdminOrderStatusActions } from "@/components/forms/admin-order-status-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getAdminSession } from "@/lib/auth/session";
import { getOrderForAdmin } from "@/modules/orders/service";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

function toLabel(value: string) {
  return value.toLowerCase().replaceAll("_", " ");
}

export default async function AdminOrderPage(props: PageProps) {
  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/login");
  }

  const { id } = await props.params;
  const order = await getOrderForAdmin(id);
  if (!order) {
    return (
      <div>
        <p className="text-zinc-300">Nie znaleziono zamówienia.</p>
      </div>
    );
  }

  const latestAsset = order.uploadedAssets[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Zamówienie {order.id}</h1>
          <p className="text-zinc-300">{order.email}</p>
        </div>
        <Badge>{toLabel(order.status)}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Dane klienta i produktu</CardTitle>
          <CardDescription className="mt-3 space-y-1 text-zinc-300">
            <span className="block">Produkt: {order.product.name}</span>
            <span className="block">Wariant: {order.variant.colorName}</span>
            <span className="block">Rozmiar: {order.size}</span>
            <span className="block">Styl: {order.selectedStyle}</span>
            <span className="block">Transformacja: {order.transformationLevel}</span>
          </CardDescription>
        </Card>

        <Card>
          <CardTitle>Akcje admina</CardTitle>
          <CardDescription className="mt-2">Zaakceptuj, odrzuć albo przesuń status produkcyjny.</CardDescription>
          <div className="mt-4">
            <AdminOrderStatusActions orderId={order.id} />
          </div>
        </Card>
      </div>

      <Card>
        <CardTitle>Prompt klienta</CardTitle>
        <p className="mt-3 whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-900 p-3 text-sm text-zinc-100">
          {order.customerPrompt}
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Przesłane zdjęcie</CardTitle>
          {latestAsset ? (
            <div className="mt-3 space-y-3">
              <Image
                src={`/api/assets/${latestAsset.storageKey}`}
                alt="Przesłane zdjęcie klienta"
                width={latestAsset.width}
                height={latestAsset.height}
                unoptimized
                className="max-h-[420px] w-full rounded-md border border-zinc-800 object-contain"
              />
              <p className="text-xs text-zinc-400">
                {latestAsset.originalFilename} • {latestAsset.width}x{latestAsset.height} • exif removed:{" "}
                {String(latestAsset.exifRemoved)}
              </p>
            </div>
          ) : (
            <CardDescription className="mt-3">Brak przesłanego zdjęcia.</CardDescription>
          )}
        </Card>

        <Card>
          <CardTitle>Wyniki moderacji</CardTitle>
          <div className="mt-3 space-y-2 text-sm">
            {order.moderationResults.map((result) => (
              <div key={result.id} className="rounded-md border border-zinc-800 p-3">
                <p className="text-zinc-200">
                  {toLabel(result.targetType)} → <strong>{toLabel(result.status)}</strong>
                </p>
                {result.categories.length ? (
                  <p className="mt-1 text-zinc-400">Kategorie: {result.categories.join(", ")}</p>
                ) : null}
                {result.reasons.length ? <p className="mt-1 text-zinc-400">Powody: {result.reasons.join("; ")}</p> : null}
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <CardTitle>Historia statusów i audyt</CardTitle>
        <div className="mt-3 space-y-2 text-sm">
          {order.statusHistory.map((entry) => (
            <div key={entry.id} className="rounded-md border border-zinc-800 p-3">
              <p className="text-zinc-100">
                {entry.fromStatus ? `${toLabel(entry.fromStatus)} -> ` : ""} {toLabel(entry.toStatus)}
              </p>
              <p className="text-xs text-zinc-500">
                {entry.actorType} {entry.actorId ? `(${entry.actorId})` : ""} • {entry.createdAt.toLocaleString("pl-PL")}
              </p>
              {entry.note ? <p className="text-zinc-400">{entry.note}</p> : null}
            </div>
          ))}
        </div>
      </Card>

      <Link href="/admin/orders" className="text-sm text-violet-300 hover:text-violet-200">
        ← Powrót do listy zamówień
      </Link>
    </div>
  );
}
