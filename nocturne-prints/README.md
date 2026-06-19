# Nocturne Prints

> Nie wybierasz nadruku. Przywołujesz go.

MVP sklepu internetowego do sprzedaży **personalizowanych koszulek i bluz typu „AI mystery print”**.
Klient wrzuca zdjęcie, podaje prompt i styl, wybiera rozmiar/kolor — system tworzy projekt AI **jako niespodziankę** (bez podglądu przed drukiem). Po warstwowej moderacji zamówienie trafia do panelu produkcji.

Mroczny, premium, lekko okultystyczno-cyberpunkowy klimat — ale jasny prawnie.

## Propozycje nazw (klimat)

`Nocturne Prints` (domyślna) · Umbra Atelier · Sigil & Thread · Veil Foundry · Oraculum Wear · Noir Rite

---

## Stack

- **Next.js 14 (App Router)** + **TypeScript**
- **Tailwind CSS** + komponenty w stylu **shadcn/ui** (Radix UI)
- **Prisma** + **PostgreSQL**
- **Stripe Checkout** (z trybem mock, gdy brak kluczy)
- Upload zdjęć: **adapter storage** (lokalny / S3-R2)
- Kolejka zadań: **adapter** (in-memory / BullMQ)
- Walidacja: **Zod** wszędzie na wejściu
- Auth panelu admina: sesyjne cookie (HMAC) + scrypt

---

## Architektura (skrót)

```
src/
├── app/
│   ├── (shop)/            # landing, katalog, konfigurator, zamówienie, regulamin
│   ├── admin/             # login + dashboard + szczegóły zamówienia + akcje
│   ├── actions/           # server action: tworzenie zamówienia
│   └── api/               # upload, assets, stripe/webhook, checkout/mock
├── components/ (ui/, shop/, admin/)
└── lib/
    ├── env.ts             # walidacja ENV (Zod) — sekrety tylko z process.env
    ├── db.ts              # Prisma client (singleton)
    ├── storage/           # interface + local + s3/r2 (stub) + factory
    ├── queue/             # interface + memory + bullmq (stub) + factory
    ├── moderation/        # prompt + image + generated + dictionaries + normalize
    ├── generation/        # ImageGenerationProvider + mock + prompt-builder
    ├── orders.ts          # maszyna stanów + audyt
    ├── payments.ts        # markOrderPaid + start pipeline (idempotentne)
    ├── workers.ts         # pipeline: moderacja -> generacja -> moderacja finalna
    └── auth.ts            # scrypt + sesje HMAC
```

### Cykl życia zamówienia (maszyna stanów)

```
pending_payment → paid → moderation_pending
   → (rejected | needs_manual_review | generation_pending)
generation_pending → generated → (production_ready | needs_manual_review | rejected)
production_ready → printed → shipped
(+ cancelled z dowolnego stanu)
```

Po płatności pipeline (kolejka) uruchamia kolejno:
1. `moderate_order` — moderacja **promptu** + **zdjęcia**,
2. `generate_design` — budowa promptu produkcyjnego + generacja (provider),
3. `moderate_generated` — moderacja **finalnego projektu**.

---

## Moderacja (warstwowa, fail-safe)

Statusy: `allowed` · `rejected` · `needs_manual_review`.

> **Zasada nadrzędna:** jeśli system nie jest pewien → `needs_manual_review` (ręczna weryfikacja),
> **nigdy** automatycznie do druku. Nie udajemy, że moderacja wykryje 100% naruszeń.

- **Prompt** — `classifyPromptSafety(prompt)`: normalizacja (lowercase, redukcja spacji,
  diakrytyki, leetspeak, „n i k e”), słowniki i heurystyki (marki, franczyzy, osoby publiczne,
  styl artysty, hate/ekstremizm, NSFW/CSAE, przemoc, doxxing, podszywanie się, treści nielegalne).
  Interfejs gotowy pod LLM moderation API (`PROMPT_MODERATION_DRIVER=llm`).
- **Zdjęcie** — `classifyImageSafety(file)`: walidacja (MIME, rozmiar, wymiary), **usunięcie EXIF**,
  bezpieczna nazwa pliku, a następnie adapter analizy (NSFW / przemoc / symbole / OCR / twarze / logo).
  Mock jest deterministyczny i **nie udaje** prawdziwej detekcji. Interfejs pod zewnętrzne API
  (`IMAGE_MODERATION_DRIVER=external`).
