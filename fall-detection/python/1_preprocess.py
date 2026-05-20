#!/usr/bin/env python3
"""Preprocessing datasetu KFall do okien czasowych dla 1D-CNN.

Wyjscie ``kfall_windows.npz`` zawiera:

- ``X``: znormalizowane okna (N, 51, 6),
- ``y``: etykiety okien 0/1/2,
- ``mean`` i ``std``: parametry z-score konieczne w firmware,
- ``subjects``: osoba KFall dla kazdego okna, potrzebna do LOSO.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from utils import (
    CLASS_NAMES,
    make_windows,
    iter_sensor_csvs,
    labels_for_trial,
    parse_trial_id,
    print_class_distribution,
    read_imu_csv,
    read_labels,
    zscore_apply,
    zscore_fit,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="KFall CSV+XLSX -> okna .npz")
    parser.add_argument(
        "--kfall-root",
        type=Path,
        required=True,
        help="Katalog z podkatalogami sensor_data/ i label_data/.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("kfall_windows.npz"),
        help="Sciezka wyjsciowego pliku .npz.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    label_cache: dict[str, object] = {}

    all_x: list[np.ndarray] = []
    all_y: list[np.ndarray] = []
    all_subjects: list[np.ndarray] = []
    all_tasks: list[np.ndarray] = []
    all_trials: list[np.ndarray] = []

    csv_paths = list(iter_sensor_csvs(args.kfall_root))
    if not csv_paths:
        raise FileNotFoundError("Nie znaleziono plikow CSV KFall.")

    for csv_path in csv_paths:
        trial_id = parse_trial_id(csv_path)
        label_path = args.kfall_root / "label_data" / f"{trial_id.subject}_label.xlsx"

        if trial_id.subject not in label_cache:
            if label_path.exists():
                label_cache[trial_id.subject] = read_labels(label_path)
            else:
                print(f"UWAGA: brak {label_path}; pliki {trial_id.subject} beda ADL.")
                label_cache[trial_id.subject] = None

        signal = read_imu_csv(csv_path)
        sample_labels = labels_for_trial(
            n_samples=len(signal),
            trial_id=trial_id,
            labels_df=label_cache[trial_id.subject],
        )
        x_win, y_win, subjects, tasks, trials = make_windows(
            signal=signal,
            labels=sample_labels,
            subject=trial_id.subject,
            task=trial_id.task,
            trial=trial_id.trial,
        )

        if len(y_win) == 0:
            print(f"UWAGA: pominieto za krotki plik {csv_path}")
            continue

        all_x.append(x_win)
        all_y.append(y_win)
        all_subjects.append(subjects)
        all_tasks.append(tasks)
        all_trials.append(trials)

    if not all_x:
        raise RuntimeError("Nie utworzono zadnego okna.")

    x_raw = np.concatenate(all_x, axis=0).astype(np.float32)
    y = np.concatenate(all_y, axis=0).astype(np.int64)
    subjects = np.concatenate(all_subjects, axis=0)
    tasks = np.concatenate(all_tasks, axis=0)
    trials = np.concatenate(all_trials, axis=0)

    mean, std = zscore_fit(x_raw)
    x_norm = zscore_apply(x_raw, mean, std)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.output,
        X=x_norm,
        y=y,
        mean=mean,
        std=std,
        subjects=subjects,
        tasks=tasks,
        trials=trials,
        class_names=np.asarray(CLASS_NAMES),
    )

    print(f"Zapisano: {args.output}")
    print(f"Ksztalt X: {x_norm.shape}, y: {y.shape}")
    print(f"mean: {mean}")
    print(f"std : {std}")
    print_class_distribution(y)


if __name__ == "__main__":
    main()

