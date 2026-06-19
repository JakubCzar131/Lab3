import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { isStripeConfigured } from "@/lib/stripe";
import { markOrderPaid } from "@/lib/payments";

export const runtime = "nodejs";

/**
 * MOCK checkout — TYLKO gdy Stripe nie jest skonfigurowany (dev/MVP).
 *
 * Symuluje udana platnosc i uruchamia pipeline moderacji, by mozna bylo
 * przejsc caly przeplyw bez kluczy Stripe. W produkcji (z kluczami) ten route
 * jest wylaczony i platnosci obsluguje webhook Stripe.
 */
export async function GET(req: NextRequest) {
  if (isStripeConfigured()) {
    return NextResponse.json(
      { error: "Mock checkout jest wyłączony, gdy Stripe jest skonfigurowany." },
      { status: 403 }
    );
  }

  const orderId = req.nextUrl.searchParams.get("orderId");
  if (!orderId) {
    return NextResponse.json({ error: "Brak orderId." }, { status: 400 });
  }

  await markOrderPaid(orderId, { actor: "mock-checkout" });

  return NextResponse.redirect(new URL(`/zamowienie/${orderId}?paid=1&mock=1`, env.APP_URL));
}
