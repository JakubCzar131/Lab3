import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { OrderStatusBadge } from "@/components/shop/order-status-badge";
import { formatDateTime, formatPrice, shortId } from "@/lib/utils";

export const metadata: Metadata = { title: "Zamówienia — panel" };
export const dynamic = "force-dynamic";

const FILTERS: { label: string; status?: OrderStatus }[] = [
  { label: "Wszystkie" },
  { label: "Weryfikacja ręczna", status: "needs_manual_review" },
  { label: "Moderacja", status: "moderation_pending" },
  { label: "Gotowe do druku", status: "production_ready" },
  { label: "Wydrukowane", status: "printed" },
  { label: "Wysłane", status: "shipped" },
  { label: "Odrzucone", status: "rejected" },
];

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/admin/login");

  const status = searchParams.status as OrderStatus | undefined;
  const orders = await prisma.order.findMany({
    where: status ? { status } : undefined,
    include: { product: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const reviewCount = await prisma.order.count({ where: { status: "needs_manual_review" } });

  return (
    <div className="container py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Zamówienia</h1>
          <p className="text-sm text-muted-foreground">
            {reviewCount > 0
              ? `${reviewCount} zamówień czeka na weryfikację ręczną.`
              : "Brak zamówień do ręcznej weryfikacji."}
          </p>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = (f.status ?? "") === (status ?? "");
          return (
            <Link
              key={f.label}
              href={f.status ? `/admin?status=${f.status}` : "/admin"}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                active ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border/60 text-left text-muted-foreground">
                <tr>
                  <th className="p-4 font-medium">Nr</th>
                  <th className="p-4 font-medium">E-mail</th>
                  <th className="p-4 font-medium">Produkt</th>
                  <th className="p-4 font-medium">Status</th>
                  <th className="p-4 font-medium">Kwota</th>
                  <th className="p-4 font-medium">Data</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">
                      Brak zamówień.
                    </td>
                  </tr>
                ) : (
                  orders.map((o) => (
                    <tr key={o.id} className="border-b border-border/40 transition-colors hover:bg-secondary/40">
                      <td className="p-4">
                        <Link href={`/admin/orders/${o.id}`} className="font-mono text-primary hover:underline">
                          #{shortId(o.id)}
                        </Link>
                      </td>
                      <td className="p-4 text-muted-foreground">{o.email}</td>
                      <td className="p-4">{o.product.name}</td>
                      <td className="p-4">
                        <OrderStatusBadge status={o.status} />
                      </td>
                      <td className="p-4">{formatPrice(o.amountTotal, o.currency)}</td>
                      <td className="p-4 text-muted-foreground">{formatDateTime(o.createdAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
