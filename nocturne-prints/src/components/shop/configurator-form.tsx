"use client";

import { useMemo, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Loader2, UploadCloud, Sparkles, ShieldAlert, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn, formatPrice } from "@/lib/utils";
import {
  DESIGN_STYLES,
  STYLE_LABELS,
  TRANSFORMATION_LABELS,
  TRANSFORMATION_LEVELS,
} from "@/lib/validation";
import { CONSENT_DEFINITIONS, LEGAL_COPY } from "@/lib/brand-copy";
import { createOrderAction, type CreateOrderState } from "@/app/actions/order";

export interface ConfiguratorVariant {
  id: string;
  color: string;
  colorHex: string;
  size: string;
  priceDiff: number;
}

export interface ConfiguratorProduct {
  id: string;
  slug: string;
  name: string;
  type: string;
  basePrice: number;
  mockupUrl: string | null;
  variants: ConfiguratorVariant[];
}

interface Props {
  products: ConfiguratorProduct[];
  initialSlug?: string;
}

const initialState: CreateOrderState = { ok: false };

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" variant="gold" className="w-full" disabled={disabled || pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
      {pending ? "Przywołuję…" : "Przywołaj nadruk"}
    </Button>
  );
}

export function ConfiguratorForm({ products, initialSlug }: Props) {
  const [state, formAction] = useFormState(createOrderAction, initialState);

  const initialProduct =
    products.find((p) => p.slug === initialSlug) ?? products[0];

  const [productId, setProductId] = useState(initialProduct?.id ?? "");
  const product = products.find((p) => p.id === productId) ?? initialProduct;

  const colors = useMemo(
    () => Array.from(new Map((product?.variants ?? []).map((v) => [v.color, v])).values()),
    [product]
  );
  const sizes = useMemo(
    () => Array.from(new Set((product?.variants ?? []).map((v) => v.size))),
    [product]
  );

  const [color, setColor] = useState(colors[0]?.color ?? "");
  const [size, setSize] = useState(sizes[0] ?? "");
  const [style, setStyle] = useState<string>(DESIGN_STYLES[0]);
  const [transformationLevel, setTransformationLevel] = useState<string>("medium");
  const [prompt, setPrompt] = useState("");
  const [email, setEmail] = useState("");

  // Upload state
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadAssetId, setUploadAssetId] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [faceDetected, setFaceDetected] = useState(false);
  const [uploadNeedsReview, setUploadNeedsReview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Consents
  const [consents, setConsents] = useState<Record<string, boolean>>({
    image_rights: false,
    mystery_no_preview: false,
    creative_variation: false,
    no_withdrawal_personalized: false,
    face_likeness: false,
  });

  const selectedVariant = (product?.variants ?? []).find(
    (v) => v.color === color && v.size === size
  );
  const price = product ? product.basePrice + (selectedVariant?.priceDiff ?? 0) : 0;

  function onProductChange(id: string) {
    setProductId(id);
    const next = products.find((p) => p.id === id);
    const nextColors = Array.from(new Map((next?.variants ?? []).map((v) => [v.color, v])).values());
    const nextSizes = Array.from(new Set((next?.variants ?? []).map((v) => v.size)));
    setColor(nextColors[0]?.color ?? "");
    setSize(nextSizes[0] ?? "");
  }

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    setUploadNeedsReview(false);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error ?? "Nie udało się przesłać zdjęcia.");
        setUploadAssetId("");
        setPreviewUrl("");
        return;
      }
      setUploadAssetId(data.assetId);
      setPreviewUrl(data.previewUrl);
      setFaceDetected(Boolean(data.faceDetected));
      setUploadNeedsReview(Boolean(data.needsReview));
    } catch {
      setUploadError("Błąd sieci podczas uploadu.");
    } finally {
      setUploading(false);
    }
  }

  const requiredConsents = CONSENT_DEFINITIONS.filter((c) => c.required);
  const allRequiredChecked = requiredConsents.every((c) => consents[c.type]);
  const faceConsentOk = !faceDetected || consents.face_likeness;
  const canSubmit =
    Boolean(uploadAssetId) &&
    prompt.trim().length >= 3 &&
    Boolean(email) &&
    Boolean(selectedVariant) &&
    allRequiredChecked &&
    faceConsentOk &&
    !uploading;

  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="grid gap-8 lg:grid-cols-[1fr_360px]">
      {/* Hidden serialized fields */}
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="variantId" value={selectedVariant?.id ?? ""} />
      <input type="hidden" name="color" value={color} />
      <input type="hidden" name="size" value={size} />
      <input type="hidden" name="selectedStyle" value={style} />
      <input type="hidden" name="transformationLevel" value={transformationLevel} />
      <input type="hidden" name="uploadAssetId" value={uploadAssetId} />
      {Object.entries(consents).map(([k, v]) => (
        <input key={k} type="hidden" name={consentFieldName(k)} value={v ? "true" : "false"} />
      ))}

      <div className="space-y-8">
        {/* 1. Produkt */}
        <section>
          <SectionTitle index={1} title="Wybierz nośnik" />
          <div className="grid gap-4 sm:grid-cols-2">
            {products.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => onProductChange(p.id)}
                aria-pressed={p.id === productId}
                className={cn(
                  "rounded-xl border p-4 text-left transition-colors",
                  p.id === productId
                    ? "border-primary glow-ring bg-primary/5"
                    : "border-border hover:border-primary/50"
                )}
              >
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.mockupUrl ?? "/mockups/tshirt.svg"} alt="" className="h-16 w-16 rounded-md object-cover" />
                  <div>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-sm text-muted-foreground">{formatPrice(p.basePrice)}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* 2. Kolor */}
        <section>
          <SectionTitle index={2} title="Kolor" />
          <div className="flex flex-wrap gap-3">
            {colors.map((v) => (
              <button
                type="button"
                key={v.color}
                onClick={() => setColor(v.color)}
                aria-pressed={v.color === color}
                aria-label={`Kolor ${v.color}`}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
                  v.color === color ? "border-primary text-foreground" : "border-border text-muted-foreground"
                )}
              >
                <span className="h-4 w-4 rounded-full border border-border" style={{ backgroundColor: v.colorHex }} />
                {v.color}
              </button>
            ))}
          </div>
        </section>

        {/* 3. Rozmiar */}
        <section>
          <SectionTitle index={3} title="Rozmiar" />
          <div className="flex flex-wrap gap-2">
            {sizes.map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => setSize(s)}
                aria-pressed={s === size}
                className={cn(
                  "h-10 w-12 rounded-md border text-sm font-medium transition-colors",
                  s === size ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:border-primary/50"
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </section>

        {/* 4. Upload */}
        <section>
          <SectionTitle index={4} title="Wrzuć zdjęcie" />
          <Alert variant="warning" className="mb-4">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>{LEGAL_COPY.uploadWarning.title}</AlertTitle>
            <AlertDescription>{LEGAL_COPY.uploadWarning.body}</AlertDescription>
          </Alert>

          <div
            className={cn(
              "flex flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center",
              uploadError ? "border-destructive/60" : "border-border"
            )}
          >
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="Podgląd przesłanego zdjęcia" className="mb-4 h-40 w-40 rounded-lg object-cover" />
            ) : (
              <UploadCloud className="mb-3 h-10 w-10 text-muted-foreground" aria-hidden />
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
              }}
            />
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="animate-spin" /> : <UploadCloud />}
              {previewUrl ? "Zmień zdjęcie" : "Wybierz plik (JPEG/PNG/WEBP)"}
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">Usuwamy metadane EXIF automatycznie.</p>
          </div>

          {uploadError && (
            <Alert variant="destructive" className="mt-4">
              <ImageOff className="h-4 w-4" />
              <AlertTitle>Zdjęcie odrzucone</AlertTitle>
              <AlertDescription>{uploadError}</AlertDescription>
            </Alert>
          )}
          {uploadNeedsReview && !uploadError && (
            <Alert variant="warning" className="mt-4">
              <ShieldAlert className="h-4 w-4" />
              <AlertDescription>
                Zdjęcie zostanie poddane dodatkowej weryfikacji po złożeniu zamówienia.
              </AlertDescription>
            </Alert>
          )}
          {fe.uploadAssetId && <FieldError messages={fe.uploadAssetId} />}
        </section>

        {/* 5. Prompt */}
        <section>
          <SectionTitle index={5} title="Podaj intencję (prompt)" />
          <Textarea
            name="customerPrompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={600}
            placeholder="Opisz nastrój i symbolikę, którą chcesz przywołać. Bez marek, postaci i celebrytów."
            aria-label="Prompt"
          />
          <div className="mt-1 flex justify-between text-xs text-muted-foreground">
            <span>Min. 3 znaki. Nie kopiujemy marek ani cudzych postaci.</span>
            <span>{prompt.length}/600</span>
          </div>
          {fe.customerPrompt && <FieldError messages={fe.customerPrompt} />}
        </section>

        {/* 6. Styl */}
        <section>
          <SectionTitle index={6} title="Styl" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {DESIGN_STYLES.map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => setStyle(s)}
                aria-pressed={s === style}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm transition-colors",
                  s === style ? "border-primary bg-primary/10" : "border-border text-muted-foreground hover:border-primary/50"
                )}
              >
                {STYLE_LABELS[s]}
              </button>
            ))}
          </div>
        </section>

        {/* 7. Poziom transformacji */}
        <section>
          <SectionTitle index={7} title="Poziom transformacji" />
          <RadioGroup
            value={transformationLevel}
            onValueChange={setTransformationLevel}
            className="grid grid-cols-1 gap-2 sm:grid-cols-3"
          >
            {TRANSFORMATION_LEVELS.map((lvl) => (
              <label
                key={lvl}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm",
                  transformationLevel === lvl ? "border-primary bg-primary/10" : "border-border"
                )}
              >
                <RadioGroupItem value={lvl} id={`tl-${lvl}`} />
                {TRANSFORMATION_LABELS[lvl]}
              </label>
            ))}
          </RadioGroup>
        </section>

        {/* 8. Zgody prawne */}
        <section>
          <SectionTitle index={8} title="Zgody" />
          <div className="space-y-4">
            {CONSENT_DEFINITIONS.filter((c) => c.required).map((c) => (
              <ConsentRow
                key={c.type}
                id={c.type}
                text={c.text}
                checked={consents[c.type]}
                onChange={(v) => setConsents((prev) => ({ ...prev, [c.type]: v }))}
              />
            ))}

            {/* Zgoda na wizerunek — pokazywana, gdy wykryto twarz */}
            {faceDetected && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                <ConsentRow
                  id="face_likeness"
                  text={CONSENT_DEFINITIONS.find((c) => c.type === "face_likeness")!.text}
                  checked={consents.face_likeness}
                  onChange={(v) => setConsents((prev) => ({ ...prev, face_likeness: v }))}
                  highlight
                />
                {fe.consentFaceLikeness && <FieldError messages={fe.consentFaceLikeness} />}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* PODSUMOWANIE (sticky) */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <Card>
          <CardContent className="space-y-4 p-6">
            <h3 className="font-display text-lg font-semibold">Podsumowanie</h3>
            <dl className="space-y-1.5 text-sm">
              <Row label="Produkt" value={product?.name ?? "—"} />
              <Row label="Kolor" value={color || "—"} />
              <Row label="Rozmiar" value={size || "—"} />
              <Row label="Styl" value={STYLE_LABELS[style as (typeof DESIGN_STYLES)[number]] ?? style} />
              <Row label="Transformacja" value={TRANSFORMATION_LABELS[transformationLevel as (typeof TRANSFORMATION_LEVELS)[number]]} />
            </dl>

            <div>
              <Label htmlFor="email">E-mail (status zamówienia)</Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ty@example.com"
                className="mt-1"
                required
              />
              {fe.email && <FieldError messages={fe.email} />}
            </div>

            <div className="flex items-center justify-between border-t border-border/60 pt-4">
              <span className="text-sm text-muted-foreground">Razem</span>
              <span className="font-display text-xl text-gold">{formatPrice(price)}</span>
            </div>

            {!faceConsentOk && (
              <p className="text-xs text-amber-400">
                Wykryto twarz — zaznacz zgodę na wykorzystanie wizerunku.
              </p>
            )}
            {state.error && (
              <Alert variant="destructive">
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}

            <SubmitButton disabled={!canSubmit} />
            <p className="text-center text-xs text-muted-foreground">
              {LEGAL_COPY.noPreview.body}
            </p>
          </CardContent>
        </Card>
      </aside>
    </form>
  );
}

function consentFieldName(type: string): string {
  const map: Record<string, string> = {
    image_rights: "consentImageRights",
    mystery_no_preview: "consentMysteryNoPreview",
    creative_variation: "consentCreativeVariation",
    no_withdrawal_personalized: "consentNoWithdrawal",
    face_likeness: "consentFaceLikeness",
  };
  return map[type] ?? type;
}

function SectionTitle({ index, title }: { index: number; title: string }) {
  return (
    <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold">
      <Badge variant="gold">{index}</Badge>
      {title}
    </h2>
  );
}

function ConsentRow({
  id,
  text,
  checked,
  onChange,
  highlight,
}: {
  id: string;
  text: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  highlight?: boolean;
}) {
  return (
    <label htmlFor={`consent-${id}`} className="flex cursor-pointer items-start gap-3">
      <Checkbox
        id={`consent-${id}`}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <span className={cn("text-sm leading-relaxed", highlight ? "text-amber-200" : "text-foreground/85")}>
        {text}
      </span>
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function FieldError({ messages }: { messages: string[] }) {
  return (
    <p role="alert" className="mt-1 text-xs text-destructive">
      {messages.join(" ")}
    </p>
  );
}
