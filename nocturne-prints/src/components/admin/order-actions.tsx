"use client";

import { useFormState, useFormStatus } from "react-dom";
import type { OrderStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { updateOrderStatusAction, type UpdateStatusState } from "@/app/admin/actions";

const initial: UpdateStatusState = {};

function ActionButton({
  action,
  label,
  variant = "secondary",
}: {
  action: string;
  label: string;
  variant?: "secondary" | "gold" | "destructive" | "outline" | "default";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" name="action" value={action} variant={variant} size="sm" disabled={pending}>
      {label}
    </Button>
  );
}

export function AdminOrderActions({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const [state, action] = useFormState(updateOrderStatusAction, initial);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="orderId" value={orderId} />

      <div>
        <Label htmlFor="reason" className="text-xs text-muted-foreground">
          Powód (dla odrzucenia / anulowania)
        </Label>
        <Textarea id="reason" name="reason" rows={2} className="mt-1" placeholder="Opcjonalny powód…" />
      </div>

      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.ok && (
        <Alert variant="info">
          <AlertDescription>Status zaktualizowany.</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <ActionButton action="approve_manual" label="Zaakceptuj ręcznie" variant="gold" />
        <ActionButton action="reject" label="Odrzuć" variant="destructive" />
        <ActionButton action="regenerate" label="Wygeneruj ponownie" variant="secondary" />
        <ActionButton action="mark_production_ready" label="Gotowe do druku" variant="secondary" />
        <ActionButton action="mark_printed" label="Oznacz: wydrukowane" variant="secondary" />
        <ActionButton action="mark_shipped" label="Oznacz: wysłane" variant="secondary" />
        <ActionButton action="cancel" label="Anuluj" variant="outline" />
      </div>
      <p className="text-xs text-muted-foreground">Bieżący status: {status}</p>
    </form>
  );
}
