"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const actions = [
  { value: "GENERATION_PENDING", label: "Zaakceptuj ręcznie / wygeneruj ponownie" },
  { value: "REJECTED", label: "Odrzuć zamówienie" },
  { value: "PRODUCTION_READY", label: "Oznacz jako gotowe do druku" },
  { value: "PRINTED", label: "Oznacz jako wydrukowane" },
  { value: "SHIPPED", label: "Oznacz jako wysłane" },
];

export function AdminOrderStatusActions({ orderId }: Readonly<{ orderId: string }>) {
  const [nextStatus, setNextStatus] = useState("GENERATION_PENDING");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/orders/${orderId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nextStatus,
          reason: reason || undefined,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Nie udało się zaktualizować statusu.");
      window.location.reload();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Błąd");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div>
        <Label htmlFor="action">Akcja</Label>
        <Select id="action" value={nextStatus} onChange={(event) => setNextStatus(event.target.value)}>
          {actions.map((action) => (
            <option key={action.value} value={action.value}>
              {action.label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="reason">Powód (wymagany dla odrzucenia)</Label>
        <Input id="reason" value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      <Button type="submit" disabled={loading}>
        {loading ? "Zapisywanie..." : "Wykonaj"}
      </Button>
    </form>
  );
}
