import Stripe from "stripe";
import { OrderStatus, PaymentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getOrderQueue } from "@/modules/orders/pipeline";
import { setOrderStatus } from "@/modules/orders/service";
import { getStripeClient } from "@/lib/stripe";

export async function POST(request: Request) {
  const stripe = getStripeClient();
  if (!stripe) {
    return new Response("Stripe not configured", { status: 200 });
  }

  const signature = request.headers.get("stripe-signature");
  const body = await request.text();

  let event: Stripe.Event;
  try {
    if (env.STRIPE_WEBHOOK_SECRET && signature) {
      event = stripe.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET);
    } else {
      event = JSON.parse(body) as Stripe.Event;
    }
  } catch (error) {
    return new Response(`Webhook error: ${(error as Error).message}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.orderId;
    if (!orderId) {
      return new Response("Missing orderId in metadata", { status: 400 });
    }

    const payment = await db.payment.findFirst({
      where: {
        OR: [{ stripeSessionId: session.id }, { orderId }],
      },
      orderBy: { createdAt: "desc" },
    });

    if (payment) {
      await db.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.PAID,
          stripePaymentIntent: typeof session.payment_intent === "string" ? session.payment_intent : null,
          rawJson: session as unknown as object,
        },
      });
    }

    await db.order.update({
      where: { id: orderId },
      data: {
        stripeSessionId: session.id,
        stripePaymentIntent: typeof session.payment_intent === "string" ? session.payment_intent : null,
      },
    });

    await setOrderStatus({
      orderId,
      nextStatus: OrderStatus.PAID,
      note: "Stripe checkout session completed.",
    });
    await setOrderStatus({
      orderId,
      nextStatus: OrderStatus.MODERATION_PENDING,
      note: "Queued automatic moderation pipeline.",
    });

    const queue = getOrderQueue();
    await queue.dispatch("order.moderate", { orderId });
  }

  return new Response("ok", { status: 200 });
}
