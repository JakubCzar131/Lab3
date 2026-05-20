"""Preprocessing zbioru KFall -> okna .npz gotowe do treningu.

Zadania:
1. Iteruje po wszystkich probach KFall (sensor_data/SA*/*.csv + label_data/*.xlsx).
2. Etykietuje kazda probke wg planu:
       - klasa 1 (PRE-FALL) miedzy Fall_onset_frame a Fall_impact_frame,
       - klasa 2 (FALL) od impact przez POST_IMPACT probek,
       - reszta i pliki ADL: klasa 0.
3. Tnie sygnal oknem WINDOW_SIZE ze skokiem STRIDE.
   Etykieta okna = klasa OSTATNIEJ probki w oknie (symuluje inferencje online).
4. Normalizuje X (z-score per kanal) — zapisuje mean i std.
   Te wartosci MUSZA byc identyczne z tymi w firmware (normalization.h).
5. Zapisuje kfall_windows.npz z polami: X, y, mean, std, subjects.

Uzycie:
    python 1_preprocess.py --data ../kfall --out ../kfall_windows.npz
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from typing import List

import numpy as np

# Pozwalamy uruchamiac skrypt zarowno z katalogu python/ jak i z roota.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import utils  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="KFall -> okna .npz")
    parser.add_argument("--data", type=str, default="../kfall",
                        help="Sciezka do katalogu z KFall (zawierajacego sensor_data/ i label_data/).")
    parser.add_argument("--out", type=str, default="../kfall_windows.npz",
                        help="Plik wyjsciowy .npz z X, y, mean, std, subjects.")
    parser.add_argument("--subjects", type=str, default="",
                        help="Opcjonalnie: lista osob oddzielona przecinkami (np. SA06,SA07).")
    parser.add_argument("--quiet", action="store_true",
                        help="Wycisz ostrzezenia.")
    args = parser.parse_args()

    subjects = [s.strip() for s in args.subjects.split(",") if s.strip()] or None
    verbose = not args.quiet

    X_chunks: List[np.ndarray] = []
    y_chunks: List[np.ndarray] = []
    subj_chunks: List[np.ndarray] = []

    n_trials = 0
    n_fall_trials = 0
    print(f"[INFO] Skanuje katalog: {os.path.abspath(args.data)}")
    for trial in utils.iter_kfall_trials(args.data, subjects=subjects, verbose=verbose):
        n_trials += 1
        if (trial.labels > 0).any():
            n_fall_trials += 1
        Xw, yw = utils.sliding_windows(trial.data, trial.labels,
                                       window_size=utils.WINDOW_SIZE,
                                       stride=utils.STRIDE)
        if Xw.shape[0] == 0:
            continue
        X_chunks.append(Xw)
        y_chunks.append(yw)
        subj_chunks.append(np.full(yw.shape[0], trial.subject, dtype=object))

    if not X_chunks:
        print("[BLAD] Nie znaleziono zadnych okien. Sprawdz sciezke --data.",
              file=sys.stderr)
        sys.exit(2)

    X = np.concatenate(X_chunks, axis=0).astype(np.float32)
    y = np.concatenate(y_chunks, axis=0).astype(np.int8)
    subjects_arr = np.concatenate(subj_chunks, axis=0)

    print(f"[INFO] Wczytano prob: {n_trials} (w tym upadkow: {n_fall_trials})")
    print(f"[INFO] Wygenerowano okien: {X.shape[0]} o ksztalcie {X.shape[1:]}")

    # Rozklad klas.
    counter = Counter(int(v) for v in y)
    total = sum(counter.values())
    print("[INFO] Rozklad klas okien:")
    for cls_idx, name in enumerate(utils.CLASS_NAMES):
        c = counter.get(cls_idx, 0)
        pct = (c / total * 100.0) if total else 0.0
        print(f"   {cls_idx} {name:<8}: {c:>7d} ({pct:5.2f} %)")

    # Ostrzezenie o niezbalansowaniu.
    if total > 0:
        worst = min(counter.get(i, 0) for i in range(len(utils.CLASS_NAMES)))
        best = max(counter.get(i, 0) for i in range(len(utils.CLASS_NAMES)))
        if worst == 0:
            print("[OSTRZEZENIE] Co najmniej jedna klasa ma 0 probek — model nie nauczy sie!",
                  file=sys.stderr)
        elif best / max(1, worst) > 20:
            print(f"[OSTRZEZENIE] Silne niezbalansowanie klas ({best}/{worst} > 20x). "
                  f"W 2_train.py zostanie uzyte compute_class_weight=balanced.",
                  file=sys.stderr)

    # Normalizacja z-score.
    mean, std = utils.fit_zscore(X)
    X_norm = utils.apply_zscore(X, mean, std)

    print(f"[INFO] mean (per kanal): {np.array2string(mean, precision=5)}")
    print(f"[INFO] std  (per kanal): {np.array2string(std,  precision=5)}")

    # Zapis.
    out_path = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    np.savez_compressed(
        out_path,
        X=X_norm,
        y=y,
        mean=mean,
        std=std,
        subjects=subjects_arr,
        window_size=np.int32(utils.WINDOW_SIZE),
        n_channels=np.int32(utils.N_CHANNELS),
        stride=np.int32(utils.STRIDE),
    )
    print(f"[OK] Zapisano: {out_path}")


if __name__ == "__main__":
    main()
