import { prisma } from "@/lib/db";
import { transitionOrder } from "@/lib/orders";
import { getQueue } from "@/lib/queue";
import { ensureWorkers } from "@/lib/workers";

/**
 * Oznacza zamowienie jako oplacone i URUCHAMIA pipeline moderacji.
 * Idempotentne: wielokrotne wywolanie (np. retry webhooka Stripe) nie psuje stanu.
 *
 * paid -> moderation_pending -> [kolejka: moderate_order]
 */
export async function markOrderPaid(
  orderId: string,
  opts: { actor?: string; paymentIntentId?: string | null } = {}
): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    console.warn(`[payments] markOrderPaid: brak zamowienia ${orderId}`);
    return;
  }

  // Idempotencja: jesli juz oplacone/za platnoscia, nie powtarzaj pipeline.
  if (order.status !== "pending_payment") {
    return;
  }

  await prisma.payment.upsert({
    where: { orderId },
    update: { status: "succeeded", stripePaymentIntentId: opts.paymentIntentId ?? undefined },
    create: {
      orderId,
      amount: order.amountTotal,
      currency: order.currency,
      status: "succeeded",
      stripePaymentIntentId: opts.paymentIntentId ?? undefined,
    },
  });

  await transitionOrder({ orderId, to: "paid", actor: opts.actor ?? "stripe", note: "Płatność potwierdzona." });
  await transitionOrder({ orderId, to: "moderation_pending", actor: "system" });

  // Uruchom pipeline moderacji (kolejka).
  ensureWorkers();
  await getQueue().enqueue("moderate_order", { orderId });
}
