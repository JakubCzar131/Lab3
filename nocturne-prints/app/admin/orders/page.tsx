import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminLogoutButton } from "@/components/forms/admin-logout-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { getAdminSession } from "@/lib/auth/session";
import { listOrdersForAdmin } from "@/modules/orders/service";

export const dynamic = "force-dynamic";

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

export default async function AdminOrdersPage() {
  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/login");
  }

  const orders = await listOrdersForAdmin();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold text-zinc-100">Panel admina</h1>
          <p className="text-zinc-300">Moderacja, produkcja, audyt.</p>
        </div>
        <AdminLogoutButton />
      </div>

      <div className="space-y-3">
        {orders.map((order) => (
          <Card key={order.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">{order.email}</CardTitle>
                <CardDescription className="mt-1">
                  {order.product.name} / {order.variant.colorName} / {order.size}
                </CardDescription>
                <p className="mt-1 text-xs text-zinc-500">{order.id}</p>
              </div>
              <Badge>{formatStatus(order.status)}</Badge>
            </div>
            <div className="mt-3">
              <Link href={`/admin/orders/${order.id}`} className="text-sm text-violet-300 hover:text-violet-200">
                Otwórz zamówienie →
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
