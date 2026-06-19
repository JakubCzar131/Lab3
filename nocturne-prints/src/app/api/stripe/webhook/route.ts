import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { env } from "@/lib/env";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { markOrderPaid } from "@/lib/payments";

export const runtime = "nodejs";

/**
 * Webhook Stripe.
 *
 * Bezpieczenstwo:
 *  - weryfikujemy podpis (STRIPE_WEBHOOK_SECRET) na surowym body,
 *  - uznajemy platnosc dopiero po zdarzeniu checkout.session.completed,
 *  - markOrderPaid jest idempotentne (Stripe potrafi powtarzac zdarzenia).
 */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured() || !env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Stripe nie jest skonfigurowany." }, { status: 503 });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Brak podpisu." }, { status: 400 });

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[stripe/webhook] niepoprawny podpis", err);
    return NextResponse.json({ error: "Niepoprawny podpis." }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;
      if (orderId) {
        await markOrderPaid(orderId, {
          actor: "stripe",
          paymentIntentId:
            typeof session.payment_intent === "string" ? session.payment_intent : null,
        });
      }
    }
  } catch (err) {
    console.error("[stripe/webhook] blad obslugi zdarzenia", err);
    return NextResponse.json({ error: "Błąd obsługi zdarzenia." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
