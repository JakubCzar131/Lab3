import { AuditActorType, OrderStatus } from "@prisma/client";
import { setOrderStatus } from "@/modules/orders/service";

const allowedManualTransitions: Partial<Record<OrderStatus, OrderStatus[]>> = {
  [OrderStatus.PAID]: [OrderStatus.MODERATION_PENDING, OrderStatus.NEEDS_MANUAL_REVIEW, OrderStatus.CANCELLED],
  [OrderStatus.MODERATION_PENDING]: [OrderStatus.NEEDS_MANUAL_REVIEW, OrderStatus.REJECTED, OrderStatus.GENERATION_PENDING],
  [OrderStatus.NEEDS_MANUAL_REVIEW]: [
    OrderStatus.GENERATION_PENDING,
    OrderStatus.REJECTED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.GENERATION_PENDING]: [OrderStatus.GENERATED, OrderStatus.NEEDS_MANUAL_REVIEW, OrderStatus.REJECTED],
  [OrderStatus.GENERATED]: [OrderStatus.PRODUCTION_READY, OrderStatus.NEEDS_MANUAL_REVIEW, OrderStatus.REJECTED],
  [OrderStatus.PRODUCTION_READY]: [OrderStatus.PRINTED, OrderStatus.CANCELLED],
  [OrderStatus.PRINTED]: [OrderStatus.SHIPPED],
};

export async function adminUpdateOrderStatus(input: {
  orderId: string;
  currentStatus: OrderStatus;
  nextStatus: OrderStatus;
  adminEmail: string;
  reason?: string;
}) {
  const transitions = allowedManualTransitions[input.currentStatus] ?? [];
  if (!transitions.includes(input.nextStatus)) {
    throw new Error(`Invalid status transition ${input.currentStatus} -> ${input.nextStatus}`);
  }

  return setOrderStatus({
    orderId: input.orderId,
    nextStatus: input.nextStatus,
    note: input.reason,
    rejectionReason: input.nextStatus === OrderStatus.REJECTED ? input.reason : undefined,
    actorType: AuditActorType.ADMIN,
    actorId: input.adminEmail,
  });
}
