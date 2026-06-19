import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { legalCopy } from "@/lib/legal-copy";
import { getOrderStatusPublic } from "@/modules/orders/service";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function statusLabel(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

export default async function OrderStatusPage(props: PageProps) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const order = await getOrderStatusPublic(id);
  if (!order) notFound();

  const isRejected = order.status === "REJECTED" || searchParams.rejected === "true";

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-zinc-100">Status zamówienia</h1>
        <p className="text-zinc-300">
          ID: <span className="font-mono text-zinc-200">{order.id}</span>
        </p>
      </header>

      <Card>
        <CardTitle>Aktualny status</CardTitle>
        <div className="mt-3">
          <Badge>{statusLabel(order.status)}</Badge>
        </div>
        <CardDescription className="mt-3">{legalCopy.noPreviewBeforePrint}</CardDescription>
      </Card>

      {isRejected ? (
        <Card className="border-red-900 bg-red-950/30">
          <CardTitle className="text-red-200">Zamówienie odrzucone</CardTitle>
          <CardDescription className="mt-2 text-red-100/90">
            {order.rejectionReason || legalCopy.rejectionMessage}
          </CardDescription>
        </Card>
      ) : null}

      <Card>
        <CardTitle>Historia statusów</CardTitle>
        <div className="mt-4 space-y-2 text-sm">
          {order.statusHistory.map((entry) => (
            <div key={entry.id} className="rounded-md border border-zinc-800 p-3">
              <p className="text-zinc-200">{statusLabel(entry.toStatus)}</p>
              <p className="text-xs text-zinc-400">{entry.createdAt.toLocaleString("pl-PL")}</p>
              {entry.note ? <p className="mt-1 text-zinc-300">{entry.note}</p> : null}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
