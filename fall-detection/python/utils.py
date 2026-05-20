"""Wspólne narzędzia dla pipeline'u wykrywania upadków."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class ProjectConfig:
    """Stałe projektu używane spójnie w Python i firmware."""

    window_size: int = 51
    n_channels: int = 6
    stride: int = 25
    post_impact: int = 50
    sample_rate_hz: int = 100
    class_names: tuple[str, str, str] = ("ADL", "PRE-FALL", "FALL")
    channel_names: tuple[str, ...] = (
        "AccX",
        "AccY",
        "AccZ",
        "GyrX",
        "GyrY",
        "GyrZ",
    )


CONFIG = ProjectConfig()


def canonical_column_name(name: str) -> str:
    """Upraszcza nazwę kolumny do porównania niezależnego od formatowania."""

    return re.sub(r"[^a-z0-9]", "", str(name).strip().lower())


def find_sensor_columns(df: pd.DataFrame) -> list[str]:
    """Znajduje kolumny 6-osiowe niezależnie od wariantu nazewnictwa."""

    required_aliases = {
        "accx": {"accx", "ax", "accelerationx", "linearaccelerationx"},
        "accy": {"accy", "ay", "accelerationy", "linearaccelerationy"},
        "accz": {"accz", "az", "accelerationz", "linearaccelerationz"},
        "gyrx": {"gyrx", "gyrox", "gx", "angularvelocityx"},
        "gyry": {"gyry", "gyroy", "gy", "angularvelocityy"},
        "gyrz": {"gyrz", "gyroz", "gz", "angularvelocityz"},
    }

    canonical_map = {canonical_column_name(col): col for col in df.columns}
    selected_columns: list[str] = []

    for key in ("accx", "accy", "accz", "gyrx", "gyry", "gyrz"):
        aliases = required_aliases[key]
        chosen = None
        for alias in aliases:
            if alias in canonical_map:
                chosen = canonical_map[alias]
                break
        if chosen is None:
            raise KeyError(
                f"Nie znaleziono kolumny dla kanału {key}. "
                f"Dostępne kolumny: {list(df.columns)}"
            )
        selected_columns.append(chosen)

    return selected_columns


def parse_trial_identifiers(csv_path: Path) -> tuple[int, int]:
    """
    Parsuje Task ID i Trial ID z nazwy pliku.

    Oczekiwany format KFall: SAxxTyyRzz.csv
    """

    match = re.search(r"T(\d+)R(\d+)", csv_path.stem, re.IGNORECASE)
    if not match:
        raise ValueError(
            f"Nie udało się sparsować Task/Trial z nazwy pliku: {csv_path.name}"
        )
    task_id = int(match.group(1))
    trial_id = int(match.group(2))
    return task_id, trial_id


def find_label_row(
    label_df: pd.DataFrame, task_id: int, trial_id: int
) -> pd.Series | None:
    """Zwraca wiersz etykiet dla konkretnego (Task ID, Trial ID)."""

    canonical = {canonical_column_name(col): col for col in label_df.columns}
    task_col = canonical.get("taskcode") or canonical.get("taskid")
    trial_col = canonical.get("trialid")
    onset_col = canonical.get("fallonsetframe")
    impact_col = canonical.get("fallimpactframe")

    if task_col is None or trial_col is None:
        raise KeyError(
            "Brakuje kolumn Task Code/Task ID albo Trial ID w pliku etykiet."
        )
    if onset_col is None or impact_col is None:
        raise KeyError(
            "Brakuje kolumn Fall_onset_frame lub Fall_impact_frame w pliku etykiet."
        )

    task_series = pd.to_numeric(label_df[task_col], errors="coerce")
    trial_series = pd.to_numeric(label_df[trial_col], errors="coerce")
    mask = (task_series == task_id) & (trial_series == trial_id)

    if not mask.any():
        return None
    return label_df.loc[mask].iloc[0]


def build_frame_labels(
    n_samples: int,
    onset_frame: float | int | None,
    impact_frame: float | int | None,
    post_impact: int = CONFIG.post_impact,
) -> np.ndarray:
    """
    Tworzy etykiety ramek:
      0 = ADL
      1 = PRE-FALL (od onset do impact-1)
      2 = FALL (od impact do impact+post_impact)
    """

    labels = np.zeros(n_samples, dtype=np.int64)

    if onset_frame is None or impact_frame is None:
        return labels
    if pd.isna(onset_frame) or pd.isna(impact_frame):
        return labels

    onset_idx = max(0, int(onset_frame) - 1)
    impact_idx = max(0, int(impact_frame) - 1)

    if onset_idx >= n_samples:
        return labels
    if impact_idx >= n_samples:
        impact_idx = n_samples - 1
    if impact_idx < onset_idx:
        onset_idx, impact_idx = impact_idx, onset_idx

    labels[onset_idx:impact_idx] = 1
    labels[impact_idx : min(n_samples, impact_idx + post_impact + 1)] = 2
    return labels


def sliding_windows(
    signal: np.ndarray,
    labels: np.ndarray,
    window_size: int = CONFIG.window_size,
    stride: int = CONFIG.stride,
) -> tuple[np.ndarray, np.ndarray]:
    """Tnie sygnał na okna i przypisuje etykietę ostatniej próbki okna."""

    if signal.shape[0] != labels.shape[0]:
        raise ValueError("Liczba próbek sygnału i etykiet musi być identyczna.")
    if signal.shape[0] < window_size:
        return (
            np.empty((0, window_size, signal.shape[1]), dtype=np.float32),
            np.empty((0,), dtype=np.int64),
        )

    windows: list[np.ndarray] = []
    win_labels: list[int] = []

    for start in range(0, signal.shape[0] - window_size + 1, stride):
        end = start + window_size
        windows.append(signal[start:end])
        # Etykieta okna = klasa ostatniej próbki (symulacja inferencji online)
        win_labels.append(int(labels[end - 1]))

    return np.asarray(windows, dtype=np.float32), np.asarray(win_labels, dtype=np.int64)


def class_distribution(y: np.ndarray) -> dict[int, int]:
    """Zwraca liczność klas jako słownik."""

    uniq, counts = np.unique(y, return_counts=True)
    return {int(k): int(v) for k, v in zip(uniq, counts)}


def detect_strong_imbalance(y: np.ndarray, threshold_ratio: float = 0.1) -> bool:
    """
    Wykrywa silną nierównowagę klas.

    threshold_ratio = minimalny udział najmniejszej klasy względem największej.
    """

    dist = class_distribution(y)
    if len(dist) < 2:
        return True
    max_count = max(dist.values())
    min_count = min(dist.values())
    return (min_count / max_count) < threshold_ratio


def ensure_parent_dir(path: Path) -> None:
    """Tworzy katalog nadrzędny jeśli nie istnieje."""

    path.parent.mkdir(parents=True, exist_ok=True)


def as_subject_code(path: Path) -> str:
    """Zwraca kod badanego z katalogu SAxx."""

    return path.name.upper()


def to_float32(arrays: Iterable[np.ndarray]) -> list[np.ndarray]:
    """Konwertuje listę tablic do float32."""

    return [np.asarray(a, dtype=np.float32) for a in arrays]