- **Finalny projekt** — `moderateGeneratedDesign(image)`: ponowne sprawdzenie wygenerowanej grafiki
  (logo, znana postać, NSFW, gore, hate, podobieństwo do marki). Niepewność → `needs_manual_review`.

Każdy wynik zapisywany jest w `ModerationResult` (`rawJson` + kategorie + powody + confidence).

> Adaptery moderacji obrazu, OCR, detekcji logo oraz generowania grafiki są **stubami z gotowym
> interfejsem** — wystarczy je podpiąć, bez zmiany kodu domeny.

---

## Uruchomienie

### Wymagania
Node 18+ (testowane na 22), PostgreSQL 14+.

### Kroki

```bash
cd nocturne-prints
npm install
cp .env.example .env        # uzupełnij wartości (patrz niżej)

# baza
npm run db:push             # lub: npm run db:migrate
npm run db:seed             # produkty + admin

npm run dev                 # http://localhost:3000
```

Build produkcyjny:

```bash
npm run build && npm run start
```

### Minimalny `.env` do startu (tryb dev bez Stripe/S3)

```env
DATABASE_URL="postgresql://nocturne:nocturne@localhost:5432/nocturne?schema=public"
AUTH_SECRET="dlugi-losowy-sekret-min-32-znaki-xxxxx"
ADMIN_EMAIL="admin@nocturne.local"
ADMIN_PASSWORD="change-me-now"
APP_URL="http://localhost:3000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
# STORAGE_DRIVER=local, QUEUE_DRIVER=memory, *_DRIVER=mock — domyślne
```

Bez `STRIPE_SECRET_KEY` checkout działa w **trybie mock** (`/api/checkout/mock`),
co pozwala przejść cały przepływ (płatność → moderacja → generacja → druk) lokalnie.

### Panel admina

`/admin/login` — dane z `ADMIN_EMAIL` / `ADMIN_PASSWORD` (seed). Lista zamówień, podgląd
zdjęcia i promptu, wyniki moderacji, log audytowy, zgody klienta oraz akcje:
zaakceptuj ręcznie / odrzuć (z powodem) / wygeneruj ponownie / gotowe do druku / wydrukowane / wysłane / anuluj.

---

## Stripe (opcjonalnie)

1. Ustaw `STRIPE_SECRET_KEY` i `STRIPE_WEBHOOK_SECRET`.
2. Webhook: `POST /api/stripe/webhook`, zdarzenie `checkout.session.completed`.
   Lokalnie: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

Płatność jest uznawana dopiero po zweryfikowanym webhooku (`markOrderPaid` — idempotentne).

---

## Wymiana adapterów (produkcja)

| Obszar | ENV | Co zrobić |
|---|---|---|
| Storage S3/R2 | `STORAGE_DRIVER=s3` | `npm i @aws-sdk/client-s3`, uzupełnić `s3-adapter.ts` |
| Kolejka | `QUEUE_DRIVER=bullmq` | `npm i bullmq ioredis`, uzupełnić `bullmq-adapter.ts`, uruchomić worker |
| Moderacja obrazu | `IMAGE_MODERATION_DRIVER=external` | wpiąć API (Rekognition/Vision/Hive) w `image.ts` |
| Moderacja promptu | `PROMPT_MODERATION_DRIVER=llm` | wpiąć LLM moderation w `prompt.ts` |
| Generacja grafiki | `IMAGE_GENERATION_DRIVER=external` | wpiąć model/API w `generation/provider.ts` |

---

## Bezpieczeństwo i zasady

- Walidacja Zod na każdym wejściu; cena liczona po stronie serwera.
- Checkboxy zgód **nie zastępują** moderacji — system i tak moderuje treści.
- Wykryta twarz → wymagana zgoda na wizerunek (wymuszane po stronie serwera).
- Zgody zapisywane jako snapshot tekstu + IP + user-agent (`ConsentLog`).
- EXIF usuwany z każdego uploadu; uploady serwowane przez chroniony route (nie z `/public`).
- Nie tworzymy treści naruszających prawa autorskie, znaki towarowe ani wizerunek;
  prompt produkcyjny jest oczyszczany z marek/postaci/stylu konkretnych artystów.

## Skrypty

| Skrypt | Opis |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` / `lint` | TS / ESLint |
| `npm run db:push` / `db:migrate` / `db:seed` / `db:studio` | Prisma |

> To jest MVP. Moderacja oparta na regułach jest warstwą wstępną — przed produkcją podłącz
> realne API moderacji obrazu, OCR i detekcji logo oraz dopnij regulamin z działem prawnym.
