from __future__ import annotations

import asyncio
import json
import logging
import re
import xml.etree.ElementTree as ET
from collections import deque
from html import unescape
from typing import Iterable
from urllib.parse import urldefrag, urljoin, urlparse

from playwright.async_api import Browser, BrowserContext, Page, TimeoutError as PlaywrightTimeoutError

from .models import ProductData


LOGGER = logging.getLogger(__name__)

PRODUCT_SCHEMA_RE = re.compile(r'"@type"\s*:\s*(?:\[[^\]]*)?"?Product"?', re.I)
LOC_RE = re.compile(r"<loc>\s*(.*?)\s*</loc>", re.I | re.S)
TECH_LABELS = (
    "характерист",
    "параметр",
    "специф",
    "technical",
    "техніч",
    "техничес",
    "dane techniczne",
)
DESCRIPTION_LABELS = (
    "опис",
    "description",
    "desc",
)
CODE_LABELS = (
    "артикул",
    "код товару",
    "код продукта",
    "код виробника",
    "каталож",
    "sku",
    "model",
)
MANUFACTURER_LABELS = (
    "виробник",
    "производитель",
    "manufacturer",
    "brand",
    "бренд",
)


def normalize_url(url: str, base_url: str = "https://enext.ua/") -> str | None:
    absolute = urljoin(base_url, unescape(url.strip()))
    absolute, _fragment = urldefrag(absolute)
    parsed = urlparse(absolute)
    if parsed.scheme not in {"http", "https"}:
        return None
    if not parsed.netloc.endswith("enext.ua"):
        return None
    if parsed.path.lower().endswith((".jpg", ".jpeg", ".png", ".gif", ".webp", ".pdf", ".zip")):
        return None
    return parsed._replace(query="").geturl().rstrip("/")


def looks_like_product_url(url: str) -> bool:
    path = urlparse(url).path.lower()
    product_words = (
        "product",
        "produk",
        "tovar",
        "catalog",
        "katalog",
        "item",
        "goods",
    )
    return any(word in path for word in product_words) and not path.endswith(("/category", "/catalog"))


def sitemap_name_suggests_products(url: str) -> bool:
    path = urlparse(url).path.lower()
    return any(word in path for word in ("product", "produk", "tovar", "goods", "items"))


async def fetch_text(page: Page, url: str, timeout_ms: int) -> str:
    await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
    content = await page.content()
    if "<loc>" in content or "<sitemapindex" in content or "<urlset" in content:
        return content
    try:
        return await page.locator("body").inner_text(timeout=3000)
    except Exception:
        return content


async def sitemap_urls_from_robots(page: Page, base_url: str, timeout_ms: int) -> list[str]:
    robots_url = urljoin(base_url, "/robots.txt")
    try:
        text = await fetch_text(page, robots_url, timeout_ms)
    except Exception as exc:
        LOGGER.info("Nie udało się pobrać robots.txt (%s), używam domyślnego sitemap.xml", exc)
        return [urljoin(base_url, "/sitemap.xml")]

    urls = []
    for line in text.splitlines():
        if line.lower().startswith("sitemap:"):
            normalized = normalize_url(line.split(":", 1)[1], base_url)
            if normalized:
                urls.append(normalized)
    return urls or [urljoin(base_url, "/sitemap.xml")]


def parse_sitemap_locations(text: str) -> tuple[list[str], list[str]]:
    text = text.strip()
    sitemap_urls: list[str] = []
    page_urls: list[str] = []

    try:
        root = ET.fromstring(text.encode("utf-8"))
        namespace = ""
        if root.tag.startswith("{"):
            namespace = root.tag.split("}", 1)[0] + "}"
        if root.tag.endswith("sitemapindex"):
            for loc in root.findall(f".//{namespace}loc"):
                if loc.text:
                    sitemap_urls.append(loc.text.strip())
        else:
            for loc in root.findall(f".//{namespace}loc"):
                if loc.text:
                    page_urls.append(loc.text.strip())
        return sitemap_urls, page_urls
    except ET.ParseError:
        # Some sites render XML with browser-added markup. A small fallback keeps discovery useful.
        search_text = unescape(text)
        locations = [unescape(match.group(1)).strip() for match in LOC_RE.finditer(search_text)]
        for loc in locations:
            if "sitemap" in urlparse(loc).path.lower():
                sitemap_urls.append(loc)
            else:
                page_urls.append(loc)
        return sitemap_urls, page_urls


