# enext.ua scraper

Aplikacja Python skanuje produkty z `enext.ua`, pobiera dane techniczne i opis producenta,
generuje opis po polsku przez OpenAI API oraz zapisuje wynik do pliku Excel.

## Instalacja

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m playwright install chromium
```

Ustaw klucz OpenAI:

```bash
export OPENAI_API_KEY="..."
```

## Uruchomienie

```bash
python -m enext_scraper \
  --output data/enext_products.xlsx \
  --checkpoint data/enext_checkpoint.sqlite3 \
  --concurrency 4 \
  --openai-concurrency 2
```

Domyślnie program:

1. pobiera URL-e produktów z `robots.txt` i sitemap,
2. jeśli nie znajdzie kandydatów w sitemapach, wykonuje crawl fallback po domenie,
3. przetwarza produkty równolegle przez Playwright,
4. generuje opis po polsku przez OpenAI,
5. zapisuje postęp w SQLite,
6. eksportuje ukończone produkty do Excela.

## Wznowienie po przerwaniu

Checkpoint znajduje się domyślnie w `data/enext_checkpoint.sqlite3`.
Po ponownym uruchomieniu aplikacja:

- nie duplikuje URL-i już zapisanych w checkpoint,
- przywraca produkty ze statusem `processing` do kolejki,
- pomija ukończone produkty,
- ponawia produkty nieudane do limitu `--max-attempts`.

Jeśli chcesz wznowić bez ponownego skanowania sitemap:

```bash
python -m enext_scraper --skip-discovery
```

## Przydatne opcje

- `--product-limit 10` - przetwarza maksymalnie 10 produktów w danym uruchomieniu.
- `--skip-openai` - tryb testowy bez wywołań OpenAI API.
- `--headful` - uruchamia widoczną przeglądarkę.
- `--log-level DEBUG` - bardziej szczegółowe logi.
- `--crawl-page-limit 1000` - limit stron odwiedzanych w fallback crawlu.
- `--model gpt-4o-mini` - model OpenAI używany do generowania opisów.

## Format danych w Excelu

Arkusz zawiera kolumny:

- URL,
- nazwa,
- kod katalogowy,
- producent,
- parametry techniczne jako JSON,
- opis producenta,
- opis PL w wymaganym formacie:

```text
# Nazwa produktu | najważniejsze parametry

🔧 Opis produktu

...

⚙️ Dane techniczne

Parametr: wartość

🏭 Zastosowanie

- ...
- ...
```

Prompt OpenAI wymusza użycie wyłącznie danych wejściowych i zabrania wymyślania parametrów.

