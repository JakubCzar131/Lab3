import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Moon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getSession } from "@/lib/auth";
import { BRAND } from "@/lib/brand-copy";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Logowanie — panel" };
export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  const session = await getSession();
  if (session) redirect("/admin");

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2">
          <Moon className="h-6 w-6 text-gold" aria-hidden />
          <span className="font-display text-xl text-gradient">{BRAND.name}</span>
        </div>
        <Card>
          <CardContent className="p-6">
            <h1 className="mb-1 font-display text-lg font-semibold">Panel produkcji</h1>
            <p className="mb-6 text-sm text-muted-foreground">Dostęp tylko dla obsługi.</p>
            <LoginForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
