"""Wspolne funkcje dla pipeline'u KFall -> okna -> model.

Modul celowo nie zalezy od TensorFlow, aby preprocessing i pomocnicze testy
daly sie uruchamiac szybko nawet na komputerze bez GPU.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd


# Stale projektu uzywane konsekwentnie w Pythonie i firmware.
WINDOW_SIZE = 51
N_CHANNELS = 6
STRIDE = 25
POST_IMPACT = 50
CLASS_NAMES = ("ADL", "PRE-FALL", "FALL")
CHANNELS = ("AccX", "AccY", "AccZ", "GyrX", "GyrY", "GyrZ")


@dataclass(frozen=True)
class TrialId:
    """Identyfikator proby KFall odczytany z nazwy pliku CSV."""

    subject: str
    task: int
    trial: int
    repetition: int


def parse_trial_id(csv_path: Path) -> TrialId:
    """Parsuje nazwe w formacie SAxxTyyRzz.csv.

    Przyklad: ``SA01T20R03.csv`` oznacza osobe SA01, zadanie 20 i probe 3.
    """

    match = re.match(r"^(SA\d+)T(\d+)R(\d+)\.csv$", csv_path.name, re.IGNORECASE)
    if not match:
        raise ValueError(f"Niepoprawna nazwa pliku KFall: {csv_path.name}")
    subject, task, trial = match.groups()
    return TrialId(
        subject=subject.upper(),
        task=int(task),
        trial=int(trial),
        repetition=int(trial),
    )


def _normalize_column_name(name: str) -> str:
    """Upraszcza nazwy kolumn, aby obsluzyc rozne warianty CSV KFall."""

    return re.sub(r"[^a-z0-9]", "", str(name).lower())


def find_imu_columns(df: pd.DataFrame) -> list[str]:
    """Zwraca kolumny odpowiadajace AccX/Y/Z i GyrX/Y/Z.

    Dataset KFall bywa opisywany roznymi naglowkami w zaleznosci od wersji
    eksportu. Zamiast wymagac jednej pisowni, mapujemy najczestsze warianty.
    """

    aliases = {
        "AccX": ("accx", "accxg", "accelerometerx", "ax"),
        "AccY": ("accy", "accyg", "accelerometery", "ay"),
        "AccZ": ("accz", "acczg", "accelerometerz", "az"),
        "GyrX": ("gyrx", "gyrxdps", "gyrox", "gyroscopex", "gx"),
        "GyrY": ("gyry", "gyrydps", "gyroy", "gyroscopey", "gy"),
        "GyrZ": ("gyrz", "gyrzdps", "gyroz", "gyroscopez", "gz"),
    }

    normalized = {_normalize_column_name(col): col for col in df.columns}
    selected: list[str] = []
    missing: list[str] = []

    for logical_name in CHANNELS:
        candidates = aliases[logical_name]
        found = next((normalized[a] for a in candidates if a in normalized), None)
        if found is None:
            missing.append(logical_name)
        else:
            selected.append(found)

    if missing:
        raise ValueError(
            "Brakuje kolumn IMU "
            f"{missing}. Dostepne kolumny: {list(df.columns)}"
        )
    return selected


def read_imu_csv(csv_path: Path) -> np.ndarray:
    """Czyta CSV KFall i zwraca macierz float32 (N, 6)."""

    df = pd.read_csv(csv_path)
    columns = find_imu_columns(df)
    values = df[columns].apply(pd.to_numeric, errors="coerce").to_numpy(np.float32)
    values = values[~np.isnan(values).any(axis=1)]
    if values.ndim != 2 or values.shape[1] != N_CHANNELS:
        raise ValueError(f"Niepoprawny ksztalt danych IMU w {csv_path}: {values.shape}")
    return values


def read_labels(label_path: Path) -> pd.DataFrame:
    """Czyta arkusz etykiet KFall i ujednolica nazwy kolumn."""

    df = pd.read_excel(label_path, engine="openpyxl")
    rename_map: dict[str, str] = {}
    for col in df.columns:
        norm = _normalize_column_name(col)
        if norm in {"taskcode", "taskid", "task"} or (
            "taskcode" in norm and "taskid" in norm
        ):
            rename_map[col] = "task"
        elif norm in {"trialid", "trial", "repetition", "rep"}:
            rename_map[col] = "trial"
        elif norm == "fallonsetframe":
            rename_map[col] = "onset"
        elif norm == "fallimpactframe":
            rename_map[col] = "impact"
    df = df.rename(columns=rename_map)

    required = {"task", "trial", "onset", "impact"}
    missing = required.difference(df.columns)
    if missing:
        raise ValueError(f"{label_path} nie zawiera kolumn: {sorted(missing)}")

    for col in required:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    return df


def labels_for_trial(n_samples: int, trial_id: TrialId, labels_df: pd.DataFrame | None) -> np.ndarray:
    """Buduje etykiety probek: 0 ADL, 1 PRE-FALL, 2 FALL.

    Jezeli dla pliku nie ma rekordu w arkuszu etykiet, traktujemy go jako ADL.
    Indeksy ramek KFall sa zwykle 1-based, dlatego odejmujemy 1 i ograniczamy
    zakres do dlugosci konkretnego CSV.
    """

    y = np.zeros(n_samples, dtype=np.int64)
    if labels_df is None or labels_df.empty:
        return y

    task_col = labels_df["task"].fillna(-1).astype(int)
    trial_col = labels_df["trial"].fillna(-1).astype(int)
    rows = labels_df[(task_col == trial_id.task) & (trial_col == trial_id.trial)]
    if rows.empty:
        return y

    row = rows.iloc[0]
    if pd.isna(row["onset"]) or pd.isna(row["impact"]):
        return y

    onset = max(int(row["onset"]) - 1, 0)
    impact = max(int(row["impact"]) - 1, 0)
    onset = min(onset, n_samples)
    impact = min(impact, n_samples)
    fall_end = min(impact + POST_IMPACT, n_samples)

    if onset < impact:
        y[onset:impact] = 1
    if impact < fall_end:
        y[impact:fall_end] = 2
    return y


def make_windows(
    signal: np.ndarray,
    labels: np.ndarray,
    subject: str,
    task: int,
    trial: int,
    window_size: int = WINDOW_SIZE,
    stride: int = STRIDE,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Tnie sygnal na okna, a etykiete bierze z ostatniej probki okna."""

    if len(signal) != len(labels):
        raise ValueError("Sygnal i etykiety musza miec taka sama dlugosc")
    if len(signal) < window_size:
        empty_x = np.empty((0, window_size, N_CHANNELS), dtype=np.float32)
        return (
            empty_x,
            np.empty((0,), dtype=np.int64),
            np.empty((0,), dtype="<U8"),
            np.empty((0,), dtype=np.int64),
            np.empty((0,), dtype=np.int64),
        )

    xs: list[np.ndarray] = []
    ys: list[int] = []
    subjects: list[str] = []
    tasks: list[int] = []
    trials: list[int] = []

    for start in range(0, len(signal) - window_size + 1, stride):
        end = start + window_size
        xs.append(signal[start:end])
        ys.append(int(labels[end - 1]))
        subjects.append(subject)
        tasks.append(task)
        trials.append(trial)

    return (
        np.stack(xs).astype(np.float32),
        np.asarray(ys, dtype=np.int64),
        np.asarray(subjects),
        np.asarray(tasks, dtype=np.int64),
        np.asarray(trials, dtype=np.int64),
    )


