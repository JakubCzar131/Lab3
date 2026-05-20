"""Wspolne funkcje pipeline'u detekcji upadkow KFall.

Modul zawiera:
- stale projektu (WINDOW_SIZE, N_CHANNELS, STRIDE, POST_IMPACT, ETC.),
- funkcje wczytujace pliki KFall (CSV ruchu, XLSX etykiet),
- generator okien (sliding window) z etykieta wg OSTATNIEJ probki w oknie.

Stale sa duplikowane w komentarzach firmware'u (03_fall_detector.ino) — jesli
zmieniasz je tutaj, zaktualizuj rowniez naglowki w firmware.
"""

from __future__ import annotations

import os
import re
import glob
import sys
from dataclasses import dataclass
from typing import Iterable, List, Optional, Tuple

import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# Stale projektu — uzywane spojnie przez preprocess, train i firmware.
# ---------------------------------------------------------------------------
WINDOW_SIZE: int = 51        # ~500 ms przy 100 Hz
N_CHANNELS: int = 6          # AccX, AccY, AccZ, GyrX, GyrY, GyrZ
STRIDE: int = 25             # ~50% overlap przy treningu, ~250 ms w firmware
POST_IMPACT: int = 50        # ile probek po impact liczy sie jako FALL (klasa 2)
SAMPLE_RATE_HZ: int = 100    # czestotliwosc probkowania KFall

# Mapowanie nazw klas — kolejnosc jest istotna (zgodna z indeksem softmaxu).
CLASS_NAMES: Tuple[str, str, str] = ("ADL", "PRE-FALL", "FALL")

# Kolumny w plikach KFall sensor_data/*.csv (zgodnie z dokumentacja zbioru).
# Pierwsza kolumna to zwykle numer probki / czas — ignorujemy.
# Wykorzystujemy AccX/Y/Z (w g) oraz GyrX/Y/Z (w deg/s).
KFALL_ACC_COLS: Tuple[str, str, str] = ("AccX", "AccY", "AccZ")
KFALL_GYR_COLS: Tuple[str, str, str] = ("GyrX", "GyrY", "GyrZ")
KFALL_FEATURE_COLS: Tuple[str, ...] = KFALL_ACC_COLS + KFALL_GYR_COLS

# Numery Task ID, ktore w KFall odpowiadaja UPADKOM (reszta = ADL).
# Zrodlo: dokumentacja KFall (Task 20-34 to scenariusze upadkow).
FALL_TASK_IDS: Tuple[int, ...] = tuple(range(20, 35))


# ---------------------------------------------------------------------------
# Reprezentacja pojedynczej proby (jeden plik CSV ruchu).
# ---------------------------------------------------------------------------
@dataclass
class Trial:
    subject: str           # np. "SA06"
    task_id: int           # np. 20 (T20 -> upadek)
    trial_id: int          # np. 1 (R01)
    data: np.ndarray       # ksztalt (N, 6): kolumny AccX..GyrZ
    labels: np.ndarray     # ksztalt (N,): klasy 0/1/2 per probka


# ---------------------------------------------------------------------------
# Parsowanie nazwy pliku KFall typu "SA06T20R03.csv" -> (subject, task, trial)
# ---------------------------------------------------------------------------
_FNAME_RE = re.compile(r"^(SA\d+)T(\d+)R(\d+)\.csv$", re.IGNORECASE)


def parse_filename(filename: str) -> Optional[Tuple[str, int, int]]:
    """Zwraca (subject, task_id, trial_id) lub None gdy nazwa nietypowa."""
    m = _FNAME_RE.match(os.path.basename(filename))
    if not m:
        return None
    return m.group(1).upper(), int(m.group(2)), int(m.group(3))


