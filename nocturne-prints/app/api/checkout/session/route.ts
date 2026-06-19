import { z } from "zod";
import { OrderStatus, PaymentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { jsonError, jsonOk } from "@/lib/http";
import { getStripeClient } from "@/lib/stripe";

const bodySchema = z.object({
  orderId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = bodySchema.parse(body);
    const order = await db.order.findUnique({
      where: { id: payload.orderId },
      include: {
        orderItems: true,
        product: true,
        variant: true,
      },
    });

    if (!order) throw new Error("Order not found");
    if (!order.orderItems.length) throw new Error("Order has no items");
    if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.REJECTED) {
      throw new Error("Order cannot be paid in current status");
    }

    const amount = order.orderItems.reduce((acc, item) => acc + item.totalPrice, 0);
    const stripe = getStripeClient();
    if (!stripe) {
      return jsonOk(
        {
          checkoutUrl: `${env.NEXT_PUBLIC_APP_URL}/zamowienie/${order.id}`,
          warning: "Stripe is not configured. Using fallback status page.",
        },
        { status: 202 },
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: order.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: env.STRIPE_CURRENCY,
            product_data: {
              name: `${order.product.name} (${order.size}, ${order.color})`,
              description: `Style: ${order.selectedStyle}, transformacja: ${order.transformationLevel}`,
            },
            unit_amount: amount,
          },
        },
      ],
      metadata: {
        orderId: order.id,
      },
      success_url: `${env.NEXT_PUBLIC_APP_URL}/zamowienie/${order.id}?payment=success`,
      cancel_url: `${env.NEXT_PUBLIC_APP_URL}/zamowienie/${order.id}?payment=cancelled`,
    });

    await db.$transaction([
      db.order.update({
        where: { id: order.id },
        data: { stripeSessionId: session.id },
      }),
      db.payment.create({
        data: {
          orderId: order.id,
          stripeSessionId: session.id,
          amount,
          currency: env.STRIPE_CURRENCY,
          status: PaymentStatus.PENDING,
          rawJson: session as unknown as object,
        },
      }),
    ]);

    return jsonOk({
      checkoutUrl: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    return jsonError(error, "Could not create checkout session");
  }
}
