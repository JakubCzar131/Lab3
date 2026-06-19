import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { LEGAL_COPY, SAFETY_SECTION } from "@/lib/brand-copy";

export const metadata: Metadata = { title: "Zasady i informacje" };

export default function TermsPage() {
  const sections = Object.values(LEGAL_COPY);
  return (
    <div className="container max-w-3xl py-16">
      <h1 className="font-display text-4xl font-semibold text-gradient">Zasady i informacje</h1>
      <p className="mt-3 text-muted-foreground">
        Mroczny klimat, jasne reguły. Poniżej najważniejsze informacje o usłudze.
      </p>

      <div className="mt-10 space-y-5">
        {sections.map((s) => (
          <Card key={s.title}>
            <CardContent className="p-6">
              <h2 className="font-display text-lg font-semibold">{s.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </CardContent>
          </Card>
        ))}

        <Card className="border-destructive/30">
          <CardContent className="p-6">
            <h2 className="font-display text-lg font-semibold">{SAFETY_SECTION.heading}</h2>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {SAFETY_SECTION.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted-foreground">{SAFETY_SECTION.disclaimer}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
