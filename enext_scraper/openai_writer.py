from __future__ import annotations

import asyncio
import json
import logging
import os

from .models import ProductData


LOGGER = logging.getLogger(__name__)


class PolishDescriptionWriter:
    def __init__(
        self,
        *,
        model: str,
        temperature: float = 0.2,
        max_retries: int = 3,
        skip_openai: bool = False,
    ) -> None:
        self.model = model
        self.temperature = temperature
        self.max_retries = max_retries
        self.skip_openai = skip_openai
        self._client = None

    @property
    def client(self):
        if self._client is None:
            if not os.getenv("OPENAI_API_KEY"):
                raise RuntimeError("Brak zmiennej środowiskowej OPENAI_API_KEY")
            from openai import AsyncOpenAI

            self._client = AsyncOpenAI()
        return self._client

    async def write(self, product: ProductData) -> str:
        if self.skip_openai:
            return offline_description(product)

        payload = {
            "name": product.name,
            "catalog_code": product.catalog_code,
            "manufacturer": product.manufacturer,
            "technical_parameters": product.technical_parameters,
            "manufacturer_description": product.manufacturer_description,
        }
        messages = [
            {
                "role": "system",
                "content": (
                    "Jesteś polskim copywriterem technicznym. Tworzysz opisy produktów wyłącznie "
                    "na podstawie przekazanych danych. Nie wolno wymyślać parametrów, wartości, norm, "
                    "zastosowań ani cech, których nie ma w danych wejściowych. Jeśli informacja jest "
                    "niepewna, pomiń ją."
                ),
            },
            {
                "role": "user",
                "content": (
                    "Na podstawie poniższych danych wygeneruj opis po polsku dokładnie w formacie:\n\n"
                    "# Nazwa produktu | najważniejsze parametry\n\n"
                    "🔧 Opis produktu\n\n"
                    "...\n\n"
                    "⚙️ Dane techniczne\n\n"
                    "Parametr: wartość\n\n"
                    "🏭 Zastosowanie\n\n"
                    "- ...\n"
                    "- ...\n\n"
                    "W sekcji danych technicznych wypisz tylko parametry wejściowe i ich wartości. "
                    "Najważniejsze parametry w nagłówku wybierz wyłącznie z technical_parameters. "
                    "Dane produktu JSON:\n"
                    f"{json.dumps(payload, ensure_ascii=False, indent=2)}"
                ),
            },
        ]

        last_error: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            try:
                response = await self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    temperature=self.temperature,
                )
                text = response.choices[0].message.content or ""
                return text.strip()
            except Exception as exc:  # OpenAI exceptions differ between package versions.
                last_error = exc
                wait_s = min(2**attempt, 15)
                LOGGER.warning(
                    "Błąd OpenAI dla %s (próba %s/%s): %s",
                    product.url,
                    attempt,
                    self.max_retries,
                    exc,
                )
                await asyncio.sleep(wait_s)

        raise RuntimeError(f"Nie udało się wygenerować opisu OpenAI: {last_error}")


def offline_description(product: ProductData) -> str:
    """Deterministic fallback for dry runs; production runs should use OpenAI."""

    top_parameters = list(product.technical_parameters.items())[:3]
    top = ", ".join(f"{key}: {value}" for key, value in top_parameters) or "parametry w danych technicznych"
    lines = [
        f"# {product.name or 'Produkt'} | {top}",
        "",
        "🔧 Opis produktu",
        "",
        product.manufacturer_description or "Opis producenta nie został znaleziony na stronie produktu.",
        "",
        "⚙️ Dane techniczne",
        "",
    ]
    lines.extend(f"{key}: {value}" for key, value in product.technical_parameters.items())
    lines.extend(
        [
            "",
            "🏭 Zastosowanie",
            "",
            "- Zastosowanie zgodne z opisem producenta i parametrami technicznymi produktu.",
        ]
    )
    return "\n".join(lines).strip()

