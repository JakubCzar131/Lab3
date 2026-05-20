"""Konwersja model.tflite -> model.h (tablica C dla TFLite Micro).

Generuje plik naglowkowy zgodny z konwencja TFLM:
    alignas(8) const unsigned char g_model[] = { ... };
    const unsigned int g_model_len = N;

Plik jest umieszczany obok 03_fall_detector.ino.

Uzycie:
    python 3_export_header.py --in ../model.tflite \\
                              --out ../firmware/03_fall_detector/model.h
"""

from __future__ import annotations

import argparse
import os
import sys


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="model.tflite -> model.h")
    p.add_argument("--in", dest="inp", type=str, default="../model.tflite",
                   help="Sciezka do model.tflite")
    p.add_argument("--out", type=str, default="../firmware/03_fall_detector/model.h",
                   help="Sciezka wyjsciowa do model.h")
    p.add_argument("--symbol", type=str, default="g_model",
                   help="Nazwa symbolu C (domyslnie g_model).")
    p.add_argument("--per_line", type=int, default=12,
                   help="Liczba bajtow w linii (czytelnosc).")
    return p.parse_args()


def bytes_to_c_array(data: bytes, symbol: str, per_line: int) -> str:
    lines = []
    lines.append("// Wygenerowane automatycznie przez 3_export_header.py — NIE EDYTOWAC.")
    lines.append("// alignas(8) wymagane przez TFLite Micro (FlatBuffer alignment).")
    lines.append("#pragma once")
    lines.append("")
    lines.append(f"alignas(8) const unsigned char {symbol}[] = {{")
    for i in range(0, len(data), per_line):
        chunk = data[i:i + per_line]
        row = ", ".join(f"0x{b:02x}" for b in chunk)
        lines.append(f"  {row},")
    lines.append("};")
    lines.append(f"const unsigned int {symbol}_len = {len(data)};")
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    args = _parse_args()

    if not os.path.isfile(args.inp):
        print(f"[BLAD] Nie znaleziono pliku {args.inp}. Uruchom najpierw 2_train.py.",
              file=sys.stderr)
        sys.exit(2)

    with open(args.inp, "rb") as f:
        data = f.read()

    header = bytes_to_c_array(data, args.symbol, args.per_line)

    out_path = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(header)

    print(f"[OK] Zapisano {out_path}  ({len(data)} B model, symbol={args.symbol})")
    print( "     Skopiuj/podlinkuj rowniez do firmware/04_hybrid_lowpower/, jesli uzywasz.")


if __name__ == "__main__":
    main()
