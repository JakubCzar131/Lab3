import { headers } from "next/headers";
import { jsonError, jsonOk } from "@/lib/http";
import { createOrderSchema } from "@/lib/validation/schemas";
import { createOrderWithPromptModeration } from "@/modules/orders/service";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = createOrderSchema.parse(body);
    const headerList = await headers();

    const result = await createOrderWithPromptModeration(payload, {
      ipAddress: headerList.get("x-forwarded-for") ?? undefined,
      userAgent: headerList.get("user-agent") ?? undefined,
    });

    if (!result.order) {
      return jsonOk(
        {
          accepted: false,
          moderation: result.promptModeration,
          error: result.error,
        },
        { status: 422 },
      );
    }

    return jsonOk({
      accepted: true,
      orderId: result.order.id,
      status: result.order.status,
      moderation: result.promptModeration,
    });
  } catch (error) {
    return jsonError(error, "Could not create order");
  }
}
