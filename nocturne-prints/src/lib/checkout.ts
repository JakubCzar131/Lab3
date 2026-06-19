import type { Order, Product } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getStripe, isStripeConfigured } from "@/lib/stripe";

/**
 * Tworzy sesje platnosci.
 *  - Jesli Stripe jest skonfigurowany: Stripe Checkout Session.
 *  - W przeciwnym razie (MVP/dev): zwraca lokalny "mock checkout" URL,
 *    ktory symuluje platnosc, by mozna bylo przejsc caly przeplyw bez kluczy.
 */
export async function createCheckoutSession(
  order: Order & { product: Product }
): Promise<{ url: string }> {
  if (!isStripeConfigured()) {
    return { url: `/api/checkout/mock?orderId=${order.id}` };
  }

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: order.email,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: order.currency,
          unit_amount: order.amountTotal,
          product_data: {
            name: `${order.product.name} — AI mystery print`,
            description: `${order.color} • rozmiar ${order.size} • styl ${order.selectedStyle}`,
          },
        },
      },
    ],
    metadata: { orderId: order.id },
    success_url: `${env.APP_URL}/zamowienie/${order.id}?paid=1`,
    cancel_url: `${env.APP_URL}/zamowienie/${order.id}?canceled=1`,
  });

  await prisma.order.update({
    where: { id: order.id },
    data: { stripeSessionId: session.id },
  });

  if (!session.url) throw new Error("Stripe nie zwrócił adresu sesji.");
  return { url: session.url };
}
