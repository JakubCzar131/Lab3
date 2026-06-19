import Link from "next/link";
import { Moon } from "lucide-react";
import { getSession } from "@/lib/auth";
import { logoutAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand-copy";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  return (
    <div className="min-h-screen">
      {session && (
        <header className="border-b border-border/60 bg-background/80 backdrop-blur-md">
          <div className="container flex h-14 items-center justify-between">
            <Link href="/admin" className="flex items-center gap-2">
              <Moon className="h-4 w-4 text-gold" aria-hidden />
              <span className="font-display text-sm tracking-wide">{BRAND.name} · Panel</span>
            </Link>
            <div className="flex items-center gap-4">
              <span className="hidden text-xs text-muted-foreground sm:inline">{session.email}</span>
              <form action={logoutAction}>
                <Button type="submit" variant="ghost" size="sm">
                  Wyloguj
                </Button>
              </form>
            </div>
          </div>
        </header>
      )}
      <main>{children}</main>
    </div>
  );
}