async def discover_product_urls(
    browser: Browser,
    base_url: str,
    *,
    timeout_ms: int,
    crawl_page_limit: int,
    max_sitemaps: int,
) -> list[str]:
    context = await browser.new_context(user_agent=_user_agent())
    page = await context.new_page()
    product_urls: set[str] = set()
    seen_sitemaps: set[str] = set()
    pending_sitemaps: deque[str] = deque(await sitemap_urls_from_robots(page, base_url, timeout_ms))

    try:
        while pending_sitemaps and len(seen_sitemaps) < max_sitemaps:
            sitemap_url = pending_sitemaps.popleft()
            normalized_sitemap = normalize_url(sitemap_url, base_url)
            if not normalized_sitemap or normalized_sitemap in seen_sitemaps:
                continue
            seen_sitemaps.add(normalized_sitemap)
            try:
                text = await fetch_text(page, normalized_sitemap, timeout_ms)
            except Exception as exc:
                LOGGER.warning("Pomijam sitemap %s: %s", normalized_sitemap, exc)
                continue

            child_sitemaps, urls = parse_sitemap_locations(text)
            for child in child_sitemaps:
                normalized_child = normalize_url(child, base_url)
                if normalized_child and normalized_child not in seen_sitemaps:
                    pending_sitemaps.append(normalized_child)

            product_sitemap = sitemap_name_suggests_products(normalized_sitemap)
            for url in urls:
                normalized = normalize_url(url, base_url)
                if not normalized:
                    continue
                if product_sitemap or looks_like_product_url(normalized):
                    product_urls.add(normalized)

        if product_urls:
            LOGGER.info("Znaleziono %s kandydatów produktów w sitemapach", len(product_urls))
            return sorted(product_urls)

        LOGGER.info("Sitemapy nie dały kandydatów produktów, uruchamiam crawl fallback")
        product_urls.update(await crawl_for_product_urls(context, base_url, timeout_ms, crawl_page_limit))
        return sorted(product_urls)
    finally:
        await context.close()


async def crawl_for_product_urls(
    context: BrowserContext,
    base_url: str,
    timeout_ms: int,
    page_limit: int,
) -> set[str]:
    queue: deque[str] = deque([base_url])
    seen: set[str] = set()
    products: set[str] = set()
    page = await context.new_page()

    while queue and len(seen) < page_limit:
        url = queue.popleft()
        normalized = normalize_url(url, base_url)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        try:
            await page.goto(normalized, wait_until="domcontentloaded", timeout=timeout_ms)
            await page.wait_for_timeout(300)
            html = await page.content()
            if is_product_html(html):
                products.add(normalized)
            for link in await page.eval_on_selector_all(
                "a[href]",
                "(links) => links.map((a) => a.href)",
            ):
                child = normalize_url(str(link), base_url)
                if child and child not in seen and _crawlable_path(child):
                    if looks_like_product_url(child):
                        products.add(child)
                    queue.append(child)
        except Exception as exc:
            LOGGER.debug("Błąd crawl %s: %s", normalized, exc)

    await page.close()
    LOGGER.info("Crawl odwiedził %s stron i znalazł %s kandydatów produktów", len(seen), len(products))
    return products


def is_product_html(html: str) -> bool:
    lowered = html.lower()
    return bool(PRODUCT_SCHEMA_RE.search(html)) or (
        any(label in lowered for label in CODE_LABELS)
        and any(label in lowered for label in MANUFACTURER_LABELS + TECH_LABELS)
    )


