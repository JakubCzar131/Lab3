import Link from "next/link";
import { Badge } from "@/components/ui/badge";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
        <Link href="/" className="flex items-center gap-2 text-zinc-100">
          <span className="inline-block h-2 w-2 rounded-full bg-violet-400" />
          <span className="font-semibold tracking-wide">Nocturne Prints</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm text-zinc-300">
          <Link href="/katalog" className="hover:text-zinc-100">
            Katalog
          </Link>
          <Link href="/konfigurator" className="hover:text-zinc-100">
            Konfigurator
          </Link>
          <Link href="/admin/orders" className="hover:text-zinc-100">
            Admin
          </Link>
          <Badge className="border-amber-700/50 bg-amber-950/40 text-amber-300">mystery mode</Badge>
        </nav>
      </div>
    </header>
  );
}
