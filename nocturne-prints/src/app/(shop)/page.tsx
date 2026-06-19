import Link from "next/link";
import { ShieldAlert, Sparkles, Upload, Wand2, Package, MoonStar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FaqAccordion } from "@/components/shop/faq";
import { HERO_COPY, HOW_IT_WORKS, SAFETY_SECTION, BRAND_LINES } from "@/lib/brand-copy";

const STEP_ICONS = [MoonStar, Upload, Wand2, Sparkles, Package];

export default function HomePage() {
  return (
    <>
      {/* HERO */}
      <section className="grain relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-portal-radial animate-pulse-aura" aria-hidden />
        <div className="container relative flex flex-col items-center py-24 text-center md:py-36">
          <Badge variant="gold" className="mb-6 animate-fade-in">
            AI mystery print • edycje jednorazowe
          </Badge>
          <h1 className="max-w-3xl font-display text-4xl font-bold leading-tight tracking-tight text-gradient md:text-6xl">
            {HERO_COPY.heading}
          </h1>
          <p className="mt-6 max-w-xl text-base text-muted-foreground md:text-lg">{HERO_COPY.lead}</p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" variant="gold">
              <Link href="/konfigurator">{HERO_COPY.cta}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="#jak-to-dziala">{HERO_COPY.ctaSecondary}</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* MANIFEST */}
      <section className="container py-12">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BRAND_LINES.map((line) => (
            <Card key={line} className="bg-card/50">
              <CardContent className="p-6">
                <p className="font-display text-sm leading-relaxed text-foreground/90">{line}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* JAK TO DZIALA */}
      <section id="jak-to-dziala" className="container scroll-mt-20 py-20">
        <div className="mb-12 text-center">
          <h2 className="font-display text-3xl font-semibold md:text-4xl">Jak przebiega rytuał</h2>
          <p className="mt-3 text-muted-foreground">
            Wybierz produkt → wrzuć zdjęcie → wpisz prompt → AI tworzy niespodziankę → drukujemy i wysyłamy.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-3 lg:grid-cols-5">
          {HOW_IT_WORKS.map((step, i) => {
            const Icon = STEP_ICONS[i] ?? Sparkles;
            return (
              <Card key={step.step} className="relative">
                <CardContent className="p-6">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <span className="font-display text-xs text-gold">Krok {step.step}</span>
                  <h3 className="mt-1 font-medium">{step.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* BEZPIECZENSTWO */}
      <section id="bezpieczenstwo" className="container scroll-mt-20 py-20">
        <Card className="border-destructive/30">
          <CardContent className="p-8 md:p-12">
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-6 w-6 text-destructive" aria-hidden />
              <h2 className="font-display text-2xl font-semibold md:text-3xl">{SAFETY_SECTION.heading}</h2>
            </div>
            <p className="mt-4 max-w-2xl text-muted-foreground">{SAFETY_SECTION.lead}</p>
            <ul className="mt-8 grid gap-3 sm:grid-cols-2">
              {SAFETY_SECTION.rules.map((rule) => (
                <li key={rule} className="flex items-start gap-2 text-sm">
                  <span className="mt-1 text-destructive" aria-hidden>
                    ✕
                  </span>
                  <span className="text-foreground/85">{rule}</span>
                </li>
              ))}
            </ul>
            <p className="mt-8 rounded-lg border border-border/60 bg-background/40 p-4 text-xs text-muted-foreground">
              {SAFETY_SECTION.disclaimer}
            </p>
          </CardContent>
        </Card>
      </section>

      {/* FAQ */}
      <section id="faq" className="container scroll-mt-20 py-20">
        <div className="mx-auto max-w-3xl">
          <h2 className="mb-8 text-center font-display text-3xl font-semibold md:text-4xl">FAQ</h2>
          <FaqAccordion />
        </div>
      </section>

      {/* CTA */}
      <section className="container py-20">
        <Card className="grain relative overflow-hidden text-center">
          <div className="pointer-events-none absolute inset-0 bg-portal-radial" aria-hidden />
          <CardContent className="relative p-12">
            <h2 className="font-display text-3xl font-semibold md:text-4xl">Gotów przywołać swój nadruk?</h2>
            <p className="mx-auto mt-3 max-w-md text-muted-foreground">
              Efekt pozostaje tajemnicą aż do otwarcia paczki.
            </p>
            <Button asChild size="lg" variant="gold" className="mt-8">
              <Link href="/konfigurator">{HERO_COPY.cta}</Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