def _crawlable_path(url: str) -> bool:
    path = urlparse(url).path.lower()
    blocked = ("cart", "basket", "checkout", "login", "register", "compare", "wishlist")
    return not any(part in path for part in blocked)


class ProductScraper:
    def __init__(self, context: BrowserContext, timeout_ms: int) -> None:
        self.context = context
        self.timeout_ms = timeout_ms

    async def scrape(self, url: str) -> ProductData:
        page = await self.context.new_page()
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=self.timeout_ms)
            await page.wait_for_timeout(500)
            html = await page.content()
            if not is_product_html(html):
                LOGGER.debug("Strona nie wygląda jak produkt: %s", url)
            json_ld = await extract_json_ld(page)
            data = await extract_dom_product(page, url)
            enrich_from_json_ld(data, json_ld)
            data.technical_parameters = clean_parameters(data.technical_parameters)
            if not data.manufacturer_description:
                data.manufacturer_description = await meta_content(page, "description")
            return data
        except PlaywrightTimeoutError as exc:
            raise RuntimeError(f"Timeout podczas pobierania produktu {url}") from exc
        finally:
            await page.close()


async def extract_json_ld(page: Page) -> list[dict[str, object]]:
    raw_items = await page.eval_on_selector_all(
        'script[type="application/ld+json"]',
        "(nodes) => nodes.map((node) => node.textContent || '')",
    )
    items: list[dict[str, object]] = []
    for raw in raw_items:
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            items.extend(_flatten_json_ld(parsed))
        elif isinstance(parsed, list):
            for entry in parsed:
                if isinstance(entry, dict):
                    items.extend(_flatten_json_ld(entry))
    return items


def _flatten_json_ld(item: dict[str, object]) -> list[dict[str, object]]:
    flattened = [item]
    graph = item.get("@graph")
    if isinstance(graph, list):
        flattened.extend(entry for entry in graph if isinstance(entry, dict))
    return flattened


async def extract_dom_product(page: Page, url: str) -> ProductData:
    product = ProductData(url=url)
    product.name = first_non_empty(
        [
            await text_or_empty(page, "h1"),
            await meta_content(page, "og:title"),
            await page.title(),
        ]
    )

    all_pairs = await collect_label_value_pairs(page)
    for label, value in all_pairs:
        lowered = label.lower()
        if not product.catalog_code and any(token in lowered for token in CODE_LABELS):
            product.catalog_code = value
        elif not product.manufacturer and any(token in lowered for token in MANUFACTURER_LABELS):
            product.manufacturer = value
        if any(token in lowered for token in TECH_LABELS) or _looks_like_parameter(label, value):
            product.technical_parameters[label] = value

    product.technical_parameters.update(await collect_tables(page))
    product.technical_parameters.update(await collect_definition_lists(page))
    product.manufacturer_description = await extract_description(page)
    return product


async def collect_label_value_pairs(page: Page) -> list[tuple[str, str]]:
    return await page.evaluate(
        """
        () => {
          const pairs = [];
          const selectors = [
            '.product-info li', '.product-info__item', '.product__info li',
            '.characteristics li', '.properties li', '.attributes li',
            '.product-params li', '[class*="characteristic"] li',
            '[class*="attribute"] li', '[class*="param"] li'
          ];
          for (const selector of selectors) {
            for (const node of document.querySelectorAll(selector)) {
              const text = (node.innerText || '').replace(/\\s+/g, ' ').trim();
              const separator = text.includes(':') ? ':' : (text.includes('—') ? '—' : null);
              if (!separator) continue;
              const [label, ...rest] = text.split(separator);
              const value = rest.join(separator).trim();
              if (label && value) pairs.push([label.trim(), value]);
            }
          }
          return pairs;
        }
        """
    )


async def collect_tables(page: Page) -> dict[str, str]:
    pairs = await page.evaluate(
        """
        () => {
          const result = [];
          for (const row of document.querySelectorAll('table tr')) {
            const cells = Array.from(row.querySelectorAll('th,td'))
              .map((cell) => (cell.innerText || '').replace(/\\s+/g, ' ').trim())
              .filter(Boolean);
            if (cells.length >= 2) result.push([cells[0], cells.slice(1).join(' ')]);
          }
          return result;
        }
        """
    )
    return {label: value for label, value in pairs if _looks_like_parameter(label, value)}


