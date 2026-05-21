from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterable, Iterator

from .models import ProductData


SCHEMA = """
CREATE TABLE IF NOT EXISTS products (
    url TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT '',
    product_json TEXT NOT NULL DEFAULT '',
    polish_description TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
"""


class CheckpointStore:
    """SQLite-backed progress store used to resume interrupted runs."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as conn:
            conn.executescript(SCHEMA)

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=30)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def add_urls(self, urls: Iterable[str]) -> int:
        now = time.time()
        inserted = 0
        with self.connection() as conn:
            for url in urls:
                cursor = conn.execute(
                    """
                    INSERT OR IGNORE INTO products(url, status, created_at, updated_at)
                    VALUES (?, 'pending', ?, ?)
                    """,
                    (url, now, now),
                )
                inserted += cursor.rowcount
        return inserted

    def reset_interrupted(self) -> int:
        now = time.time()
        with self.connection() as conn:
            cursor = conn.execute(
                """
                UPDATE products
                SET status = 'pending', updated_at = ?
                WHERE status = 'processing'
                """,
                (now,),
            )
            return cursor.rowcount

    def claim_next(self, max_attempts: int) -> str | None:
        now = time.time()
        with self.connection() as conn:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                """
                SELECT url
                FROM products
                WHERE status = 'pending'
                   OR (status = 'failed' AND attempts < ?)
                ORDER BY attempts ASC, created_at ASC
                LIMIT 1
                """,
                (max_attempts,),
            ).fetchone()
            if row is None:
                return None
            conn.execute(
                """
                UPDATE products
                SET status = 'processing', attempts = attempts + 1, error = '', updated_at = ?
                WHERE url = ?
                """,
                (now, row["url"]),
            )
            return str(row["url"])

    def mark_completed(
        self,
        product: ProductData,
        polish_description: str,
    ) -> None:
        now = time.time()
        with self.connection() as conn:
            conn.execute(
                """
                UPDATE products
                SET status = 'completed',
                    product_json = ?,
                    polish_description = ?,
                    error = '',
                    updated_at = ?
                WHERE url = ?
                """,
                (
                    json.dumps(product_to_dict(product), ensure_ascii=False),
                    polish_description,
                    now,
                    product.url,
                ),
            )

    def mark_failed(self, url: str, error: str) -> None:
        now = time.time()
        with self.connection() as conn:
            conn.execute(
                """
                UPDATE products
                SET status = 'failed', error = ?, updated_at = ?
                WHERE url = ?
                """,
                (error[:4000], now, url),
            )

    def counts(self) -> dict[str, int]:
        with self.connection() as conn:
            rows = conn.execute(
                "SELECT status, COUNT(*) AS count FROM products GROUP BY status"
            ).fetchall()
        return {str(row["status"]): int(row["count"]) for row in rows}

    def processable_count(self, max_attempts: int) -> int:
        with self.connection() as conn:
            row = conn.execute(
                """
                SELECT COUNT(*) AS count
                FROM products
                WHERE status = 'pending'
                   OR (status = 'failed' AND attempts < ?)
                """,
                (max_attempts,),
            ).fetchone()
        return int(row["count"])

    def completed_rows(self) -> list[sqlite3.Row]:
        with self.connection() as conn:
            return conn.execute(
                """
                SELECT url, product_json, polish_description
                FROM products
                WHERE status = 'completed'
                ORDER BY url
                """
            ).fetchall()


def product_to_dict(product: ProductData) -> dict[str, object]:
    return {
        "url": product.url,
        "name": product.name,
        "catalog_code": product.catalog_code,
        "manufacturer": product.manufacturer,
        "technical_parameters": product.technical_parameters,
        "manufacturer_description": product.manufacturer_description,
    }

