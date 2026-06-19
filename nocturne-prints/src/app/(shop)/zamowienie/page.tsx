import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const metadata: Metadata = { title: "Status zamówienia" };

async function goToOrder(formData: FormData) {
  "use server";
  const id = String(formData.get("orderId") ?? "").trim();
  if (id) redirect(`/zamowienie/${id}`);
}

export default function OrderLookupPage() {
  return (
    <div className="container flex max-w-md flex-col py-24">
      <h1 className="font-display text-3xl font-semibold text-gradient">Status zamówienia</h1>
      <p className="mt-2 text-muted-foreground">
        Podaj numer zamówienia z e-maila potwierdzającego.
      </p>
      <Card className="mt-8">
        <CardContent className="p-6">
          <form action={goToOrder} className="space-y-4">
            <div>
              <Label htmlFor="orderId">Numer zamówienia</Label>
              <Input id="orderId" name="orderId" placeholder="np. clxy123…" className="mt-1" required />
            </div>
            <Button type="submit" variant="gold" className="w-full">
              Sprawdź status
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
