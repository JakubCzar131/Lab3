from __future__ import annotations

import json
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font


HEADERS = [
    "URL",
    "Nazwa",
    "Kod katalogowy",
    "Producent",
    "Parametry techniczne (JSON)",
    "Opis producenta",
    "Opis PL",
]


def export_completed_products(rows: list[object], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Produkty enext.ua"
    worksheet.append(HEADERS)

    for cell in worksheet[1]:
        cell.font = Font(bold=True)
        cell.alignment = Alignment(vertical="top", wrap_text=True)

    for row in rows:
        product = json.loads(row["product_json"])
        worksheet.append(
            [
                row["url"],
                product.get("name", ""),
                product.get("catalog_code", ""),
                product.get("manufacturer", ""),
                json.dumps(product.get("technical_parameters", {}), ensure_ascii=False, indent=2),
                product.get("manufacturer_description", ""),
                row["polish_description"],
            ]
        )

    widths = {
        "A": 42,
        "B": 45,
        "C": 20,
        "D": 24,
        "E": 55,
        "F": 70,
        "G": 80,
    }
    for column, width in widths.items():
        worksheet.column_dimensions[column].width = width
    for worksheet_row in worksheet.iter_rows(min_row=2):
        for cell in worksheet_row:
            cell.alignment = Alignment(vertical="top", wrap_text=True)

    workbook.save(output_path)

