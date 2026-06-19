"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { STYLE_OPTIONS, TRANSFORMATION_LEVELS } from "@/modules/catalog/options";

type CatalogVariant = {
  id: string;
  colorName: string;
  availableSizes: string[];
};

type CatalogProduct = {
  id: string;
  name: string;
  description: string;
  variants: CatalogVariant[];
};

type Props = {
  products: CatalogProduct[];
};

export function OrderConfiguratorForm({ products }: Props) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [variantId, setVariantId] = useState(products[0]?.variants[0]?.id ?? "");
  const [size, setSize] = useState(products[0]?.variants[0]?.availableSizes[0] ?? "");
  const [email, setEmail] = useState("");
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<(typeof STYLE_OPTIONS)[number]>("dark_fantasy");
  const [transformationLevel, setTransformationLevel] =
    useState<(typeof TRANSFORMATION_LEVELS)[number]>("sredni");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [fullName, setFullName] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("PL");
  const [phone, setPhone] = useState("");

  const [rightsToImage, setRightsToImage] = useState(false);
  const [mysteryNoPreview, setMysteryNoPreview] = useState(false);
  const [creativeVariance, setCreativeVariance] = useState(false);
  const [noReturnChangeOfMind, setNoReturnChangeOfMind] = useState(false);
  const [faceConsent, setFaceConsent] = useState(false);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === productId) ?? products[0],
    [productId, products],
  );
  const selectedVariant = useMemo(
    () => selectedProduct?.variants.find((variant) => variant.id === variantId) ?? selectedProduct?.variants[0],
    [selectedProduct, variantId],
  );
  const selectedColor = selectedVariant?.colorName ?? "";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!selectedProduct || !selectedVariant) {
      setError("Wybierz produkt i wariant.");
      return;
    }
    if (!imageFile) {
      setError("Dodaj zdjęcie.");
      return;
    }

    setLoading(true);
    try {
      const createOrderResponse = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          productId: selectedProduct.id,
          variantId: selectedVariant.id,
          size,
          color: selectedColor,
          customerPrompt: prompt,
          selectedStyle: style,
          transformationLevel,
          consents: {
            rightsToImage,
            mysteryNoPreview,
            creativeVariance,
            noReturnChangeOfMind,
            faceConsent,
          },
          shippingInfo: {
            fullName,
            line1,
            line2,
            city,
            postalCode,
            country: country.toUpperCase(),
            phone,
          },
        }),
      });

      const createOrderPayload = (await createOrderResponse.json()) as {
        accepted: boolean;
        orderId?: string;
        error?: string;
      };
      if (!createOrderResponse.ok || !createOrderPayload.accepted || !createOrderPayload.orderId) {
        throw new Error(createOrderPayload.error ?? "Nie udało się utworzyć zamówienia.");
      }

      const uploadFormData = new FormData();
      uploadFormData.set("orderId", createOrderPayload.orderId);
      uploadFormData.set("file", imageFile);
      uploadFormData.set("faceConsent", String(faceConsent));

      const uploadResponse = await fetch("/api/upload", {
        method: "POST",
        body: uploadFormData,
      });
      const uploadPayload = (await uploadResponse.json()) as { moderation?: { status: string }; error?: string };

      if (!uploadResponse.ok) {
        throw new Error(uploadPayload.error ?? "Nie udało się przesłać zdjęcia.");
      }
      if (uploadPayload.moderation?.status === "rejected") {
        window.location.href = `/zamowienie/${createOrderPayload.orderId}?rejected=true`;
        return;
      }

      const checkoutResponse = await fetch("/api/checkout/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: createOrderPayload.orderId }),
      });
      const checkoutPayload = (await checkoutResponse.json()) as { checkoutUrl?: string; error?: string };
      if (!checkoutResponse.ok || !checkoutPayload.checkoutUrl) {
        throw new Error(checkoutPayload.error ?? "Nie udało się rozpocząć płatności.");
      }

      window.location.href = checkoutPayload.checkoutUrl;
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Wystąpił błąd.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardTitle>Konfigurator mystery print</CardTitle>
      <CardDescription className="mt-2">
        Produkt personalizowany — finalny projekt pozostaje tajemnicą do czasu dostawy.
      </CardDescription>

      <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="product">Produkt</Label>
            <Select
              id="product"
              value={productId}
              onChange={(event) => {
                const nextProductId = event.target.value;
                const nextProduct = products.find((product) => product.id === nextProductId);
                setProductId(nextProductId);
                if (!nextProduct?.variants[0]) return;
                setVariantId(nextProduct.variants[0].id);
                setSize(nextProduct.variants[0].availableSizes[0] ?? "");
              }}
              required
              aria-label="Wybierz produkt"
            >
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="variant">Kolor</Label>
            <Select
              id="variant"
              value={variantId}
              onChange={(event) => {
                const nextVariantId = event.target.value;
                setVariantId(nextVariantId);
                const nextVariant = selectedProduct?.variants.find((variant) => variant.id === nextVariantId);
                if (nextVariant?.availableSizes[0]) {
                  setSize(nextVariant.availableSizes[0]);
                }
              }}
              required
              aria-label="Wybierz kolor"
            >
              {selectedProduct?.variants.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.colorName}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="size">Rozmiar</Label>
            <Select id="size" value={size} onChange={(event) => setSize(event.target.value)} required>
              {selectedVariant?.availableSizes.map((availableSize) => (
                <option key={availableSize} value={availableSize}>
                  {availableSize}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              aria-label="Email klienta"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="file">Upload zdjęcia</Label>
          <Input
            id="file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
            required
            aria-label="Wgraj zdjęcie do personalizacji"
          />
        </div>

        <div>
          <Label htmlFor="prompt">Prompt / intencja</Label>
          <Textarea
            id="prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            maxLength={700}
            required
            aria-label="Opis projektu"
            placeholder="Mroczna aura, symbolika portalu, subtelne złoto i mgła..."
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="style">Styl</Label>
            <Select id="style" value={style} onChange={(event) => setStyle(event.target.value as (typeof STYLE_OPTIONS)[number])}>
              {STYLE_OPTIONS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry.replaceAll("_", " ")}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="transform">Poziom transformacji</Label>
            <Select
              id="transform"
              value={transformationLevel}
              onChange={(event) => setTransformationLevel(event.target.value as (typeof TRANSFORMATION_LEVELS)[number])}
            >
              {TRANSFORMATION_LEVELS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="rounded-md border border-zinc-800 p-4">
          <p className="mb-2 text-sm text-zinc-300">Dane wysyłki</p>
          <div className="grid gap-3 md:grid-cols-2">
            <Input placeholder="Imię i nazwisko" value={fullName} onChange={(event) => setFullName(event.target.value)} required />
            <Input placeholder="Adres" value={line1} onChange={(event) => setLine1(event.target.value)} required />
            <Input placeholder="Adres (linia 2)" value={line2} onChange={(event) => setLine2(event.target.value)} />
            <Input placeholder="Miasto" value={city} onChange={(event) => setCity(event.target.value)} required />
            <Input placeholder="Kod pocztowy" value={postalCode} onChange={(event) => setPostalCode(event.target.value)} required />
            <Input placeholder="Kraj (kod ISO-2)" value={country} onChange={(event) => setCountry(event.target.value)} required />
            <Input placeholder="Telefon (opcjonalnie)" value={phone} onChange={(event) => setPhone(event.target.value)} />
          </div>
        </div>

        <div className="space-y-2 rounded-md border border-zinc-800 p-4 text-sm text-zinc-300">
          <label className="flex gap-2">
            <Checkbox checked={rightsToImage} onChange={(event) => setRightsToImage(event.target.checked)} required />
            <span>Potwierdzam prawa do przesłanego zdjęcia oraz zgody osób widocznych na zdjęciu.</span>
          </label>
          <label className="flex gap-2">
            <Checkbox checked={mysteryNoPreview} onChange={(event) => setMysteryNoPreview(event.target.checked)} required />
            <span>Rozumiem, że zamawiam produkt mystery i nie zobaczę projektu przed drukiem.</span>
          </label>
          <label className="flex gap-2">
            <Checkbox checked={creativeVariance} onChange={(event) => setCreativeVariance(event.target.checked)} required />
            <span>Rozumiem, że efekt AI może kreatywnie różnić się od moich oczekiwań.</span>
          </label>
          <label className="flex gap-2">
            <Checkbox checked={noReturnChangeOfMind} onChange={(event) => setNoReturnChangeOfMind(event.target.checked)} required />
            <span>Rozumiem, że brak zwrotu dotyczy zmiany zdania, ale mogę reklamować wady produktu.</span>
          </label>
          <label className="flex gap-2">
            <Checkbox checked={faceConsent} onChange={(event) => setFaceConsent(event.target.checked)} />
            <span>Jeśli na zdjęciu są twarze, potwierdzam zgodę na wykorzystanie wizerunku.</span>
          </label>
        </div>

        {error ? <p className="text-sm text-red-300">{error}</p> : null}

        <Button type="submit" size="lg" disabled={loading}>
          {loading ? "Przywoływanie..." : "Przywołaj nadruk"}
        </Button>
      </form>
    </Card>
  );
}
