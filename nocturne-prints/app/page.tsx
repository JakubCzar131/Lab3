import Link from "next/link";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { faqEntries, legalCopy } from "@/lib/legal-copy";

export default function Home() {
  return (
    <div className="space-y-12 pb-8">
      <section className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-950 to-violet-950/40 px-6 py-14">
        <p className="mb-4 text-xs uppercase tracking-[0.28em] text-zinc-400">Nocturne Prints</p>
        <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-zinc-100 md:text-5xl">
          Nie wybierasz nadruku. <span className="text-violet-300">Przywołujesz go.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-zinc-300">
          Wrzucasz zdjęcie. Podajesz intencję. Resztę robi algorytm. Każdy nadruk jest jednorazowym rytuałem.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/konfigurator">
            <Button size="lg">Przywołaj nadruk</Button>
          </Link>
          <Link href="/katalog">
            <Button size="lg" variant="outline">
              Zobacz katalog
            </Button>
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-5">
        {[
          "Wybierz produkt",
          "Wgraj zdjęcie",
          "Opisz intencję",
          "AI tworzy niespodziankę",
          "Druk i wysyłka",
        ].map((step, index) => (
          <Card key={step}>
            <CardTitle className="mb-2 text-base text-zinc-100">
              {index + 1}. {step}
            </CardTitle>
            <CardDescription>
              {index === 3
                ? "Finalny projekt pozostaje tajemnicą aż do otwarcia paczki."
                : "Każdy etap jest monitorowany i objęty kontrolą bezpieczeństwa treści."}
            </CardDescription>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle>Zasady bezpieczeństwa</CardTitle>
          <CardDescription className="mt-3 space-y-2">
            <span className="block">Nie kopiujemy marek, postaci ani cudzych legend. Tworzymy Twoją.</span>
            <span className="block">{legalCopy.uploadWarning}</span>
          </CardDescription>
        </Card>
        <Card>
          <CardTitle>Jasne reguły prawne</CardTitle>
          <CardDescription className="mt-3 space-y-2">
            <span className="block">{legalCopy.noPreviewBeforePrint}</span>
            <span className="block">{legalCopy.noReturnChangeOfMind}</span>
            <span className="block">{legalCopy.complaintRight}</span>
          </CardDescription>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {faqEntries.map((entry) => (
          <Card key={entry.question}>
            <CardTitle className="text-base">{entry.question}</CardTitle>
            <CardDescription className="mt-2">{entry.answer}</CardDescription>
          </Card>
        ))}
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-6">
        <h2 className="text-xl font-semibold text-zinc-100">Alternatywne nazwy marki (klimat premium/mroczny)</h2>
        <ul className="mt-3 grid list-disc gap-1 pl-5 text-zinc-300 md:grid-cols-2">
          <li>Velvet Abyss Atelier</li>
          <li>Obsidian Ritual Wear</li>
          <li>Eidolon Ink House</li>
          <li>Noir Sigil Studio</li>
          <li>Umbral Cipher Prints</li>
        </ul>
      </section>
    </div>
  );
}
