import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EyeOff, PackageCheck } from "lucide-react";
import { prisma } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { OrderStatusBadge } from "@/components/shop/order-status-badge";
import { STATUS_CUSTOMER_MESSAGE, STATUS_LABELS } from "@/lib/orders";
import { LEGAL_COPY } from "@/lib/brand-copy";
import { formatDateTime, formatPrice, shortId } from "@/lib/utils";
import { STYLE_LABELS, TRANSFORMATION_LABELS } from "@/lib/validation";

export const metadata: Metadata = { title: "Status zamówienia" };
export const dynamic = "force-dynamic";

export default async function OrderStatusPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { paid?: string; mock?: string };
}) {
  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: {
      product: true,
      statusHistory: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!order) notFound();

  const isRejected = order.status === "rejected";
  const isShipped = order.status === "shipped";

  return (
    <div className="container max-w-2xl py-16">
      {searchParams.paid && (
        <Alert variant="info" className="mb-6">
          <PackageCheck className="h-4 w-4" />
          <AlertTitle>Płatność przyjęta</AlertTitle>
          <AlertDescription>
            {searchParams.mock ? "(Tryb demonstracyjny — symulacja płatności.) " : ""}
            Rozpoczęliśmy rytuał. Status śledzisz poniżej.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Zamówienie</p>
          <h1 className="font-display text-2xl font-semibold">#{shortId(order.id)}</h1>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      <Card className="mt-6">
        <CardContent className="space-y-4 p-6">
          <p className="text-foreground/90">{STATUS_CUSTOMER_MESSAGE[order.status]}</p>

          {!isShipped && !isRejected && (
            <Alert variant="default" className="border-primary/30">
              <EyeOff className="h-4 w-4 text-primary" />
              <AlertTitle>To niespodzianka</AlertTitle>
              <AlertDescription>{LEGAL_COPY.noPreview.body}</AlertDescription>
            </Alert>
          )}

          {isRejected && (
            <Alert variant="destructive">
              <AlertTitle>{LEGAL_COPY.rejectionNotice.title}</AlertTitle>
              <AlertDescription>
                {LEGAL_COPY.rejectionNotice.body}
                {order.rejectionReason ? (
                  <span className="mt-2 block text-xs opacity-80">Powód: {order.rejectionReason}</span>
                ) : null}
              </AlertDescription>
            </Alert>
          )}

          <Separator />

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Item label="Produkt" value={order.product.name} />
            <Item label="Kolor / rozmiar" value={`${order.color} / ${order.size}`} />
            <Item label="Styl" value={STYLE_LABELS[order.selectedStyle]} />
            <Item label="Transformacja" value={TRANSFORMATION_LABELS[order.transformationLevel]} />
            <Item label="Kwota" value={formatPrice(order.amountTotal, order.currency)} />
            <Item label="Złożono" value={formatDateTime(order.createdAt)} />
          </dl>
        </CardContent>
      </Card>

      {/* Oś czasu statusów (bez ujawniania projektu) */}
      <Card className="mt-6">
        <CardContent className="p-6">
          <h2 className="mb-4 font-display text-lg font-semibold">Historia statusów</h2>
          <ol className="space-y-3">
            {order.statusHistory.map((h) => (
              <li key={h.id} className="flex items-start gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
                <div>
                  <p className="text-sm font-medium">{STATUS_LABELS[h.toStatus]}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(h.createdAt)}</p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
