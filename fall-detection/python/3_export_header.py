#!/usr/bin/env python3
"""Konwersja model.tflite do C headera model.h."""

from __future__ import annotations

import argparse
from pathlib import Path

from utils import ensure_parent_dir


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Eksport modelu TFLite do pliku model.h (tablica C)."
    )
    parser.add_argument("--input", type=Path, required=True, help="Plik model.tflite")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("firmware/03_fall_detector/model.h"),
        help="Ścieżka wyjściowa model.h",
    )
    parser.add_argument(
        "--var-name",
        type=str,
        default="g_model",
        help="Nazwa tablicy z modelem w C/C++.",
    )
    return parser.parse_args()


def bytes_to_c_array(data: bytes, bytes_per_line: int = 12) -> str:
    """Formatuje bytes -> wielolinijkowa lista 0xNN."""

    lines: list[str] = []
    for i in range(0, len(data), bytes_per_line):
        chunk = data[i : i + bytes_per_line]
        lines.append("  " + ", ".join(f"0x{b:02x}" for b in chunk) + ",")
    return "\n".join(lines)


def main() -> None:
    args = parse_args()
    if not args.input.exists():
        raise FileNotFoundError(f"Nie znaleziono pliku wejściowego: {args.input}")

    model_bytes = args.input.read_bytes()
    c_array_body = bytes_to_c_array(model_bytes)

    header = f"""#pragma once
// Ten plik jest generowany automatycznie przez python/3_export_header.py

#include <cstddef>
#include <cstdint>

alignas(8) const unsigned char {args.var_name}[] = {{
{c_array_body}
}};

const unsigned int {args.var_name}_len = {len(model_bytes)};
"""

    ensure_parent_dir(args.output)
    args.output.write_text(header, encoding="utf-8")

    print(f"Zapisano header: {args.output.resolve()}")
    print(f"Rozmiar modelu: {len(model_bytes)} bajtów")


if __name__ == "__main__":
    main()
