import type { OrderStatus } from "@prisma/client";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { STATUS_LABELS } from "@/lib/orders";

const VARIANT_BY_STATUS: Record<OrderStatus, BadgeProps["variant"]> = {
  pending_payment: "warning",
  paid: "default",
  moderation_pending: "default",
  needs_manual_review: "warning",
  rejected: "destructive",
  generation_pending: "default",
  generated: "default",
  production_ready: "gold",
  printed: "gold",
  shipped: "success",
  cancelled: "secondary",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge variant={VARIANT_BY_STATUS[status]}>{STATUS_LABELS[status]}</Badge>;
}
