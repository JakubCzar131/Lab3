import { OrderStatus } from "@prisma/client";
import { getAdminSession } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/http";
import { adminUpdateOrderStatusSchema } from "@/lib/validation/schemas";
import { getOrderQueue } from "@/modules/orders/pipeline";
import { adminUpdateOrderStatus } from "@/modules/admin/service";
import { getOrderForAdmin } from "@/modules/orders/service";

type Context = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: Context) {
  try {
    const admin = await getAdminSession();
    if (!admin) {
      return jsonOk({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await request.json();
    const payload = adminUpdateOrderStatusSchema.parse(body);

    const order = await getOrderForAdmin(id);
    if (!order) throw new Error("Order not found");
    if (payload.nextStatus === "REJECTED" && !payload.reason) {
      throw new Error("Reason is required when rejecting an order");
    }

    const updated = await adminUpdateOrderStatus({
      orderId: id,
      currentStatus: order.status,
      nextStatus: OrderStatus[payload.nextStatus],
      adminEmail: admin.email,
      reason: payload.reason,
    });

    if (payload.nextStatus === "GENERATION_PENDING") {
      const queue = getOrderQueue();
      await queue.dispatch("order.generate", { orderId: id });
    }

    return jsonOk({ orderId: updated.id, status: updated.status });
  } catch (error) {
    return jsonError(error, "Could not update order status");
  }
}
