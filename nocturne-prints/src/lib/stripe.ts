import Stripe from "stripe";
import { env, isStripeConfigured } from "@/lib/env";

/**
 * Klient Stripe. Tworzony leniwie — jesli brak STRIPE_SECRET_KEY,
 * aplikacja dziala w trybie "mock checkout" (przydatne w MVP/dev bez kluczy).
 */
let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!isStripeConfigured()) {
    throw new Error("Stripe nie jest skonfigurowany (brak STRIPE_SECRET_KEY).");
  }
  if (!stripeClient) {
    stripeClient = new Stripe(env.STRIPE_SECRET_KEY as string, {
      // Uzywamy domyslnej wersji API przypietej do zainstalowanego SDK.
      typescript: true,
    });
  }
  return stripeClient;
}

export { isStripeConfigured };