def zscore_fit(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Liczy mean/std per kanal na surowych oknach treningowych."""

    mean = x.reshape(-1, x.shape[-1]).mean(axis=0).astype(np.float32)
    std = x.reshape(-1, x.shape[-1]).std(axis=0).astype(np.float32)
    std = np.where(std < 1e-6, 1.0, std).astype(np.float32)
    return mean, std


def zscore_apply(x: np.ndarray, mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    """Stosuje normalizacje identyczna jak w firmware."""

    return ((x - mean.reshape(1, 1, -1)) / std.reshape(1, 1, -1)).astype(np.float32)


def print_class_distribution(y: np.ndarray, prefix: str = "Rozklad klas") -> None:
    """Wypisuje liczebnosc klas i ostrzezenie o silnym niezbalansowaniu."""

    counts = np.bincount(y.astype(np.int64), minlength=len(CLASS_NAMES))
    total = int(counts.sum())
    print(prefix)
    for idx, count in enumerate(counts):
        share = 100.0 * count / max(total, 1)
        print(f"  {idx} {CLASS_NAMES[idx]:8s}: {count:8d} ({share:6.2f}%)")

    nonzero = counts[counts > 0]
    if len(nonzero) > 1 and nonzero.max() / nonzero.min() > 10:
        print(
            "OSTRZEZENIE: klasy sa mocno niezbalansowane. "
            "W treningu koniecznie uzyj wag klas."
        )


def iter_sensor_csvs(kfall_root: Path) -> Iterable[Path]:
    """Iteruje po plikach sensor_data/SA*/SAxxTyyRzz.csv."""

    sensor_root = kfall_root / "sensor_data"
    if not sensor_root.exists():
        raise FileNotFoundError(f"Brak katalogu {sensor_root}")
    yield from sorted(sensor_root.glob("SA*/SA*T*R*.csv"))

