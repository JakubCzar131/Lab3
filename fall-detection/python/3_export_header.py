#!/usr/bin/env python3
"""Eksport model.tflite do naglowka C++ dla TFLite Micro."""

from __future__ import annotations

import argparse
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="model.tflite -> model.h")
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("build/model.tflite"),
        help="Plik model.tflite po kwantyzacji INT8.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Docelowy model.h. Domyslnie firmware/03_fall_detector/model.h.",
    )
    parser.add_argument(
        "--bytes-per-line",
        type=int,
        default=12,
        help="Ile bajtow wypisac w jednej linii tablicy C.",
    )
    return parser.parse_args()


def format_c_array(data: bytes, bytes_per_line: int) -> str:
    """Formatuje bajty jako czytelna tablice C."""

    lines: list[str] = []
    for offset in range(0, len(data), bytes_per_line):
        chunk = data[offset : offset + bytes_per_line]
        values = ", ".join(f"0x{byte:02x}" for byte in chunk)
        lines.append(f"  {values},")
    return "\n".join(lines)


def main() -> None:
    args = parse_args()
    if not args.input.exists():
        raise FileNotFoundError(args.input)

    default_output = args.output is None
    output = args.output
    if output is None:
        output = (
            Path(__file__).resolve().parents[1]
            / "firmware"
            / "03_fall_detector"
            / "model.h"
        )

    data = args.input.read_bytes()
    output.parent.mkdir(parents=True, exist_ok=True)
    header = f"""#pragma once

// Plik wygenerowany przez python/3_export_header.py.
// Zawiera skwantyzowany model TFLite INT8 dla TFLite Micro.

#include <cstddef>
#include <cstdint>

alignas(8) const unsigned char g_model[] = {{
{format_c_array(data, args.bytes_per_line)}
}};

const int g_model_len = {len(data)};
"""
    output.write_text(header, encoding="utf-8")
    print(f"Zapisano {output} ({len(data)} bajtow)")

    if default_output:
        hybrid_output = output.parents[1] / "04_hybrid_lowpower" / "model.h"
        hybrid_output.parent.mkdir(parents=True, exist_ok=True)
        hybrid_output.write_text(header, encoding="utf-8")
        print(f"Skopiowano model.h do {hybrid_output}")


if __name__ == "__main__":
    main()