# ---------------------------------------------------------------------------
# Wczytywanie etykiet z plikow Excel KFall.
# ---------------------------------------------------------------------------
def load_label_book(label_xlsx_path: str) -> pd.DataFrame:
    """Wczytuje plik etykiet KFall (SAxx_label.xlsx).

    Plik zawiera kolumny m.in.:
        Task Code (Task ID)  -> np. "F01 (20)" lub po prostu 20
        Trial ID             -> np. 1
        Fall_onset_frame     -> indeks probki rozpoczecia upadku
        Fall_impact_frame    -> indeks probki uderzenia
    """
    df = pd.read_excel(label_xlsx_path)
    # Normalizujemy nazwy kolumn (czasem maja spacje/wieleliter w stylu Title Case).
    df.columns = [str(c).strip() for c in df.columns]

    # KFall potrafi miec rozne warianty nazw — szukamy elastycznie.
    def _find_col(candidates: Iterable[str]) -> Optional[str]:
        for c in df.columns:
            for cand in candidates:
                if c.lower().replace(" ", "") == cand.lower().replace(" ", ""):
                    return c
        return None

    col_task = _find_col(["Task Code (Task ID)", "TaskID", "Task ID", "TaskCode"])
    col_trial = _find_col(["Trial ID", "TrialID", "Trial"])
    col_onset = _find_col(["Fall_onset_frame", "Onset", "FallOnsetFrame"])
    col_impact = _find_col(["Fall_impact_frame", "Impact", "FallImpactFrame"])

    if not all([col_task, col_trial, col_onset, col_impact]):
        raise ValueError(
            f"W pliku etykiet {label_xlsx_path} brakuje wymaganych kolumn. "
            f"Znalezione: {list(df.columns)}"
        )

    # Wyciagamy numer task z lancuchow typu "F01 (20)" -> 20.
    def _task_to_int(v) -> Optional[int]:
        if pd.isna(v):
            return None
        if isinstance(v, (int, np.integer)):
            return int(v)
        s = str(v)
        m = re.search(r"(\d+)\s*\)?\s*$", s)  # ostatnia liczba w stringu
        if m:
            return int(m.group(1))
        m = re.search(r"\d+", s)
        return int(m.group(0)) if m else None

    out = pd.DataFrame({
        "task_id": df[col_task].map(_task_to_int),
        "trial_id": pd.to_numeric(df[col_trial], errors="coerce").astype("Int64"),
        "onset": pd.to_numeric(df[col_onset], errors="coerce").astype("Int64"),
        "impact": pd.to_numeric(df[col_impact], errors="coerce").astype("Int64"),
    })
    out = out.dropna(subset=["task_id", "trial_id"]).reset_index(drop=True)
    return out


# ---------------------------------------------------------------------------
# Wczytywanie pliku CSV pojedynczej proby.
# ---------------------------------------------------------------------------
def load_sensor_csv(csv_path: str) -> np.ndarray:
    """Wczytuje sensor_data CSV i zwraca tablice (N, 6) z kolumnami acc+gyr.

    KFall CSV ma naglowki kolumn — uzywamy ich do wyboru osi.
    Jezeli ktoras kolumna ma inna nazwe niz oczekujemy, probujemy heurystyki:
    bierzemy pierwsze 3 kolumny zawierajace "acc" i pierwsze 3 z "gyr".
    """
    df = pd.read_csv(csv_path)
    # Najpierw probujemy nazwy z dokumentacji KFall.
    cols = list(df.columns)
    feature_cols: List[str] = []

    def _find(prefix_options: Iterable[str], suffix: str) -> Optional[str]:
        # np. ('acc',) + 'x' -> szukamy "AccX", "acc_x", "accelX" itd.
        for c in cols:
            cl = c.lower().replace("_", "").replace(" ", "")
            for p in prefix_options:
                if cl.startswith(p) and cl.endswith(suffix):
                    return c
        return None

    for axis in ("x", "y", "z"):
        c = _find(("acc", "accel"), axis)
        if c is None:
            raise ValueError(f"Nie znaleziono kolumny Acc{axis.upper()} w {csv_path}: {cols}")
        feature_cols.append(c)
    for axis in ("x", "y", "z"):
        c = _find(("gyr", "gyro"), axis)
        if c is None:
            raise ValueError(f"Nie znaleziono kolumny Gyr{axis.upper()} w {csv_path}: {cols}")
        feature_cols.append(c)

    data = df[feature_cols].to_numpy(dtype=np.float32)
    return data


# ---------------------------------------------------------------------------
# Etykietowanie probek wewnatrz jednego pliku ruchu.
# ---------------------------------------------------------------------------
def make_sample_labels(
    n_samples: int,
    is_fall: bool,
    onset: Optional[int],
    impact: Optional[int],
    post_impact: int = POST_IMPACT,
) -> np.ndarray:
    """Generuje wektor etykiet dlugosci n_samples zgodnie z zasada:

    - ADL: same zera (rowniez gdy is_fall=False).
    - PRE-FALL (1): probki w przedziale [onset, impact) — z wylaczeniem impact.
    - FALL (2): probki od impact do impact + post_impact (wlacznie z impact).
    - Reszta: ADL (0).
    """
    labels = np.zeros(n_samples, dtype=np.int8)
    if not is_fall:
        return labels
    if onset is None or impact is None:
        # Plik upadku bez poprawnych ramek — zwroc same zera + ostrzezenie.
        # Wybor: lepiej nie wprowadzac szumu, niz zgadywac.
        return labels
    onset = max(0, int(onset))
    impact = min(n_samples, int(impact))
    if onset < impact:
        labels[onset:impact] = 1
    end_fall = min(n_samples, impact + post_impact)
    if impact < end_fall:
        labels[impact:end_fall] = 2
    return labels