async def collect_definition_lists(page: Page) -> dict[str, str]:
    pairs = await page.evaluate(
        """
        () => {
          const result = [];
          for (const dl of document.querySelectorAll('dl')) {
            let lastTerm = '';
            for (const child of dl.children) {
              const text = (child.innerText || '').replace(/\\s+/g, ' ').trim();
              if (!text) continue;
              if (child.tagName.toLowerCase() === 'dt') lastTerm = text;
              if (child.tagName.toLowerCase() === 'dd' && lastTerm) result.push([lastTerm, text]);
            }
          }
          return result;
        }
        """
    )
    return {label: value for label, value in pairs if _looks_like_parameter(label, value)}


async def extract_description(page: Page) -> str:
    candidates: list[str] = await page.evaluate(
        """
        () => {
          const selectors = [
            '[class*="description"]', '[id*="description"]',
            '[class*="opis"]', '[id*="opis"]',
            '.tab-content', '.product-tabs', '.product__description'
          ];
          const texts = [];
          for (const selector of selectors) {
            for (const node of document.querySelectorAll(selector)) {
              const text = (node.innerText || '').replace(/\\s+/g, ' ').trim();
              if (text.length > 80) texts.push(text);
            }
          }
          return texts;
        }
        """
    )
    filtered = [
        text
        for text in candidates
        if any(label in text.lower()[:120] for label in DESCRIPTION_LABELS) or len(text) > 160
    ]
    return max(filtered or candidates or [""], key=len)[:12000]


def enrich_from_json_ld(product: ProductData, json_ld: Iterable[dict[str, object]]) -> None:
    for item in json_ld:
        type_value = item.get("@type")
        types = type_value if isinstance(type_value, list) else [type_value]
        if not any(str(value).lower() == "product" for value in types):
            continue
        product.name = product.name or str(item.get("name") or "")
        product.catalog_code = product.catalog_code or str(item.get("sku") or item.get("mpn") or "")
        if not product.manufacturer:
            brand = item.get("brand") or item.get("manufacturer")
            if isinstance(brand, dict):
                product.manufacturer = str(brand.get("name") or "")
            elif brand:
                product.manufacturer = str(brand)
        product.manufacturer_description = product.manufacturer_description or str(item.get("description") or "")


def clean_parameters(parameters: dict[str, str]) -> dict[str, str]:
    cleaned: dict[str, str] = {}
    for raw_label, raw_value in parameters.items():
        label = normalize_space(raw_label).strip(":")
        value = normalize_space(raw_value)
        if not label or not value or label.lower() == value.lower():
            continue
        if len(label) > 120 or len(value) > 1000:
            continue
        cleaned[label] = value
    return cleaned


def _looks_like_parameter(label: str, value: str) -> bool:
    if not label or not value:
        return False
    lowered = label.lower()
    if any(token in lowered for token in CODE_LABELS + MANUFACTURER_LABELS):
        return False
    return len(label) <= 120 and len(value) <= 1000


async def text_or_empty(page: Page, selector: str) -> str:
    try:
        return normalize_space(await page.locator(selector).first.inner_text(timeout=2000))
    except Exception:
        return ""


async def meta_content(page: Page, name: str) -> str:
    escaped = name.replace('"', '\\"')
    selectors = [
        f'meta[property="{escaped}"]',
        f'meta[name="{escaped}"]',
    ]
    for selector in selectors:
        try:
            value = await page.locator(selector).first.get_attribute("content", timeout=1000)
            if value:
                return normalize_space(value)
        except Exception:
            continue
    return ""


def first_non_empty(values: Iterable[str]) -> str:
    for value in values:
        normalized = normalize_space(value)
        if normalized:
            return normalized
    return ""


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _user_agent() -> str:
    return (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 enext-scraper/1.0"
    )

