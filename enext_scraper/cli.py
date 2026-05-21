from __future__ import annotations

import argparse
import asyncio
import logging
from pathlib import Path

from playwright.async_api import async_playwright

from .checkpoint import CheckpointStore
from .crawler import ProductScraper, discover_product_urls
from .excel import export_completed_products
from .openai_writer import PolishDescriptionWriter


LOGGER = logging.getLogger(__name__)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Scrape enext.ua products, generate Polish descriptions and export Excel."
    )
    parser.add_argument("--base-url", default="https://enext.ua/", help="Adres startowy sklepu")
    parser.add_argument("--output", type=Path, default=Path("data/enext_products.xlsx"))
    parser.add_argument("--checkpoint", type=Path, default=Path("data/enext_checkpoint.sqlite3"))
    parser.add_argument("--concurrency", type=int, default=4, help="Liczba równoległych produktów")
    parser.add_argument("--openai-concurrency", type=int, default=2, help="Równoległe zapytania OpenAI")
    parser.add_argument("--timeout-ms", type=int, default=30000, help="Timeout na stronę Playwright")
    parser.add_argument("--crawl-page-limit", type=int, default=1000, help="Limit stron w fallback crawlu")
    parser.add_argument("--max-sitemaps", type=int, default=1000, help="Maksymalna liczba sitemap do odczytu")
    parser.add_argument("--model", default="gpt-4o-mini", help="Model OpenAI")
    parser.add_argument("--headful", action="store_true", help="Uruchom widoczną przeglądarkę")
    parser.add_argument("--skip-discovery", action="store_true", help="Użyj URL-i już zapisanych w checkpoint")
    parser.add_argument("--skip-openai", action="store_true", help="Tryb testowy bez OpenAI API")
    parser.add_argument("--product-limit", type=int, default=0, help="Limit produktów w tym uruchomieniu")
    parser.add_argument("--max-attempts", type=int, default=3, help="Maksymalna liczba prób produktu")
    parser.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    return parser


def configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level),
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )


async def run(args: argparse.Namespace) -> None:
    store = CheckpointStore(args.checkpoint)
    reset_count = store.reset_interrupted()
    if reset_count:
        LOGGER.info("Przywrócono %s przerwanych produktów do kolejki", reset_count)

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=not args.headful)
        try:
            if not args.skip_discovery:
                LOGGER.info("Rozpoczynam skanowanie produktów z %s", args.base_url)
                urls = await discover_product_urls(
                    browser,
                    args.base_url,
                    timeout_ms=args.timeout_ms,
                    crawl_page_limit=args.crawl_page_limit,
                    max_sitemaps=args.max_sitemaps,
                )
                inserted = store.add_urls(urls)
                LOGGER.info("Discovery: %s URL-i produktów, %s nowych w checkpoint", len(urls), inserted)

            await process_products(browser, store, args)
        finally:
            await browser.close()

    completed = store.completed_rows()
    export_completed_products(completed, args.output)
    LOGGER.info("Zapisano %s produktów do %s", len(completed), args.output)
    LOGGER.info("Końcowy status: %s", store.counts())


async def process_products(browser, store: CheckpointStore, args: argparse.Namespace) -> None:
    context = await browser.new_context(
        user_agent=(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 enext-scraper/1.0"
        )
    )
    writer = PolishDescriptionWriter(
        model=args.model,
        skip_openai=args.skip_openai,
    )
    openai_sem = asyncio.Semaphore(max(1, args.openai_concurrency))
    start_lock = asyncio.Lock()
    started = 0

    async def can_start_next() -> bool:
        nonlocal started
        if args.product_limit <= 0:
            return True
        async with start_lock:
            if started >= args.product_limit:
                return False
            started += 1
            return True

    async def worker(worker_id: int) -> None:
        scraper = ProductScraper(context, timeout_ms=args.timeout_ms)
        while await can_start_next():
            url = store.claim_next(max_attempts=args.max_attempts)
            if url is None:
                return
            LOGGER.info("Worker %s przetwarza %s", worker_id, url)
            try:
                product = await scraper.scrape(url)
                if not product.has_required_content():
                    raise RuntimeError("Nie znaleziono wymaganych danych produktu")
                async with openai_sem:
                    polish_description = await writer.write(product)
                store.mark_completed(product, polish_description)
                LOGGER.info("Gotowe: %s | status %s", url, store.counts())
            except Exception as exc:
                store.mark_failed(url, str(exc))
                LOGGER.exception("Błąd produktu %s: %s", url, exc)

    try:
        workers = [
            asyncio.create_task(worker(worker_id))
            for worker_id in range(1, max(1, args.concurrency) + 1)
        ]
        await asyncio.gather(*workers)
    finally:
        await context.close()


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    configure_logging(args.log_level)
    asyncio.run(run(args))

