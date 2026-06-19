# Nocturne Prints — MVP

Mroczny, premium sklep e-commerce do sprzedaży personalizowanych koszulek i bluz typu **AI mystery print**.

## Stack

- Next.js (App Router), TypeScript, Tailwind CSS, shadcn-style components
- Prisma + PostgreSQL
- Stripe Checkout + webhook
- Modularne adaptery: storage (`local`/`s3`), queue (`local`/`bullmq`), moderacja/generowanie (mock + interfejs)
- Zod waliduje wejście API i formularze

## Architektura katalogów

- `app/` — strony (`/`, `/katalog`, `/konfigurator`, `/zamowienie/[id]`, `/admin/*`) i API routes
- `modules/`
  - `catalog/` — katalog produktów i opcje stylu
  - `moderation/` — `classifyPromptSafety`, `classifyImageSafety`, provider adapters
  - `generation/` — `ImageGenerationProvider`, `MockImageGenerationProvider`, budowanie promptu produkcyjnego
  - `orders/` — tworzenie zamówień, pipeline moderacji/generacji, statusy i audyt
  - `admin/` — reguły ręcznych przejść statusów
- `lib/` — env, db, auth admina, stripe, queue, storage, walidacje i copy prawne
- `prisma/` — schema i seed
- `tests/` — testy moderacji (Vitest)

## Szybki start

1. Skopiuj konfigurację:
   - `cp .env.example .env`
2. Uruchom bazę PostgreSQL lokalnie (zgodnie z `DATABASE_URL`).
3. Wygeneruj klienta Prisma i wgraj schema:
   - `npm run prisma:generate`
   - `npm run db:push`
4. Zasiej dane:
   - `npm run prisma:seed`
5. Uruchom aplikację:
   - `npm run dev`

## Demo dane i logowanie admina

- Produkty seed: koszulka + bluza, warianty kolorów i rozmiary
- Panel admina: `/admin/login`
- Konto admina bierze dane z `.env` (`ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`)

## Statusy zamówień

`pending_payment -> paid -> moderation_pending -> (rejected | needs_manual_review | generation_pending) -> generated -> production_ready -> printed -> shipped`

System jest fail-safe: niepewne wyniki zawsze kierują do `needs_manual_review`.

## Moderacja (MVP, warstwowa)

- Prompt:
  - normalizacja + heurystyki (obfuscation/leetspeak)
  - kategorie zakazane: marki, franczyzy, celebryci, styl żyjących artystów, hate/extremism, seksualizacja, gore, doxxing, impersonation, illegal activity
- Obraz:
  - walidacja MIME/rozmiaru/wymiarów
  - usuwanie EXIF
  - adapter analizy obrazu (NSFW, gore, logo, twarze, OCR/text)
  - fail-safe: niepewność -> ręczna moderacja
- Wygenerowany projekt:
  - ponowna moderacja przez ten sam interfejs

## API routes

- `POST /api/orders` — create order + prompt moderation
- `POST /api/upload` — upload image + image moderation + storage
- `POST /api/moderation/prompt` — standalone prompt moderation
- `POST /api/moderation/image` — standalone image moderation
- `POST /api/checkout/session` — Stripe Checkout session
- `POST /api/stripe/webhook` — Stripe webhook
- `POST /api/admin/orders/:id/status` — update status w panelu admina
- `POST /api/admin/login`, `POST /api/admin/logout` — auth panelu

## Ważne ograniczenia MVP

- Moderacja nie gwarantuje 100% wykrycia naruszeń.
- Provider AI to mock; realne API/model podłączasz przez adapter (`modules/generation/providers`).
- Provider moderacji obrazu/OCR/logo jest adapterem mockowym, gotowym do podmiany.
