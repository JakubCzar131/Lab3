import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getStorage } from "@/lib/storage";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { OrderStatusBadge } from "@/components/shop/order-status-badge";
import { AdminOrderActions } from "@/components/admin/order-actions";
import { formatDateTime, formatPrice, shortId } from "@/lib/utils";
import { STYLE_LABELS, TRANSFORMATION_LABELS } from "@/lib/validation";
import { STATUS_LABELS } from "@/lib/orders";

export const metadata: Metadata = { title: "Szczegóły zamówienia — panel" };
export const dynamic = "force-dynamic";

export default async function AdminOrderDetail({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect("/admin/login");

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: {
      product: true,
      variant: true,
      uploadedAssets: { orderBy: { createdAt: "desc" } },
      generatedDesigns: { orderBy: { createdAt: "desc" } },
      moderationResults: { orderBy: { createdAt: "desc" } },
      statusHistory: { orderBy: { createdAt: "asc" } },
      consents: true,
      payment: true,
    },
  });

  if (!order) notFound();

  const storage = getStorage();
  const asset = order.uploadedAssets[0];
  const design = order.generatedDesigns[0];

  return (
    <div className="container py-10">
      <Link href="/admin" className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Powrót do listy
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold">Zamówienie #{shortId(order.id)}</h1>
        <OrderStatusBadge status={order.status} />
      </div>
      <p className="mt-1 font-mono text-xs text-muted-foreground">{order.id}</p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {/* Dane zamowienia */}
          <Card>
            <CardContent className="p-6">
              <h2 className="mb-4 font-display text-lg font-semibold">Dane zamówienia</h2>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Item label="E-mail" value={order.email} />
                <Item label="Produkt" value={order.product.name} />
                <Item label="Wariant" value={`${order.color} / ${order.size}`} />
                <Item label="Styl" value={STYLE_LABELS[order.selectedStyle]} />
                <Item label="Transformacja" value={TRANSFORMATION_LABELS[order.transformationLevel]} />
                <Item label="Kwota" value={formatPrice(order.amountTotal, order.currency)} />
                <Item label="Płatność" value={order.payment?.status ?? "—"} />
                <Item label="Stripe session" value={order.stripeSessionId ?? "—"} />
              </dl>
              <Separator className="my-4" />
              <div>
                <p className="text-sm text-muted-foreground">Prompt klienta</p>
                <p className="mt-1 rounded-md border border-border/60 bg-background/40 p-3 text-sm">
                  {order.customerPrompt}
                </p>
              </div>
              {order.rejectionReason && (
                <p className="mt-3 text-sm text-destructive">Powód odrzucenia: {order.rejectionReason}</p>
              )}
            </CardContent>
          </Card>

          {/* Zdjecia */}
          <Card>
            <CardContent className="p-6">
              <h2 className="mb-4 font-display text-lg font-semibold">Materiały</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="mb-2 text-sm text-muted-foreground">Przesłane zdjęcie</p>
                  {asset ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={storage.getPublicUrl(asset.storageKey)}
                        alt="Przesłane zdjęcie klienta"
                        className="aspect-square w-full rounded-lg border border-border object-cover"
                      />
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Badge variant={asset.faceDetected ? "warning" : "secondary"}>
                          {asset.faceDetected ? "Twarz: tak" : "Twarz: nie"}
                        </Badge>
                        <Badge variant="secondary">EXIF: {asset.exifRemoved ? "usunięty" : "—"}</Badge>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Brak.</p>
                  )}
                </div>
                <div>
                  <p className="mb-2 text-sm text-muted-foreground">Wygenerowany projekt</p>
                  {design ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={storage.getPublicUrl(design.storageKey)}
                        alt="Wygenerowany projekt"
                        className="aspect-square w-full rounded-lg border border-border object-cover"
                      />
                      <Badge variant="secondary" className="mt-2">
                        {design.provider}
                      </Badge>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Jeszcze nie wygenerowano.</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Wyniki moderacji */}
          <Card>
            <CardContent className="p-6">
              <h2 className="mb-4 font-display text-lg font-semibold">Wyniki moderacji</h2>
              {order.moderationResults.length === 0 ? (
                <p className="text-sm text-muted-foreground">Brak wyników moderacji.</p>
              ) : (
                <div className="space-y-3">
                  {order.moderationResults.map((m) => (
                    <div key={m.id} className="rounded-lg border border-border/60 p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{targetLabel(m.targetType)}</span>
                        <Badge variant={moderationVariant(m.status)}>{m.status}</Badge>
                      </div>
                      {m.categories.length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">Kategorie: {m.categories.join(", ")}</p>
                      )}
                      {m.reasons.length > 0 && (
                        <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                          {m.reasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        Pewność: {(m.confidence * 100).toFixed(0)}% · {formatDateTime(m.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Panel boczny: akcje + audyt + zgody */}
        <div className="space-y-6">
          <Card>
            <CardContent className="p-6">
              <h2 className="mb-4 font-display text-lg font-semibold">Akcje</h2>
              <AdminOrderActions orderId={order.id} status={order.status} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <h2 className="mb-4 font-display text-lg font-semibold">Log audytowy</h2>
              <ol className="space-y-3">
                {order.statusHistory.map((h) => (
                  <li key={h.id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />
                      <span className="font-medium">
                        {h.fromStatus ? `${STATUS_LABELS[h.fromStatus]} → ` : ""}
                        {STATUS_LABELS[h.toStatus]}
                      </span>
                    </div>
                    <p className="ml-4 text-xs text-muted-foreground">
                      {h.actor} · {formatDateTime(h.createdAt)}
                    </p>
                    {h.note && <p className="ml-4 text-xs text-muted-foreground">{h.note}</p>}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <h2 className="mb-4 font-display text-lg font-semibold">Zgody klienta</h2>
              <ul className="space-y-2 text-xs text-muted-foreground">
                {order.consents.map((c) => (
                  <li key={c.id} className="rounded border border-border/60 p-2">
                    <span className="font-medium text-foreground/80">{c.consentType}</span>
                    <p className="mt-0.5">{c.consentText}</p>
                    <p className="mt-1 opacity-70">
                      {formatDateTime(c.acceptedAt)} · IP: {c.ipAddress ?? "—"}
                    </p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words font-medium">{value}</dd>
    </div>
  );
}

function targetLabel(t: string): string {
  return t === "prompt" ? "Prompt" : t === "uploaded_image" ? "Zdjęcie" : "Wygenerowany projekt";
}

function moderationVariant(status: string): "success" | "destructive" | "warning" {
  if (status === "allowed") return "success";
  if (status === "rejected") return "destructive";
  return "warning";
}
