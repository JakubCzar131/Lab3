import Link from "next/link";
import { BRAND, BRAND_LINES } from "@/lib/brand-copy";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border/60 bg-background/60">
      <div className="container grid gap-10 py-12 md:grid-cols-3">
        <div>
          <p className="font-display text-lg text-gradient">{BRAND.name}</p>
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">{BRAND_LINES[3]}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Link href="/katalog" className="text-muted-foreground hover:text-foreground">
            Katalog
          </Link>
          <Link href="/konfigurator" className="text-muted-foreground hover:text-foreground">
            Konfigurator
          </Link>
          <Link href="/#faq" className="text-muted-foreground hover:text-foreground">
            FAQ
          </Link>
          <Link href="/regulamin" className="text-muted-foreground hover:text-foreground">
            Regulamin
          </Link>
          <Link href="/zamowienie" className="text-muted-foreground hover:text-foreground">
            Status zamówienia
          </Link>
          <Link href="/admin" className="text-muted-foreground hover:text-foreground">
            Panel admina
          </Link>
        </div>
        <div className="text-sm text-muted-foreground">
          <p>Nie kopiujemy marek, postaci ani cudzych legend.</p>
          <p className="mt-2">Tworzymy Twoją.</p>
        </div>
      </div>
      <div className="border-t border-border/60 py-6">
        <p className="container text-xs text-muted-foreground">
          © {new Date().getFullYear()} {BRAND.name}. Wszystkie projekty są oryginalne i generowane na zamówienie.
        </p>
      </div>
    </footer>
  );
}