# ---------------------------------------------------------------------------
# Generator okien dla treningu.
# ---------------------------------------------------------------------------
def sliding_windows(
    data: np.ndarray,
    labels: np.ndarray,
    window_size: int = WINDOW_SIZE,
    stride: int = STRIDE,
) -> Tuple[np.ndarray, np.ndarray]:
    """Tnie sygnal oknem `window_size` ze skokiem `stride`.

    Etykieta okna = klasa OSTATNIEJ probki w oknie (symuluje inferencje online).
    """
    n = data.shape[0]
    if n < window_size:
        return (np.empty((0, window_size, data.shape[1]), dtype=data.dtype),
                np.empty((0,), dtype=labels.dtype))
    n_win = 1 + (n - window_size) // stride
    X = np.empty((n_win, window_size, data.shape[1]), dtype=data.dtype)
    y = np.empty((n_win,), dtype=labels.dtype)
    for i in range(n_win):
        s = i * stride
        e = s + window_size
        X[i] = data[s:e]
        y[i] = labels[e - 1]   # klasa ostatniej probki w oknie
    return X, y


# ---------------------------------------------------------------------------
# Iterator po wszystkich probach KFall w katalogu.
# ---------------------------------------------------------------------------
def iter_kfall_trials(
    kfall_root: str,
    subjects: Optional[Iterable[str]] = None,
    verbose: bool = True,
) -> Iterable[Trial]:
    """Iteruje po wszystkich probach KFall.

    Struktura zbioru oczekiwana:
        kfall_root/
            sensor_data/SAxx/SAxxTyyRzz.csv
            label_data/SAxx_label.xlsx
    """
    sensor_root = os.path.join(kfall_root, "sensor_data")
    label_root = os.path.join(kfall_root, "label_data")
    if not os.path.isdir(sensor_root):
        raise FileNotFoundError(
            f"Brak katalogu {sensor_root}. Pobierz KFall i ustaw --data poprawnie."
        )

    # Lista folderow z osobami badanymi: SA06, SA07, ...
    subject_dirs = sorted(
        d for d in os.listdir(sensor_root)
        if os.path.isdir(os.path.join(sensor_root, d)) and d.upper().startswith("SA")
    )
    if subjects:
        wanted = {s.upper() for s in subjects}
        subject_dirs = [d for d in subject_dirs if d.upper() in wanted]

    for subject in subject_dirs:
        subj_dir = os.path.join(sensor_root, subject)
        label_path = os.path.join(label_root, f"{subject}_label.xlsx")
        labels_df: Optional[pd.DataFrame] = None
        if os.path.isfile(label_path):
            try:
                labels_df = load_label_book(label_path)
            except Exception as exc:
                if verbose:
                    print(f"[WARN] {label_path}: {exc}", file=sys.stderr)
                labels_df = None
        elif verbose:
            print(f"[WARN] Brak {label_path} — pliki SA upadkow tej osoby beda pominiete.",
                  file=sys.stderr)

        for csv_path in sorted(glob.glob(os.path.join(subj_dir, "*.csv"))):
            parsed = parse_filename(csv_path)
            if parsed is None:
                continue
            subj, task_id, trial_id = parsed
            is_fall = task_id in FALL_TASK_IDS

            try:
                data = load_sensor_csv(csv_path)
            except Exception as exc:
                if verbose:
                    print(f"[WARN] {csv_path}: {exc}", file=sys.stderr)
                continue

            onset: Optional[int] = None
            impact: Optional[int] = None
            if is_fall and labels_df is not None:
                row = labels_df[
                    (labels_df["task_id"] == task_id) &
                    (labels_df["trial_id"] == trial_id)
                ]
                if len(row) > 0:
                    onset = int(row["onset"].iloc[0]) if not pd.isna(row["onset"].iloc[0]) else None
                    impact = int(row["impact"].iloc[0]) if not pd.isna(row["impact"].iloc[0]) else None
                elif verbose:
                    print(f"[WARN] Brak etykiety dla {csv_path} (T{task_id}R{trial_id}) — pomijam.",
                          file=sys.stderr)
                    continue

            labels = make_sample_labels(data.shape[0], is_fall, onset, impact)
            yield Trial(subject=subj, task_id=task_id, trial_id=trial_id,
                        data=data, labels=labels)


# ---------------------------------------------------------------------------
# Normalizacja z-score (per kanal).
# ---------------------------------------------------------------------------
def fit_zscore(X: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """Liczy mean/std per kanal po wymiarach (probki, czas).

    X o ksztalcie (N, T, C) -> mean,std o ksztalcie (C,).
    Std jest podlogowany 1e-6, zeby uniknac dzielenia przez zero.
    """
    mean = X.mean(axis=(0, 1))
    std = X.std(axis=(0, 1))
    std = np.where(std < 1e-6, 1.0, std)
    return mean.astype(np.float32), std.astype(np.float32)


def apply_zscore(X: np.ndarray, mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    return ((X - mean) / std).astype(np.float32)
