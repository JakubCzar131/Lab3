#!/usr/bin/env python3
"""
Preprocessing KFall:
CSV + XLSX -> okna (N, 51, 6) z etykietami ADL/PRE-FALL/FALL.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from utils import (
    CONFIG,
    as_subject_code,
    build_frame_labels,
    canonical_column_name,
    class_distribution,
    detect_strong_imbalance,
    ensure_parent_dir,
    find_label_row,
    find_sensor_columns,
    parse_trial_identifiers,
    sliding_windows,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="KFall preprocessing: tworzenie okien i etykiet do treningu."
    )
    parser.add_argument(
        "--dataset-root",
        type=Path,
        required=True,
        help="Ścieżka do katalogu kfall/ (z sensor_data i label_data).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("kfall_windows.npz"),
        help="Plik wyjściowy NPZ.",
    )
    return parser.parse_args()


def get_label_columns(label_df: pd.DataFrame) -> tuple[str, str]:
    """Zwraca nazwy kolumn onset/impact niezależnie od wariantu zapisu."""

    canonical = {canonical_column_name(col): col for col in label_df.columns}
    onset_col = canonical.get("fallonsetframe")
    impact_col = canonical.get("fallimpactframe")
    if onset_col is None or impact_col is None:
        raise KeyError(
            "W pliku etykiet brak kolumn Fall_onset_frame/Fall_impact_frame."
        )
    return onset_col, impact_col


def main() -> None:
    args = parse_args()
    dataset_root = args.dataset_root
    sensor_root = dataset_root / "sensor_data"
    label_root = dataset_root / "label_data"

    if not sensor_root.exists():
        raise FileNotFoundError(f"Nie znaleziono katalogu: {sensor_root}")
    if not label_root.exists():
        raise FileNotFoundError(f"Nie znaleziono katalogu: {label_root}")

    print("=== PREPROCESSING KFall ===")
    print(f"Dataset: {dataset_root.resolve()}")
    print(
        "Parametry: "
        f"WINDOW_SIZE={CONFIG.window_size}, STRIDE={CONFIG.stride}, "
        f"POST_IMPACT={CONFIG.post_impact}, N_CHANNELS={CONFIG.n_channels}"
    )

    records: list[dict[str, object]] = []
    all_signal_samples: list[np.ndarray] = []
    files_processed = 0

    subject_dirs = sorted(p for p in sensor_root.iterdir() if p.is_dir() and p.name.startswith("SA"))
    if not subject_dirs:
        raise RuntimeError(f"Brak katalogów SA* w {sensor_root}")

    for subject_dir in subject_dirs:
        subject_code = as_subject_code(subject_dir)
        label_path = label_root / f"{subject_code}_label.xlsx"
        if not label_path.exists():
            print(f"[UWAGA] Brak etykiet dla {subject_code}: {label_path}")
            continue

        label_df = pd.read_excel(label_path, engine="openpyxl")
        onset_col, impact_col = get_label_columns(label_df)

        csv_files = sorted(subject_dir.glob("*.csv"))
        if not csv_files:
            print(f"[UWAGA] Brak plików CSV dla {subject_code} w {subject_dir}")
            continue

        for csv_path in csv_files:
            df = pd.read_csv(csv_path)
            sensor_cols = find_sensor_columns(df)
            signal_df = df[sensor_cols].apply(pd.to_numeric, errors="coerce")
            # Uzupełnienie braków liczbowych, aby zachować stałą długość sekwencji.
            signal_df = signal_df.interpolate(limit_direction="both").fillna(0.0)
            signal = signal_df.to_numpy(dtype=np.float32)

            task_id, trial_id = parse_trial_identifiers(csv_path)
            row = find_label_row(label_df, task_id=task_id, trial_id=trial_id)
            onset_frame = None
            impact_frame = None
            if row is not None:
                onset_frame = row[onset_col]
                impact_frame = row[impact_col]

            frame_labels = build_frame_labels(
                n_samples=signal.shape[0],
                onset_frame=onset_frame,
                impact_frame=impact_frame,
                post_impact=CONFIG.post_impact,
            )

            records.append(
                {
                    "subject": subject_code,
                    "file": str(csv_path),
                    "signal": signal,
                    "labels": frame_labels,
                }
            )
            all_signal_samples.append(signal)
            files_processed += 1

    if not records:
        raise RuntimeError("Nie udało się wczytać żadnych danych treningowych.")

    global_signal = np.concatenate(all_signal_samples, axis=0)
    mean = np.mean(global_signal, axis=0).astype(np.float32)
    std = np.std(global_signal, axis=0).astype(np.float32)
    std = np.where(std < 1e-8, 1.0, std).astype(np.float32)

    windows_all: list[np.ndarray] = []
    labels_all: list[np.ndarray] = []
    subjects_all: list[str] = []

    for rec in records:
        signal = rec["signal"]  # type: ignore[assignment]
        labels = rec["labels"]  # type: ignore[assignment]
        subject = rec["subject"]  # type: ignore[assignment]

        signal_norm = (signal - mean) / std
        windows, win_labels = sliding_windows(
            signal=signal_norm,
            labels=labels,
            window_size=CONFIG.window_size,
            stride=CONFIG.stride,
        )
        if windows.shape[0] == 0:
            continue

        windows_all.append(windows)
        labels_all.append(win_labels)
        subjects_all.extend([subject] * win_labels.shape[0])

    if not windows_all:
        raise RuntimeError("Nie utworzono żadnego okna. Sprawdź długości sygnałów.")

    X = np.concatenate(windows_all, axis=0).astype(np.float32)
    y = np.concatenate(labels_all, axis=0).astype(np.int64)
    subjects = np.asarray(subjects_all)

    ensure_parent_dir(args.output)
    np.savez_compressed(args.output, X=X, y=y, mean=mean, std=std, subjects=subjects)

    dist = class_distribution(y)
    total = int(y.shape[0])
    print("\n=== PODSUMOWANIE ===")
    print(f"Plików CSV przetworzonych: {files_processed}")
    print(f"Liczba okien: {X.shape[0]}")
    print(f"Kształt X: {X.shape} | y: {y.shape}")
    print(f"Zapisano: {args.output.resolve()}")
    print("Rozkład klas (po oknach):")
    for cls_id, cls_name in enumerate(CONFIG.class_names):
        count = dist.get(cls_id, 0)
        ratio = (count / total) * 100.0 if total else 0.0
        print(f"  {cls_id} ({cls_name}): {count} ({ratio:.2f}%)")

    if detect_strong_imbalance(y):
        print(
            "[OSTRZEŻENIE] Silnie niezbalansowane klasy. "
            "W treningu koniecznie użyj wag klas."
        )


if __name__ == "__main__":
    main()
