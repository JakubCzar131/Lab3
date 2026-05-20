"""Trening 1D-CNN do klasyfikacji ADL / PRE-FALL / FALL.

Wejscie:  kfall_windows.npz (z 1_preprocess.py)
Wyjscie:  model.tflite (INT8) + normalization.h dla firmware'u

Architektura sieci (zachowawcza, < 50k parametrow):
    Conv1D(16, kernel=5, ReLU) -> MaxPool(2)
    Conv1D(32, kernel=5, ReLU) -> MaxPool(2)
    Conv1D(64, kernel=3, ReLU)
    GlobalAveragePooling1D
    Dense(32, ReLU) -> Dropout(0.3)
    Dense(3, softmax)

Kluczowe rzeczy w treningu (do obrony pracy):
- compute_class_weight("balanced") — bez tego klasa ADL dominuje.
- EarlyStopping(monitor="val_loss", patience=5, restore_best_weights=True).
- Kwantyzacja INT8 z representative_dataset (200 okien z treningu).
- inference_input_type i output_type ustawione na tf.int8 -> model dziala
  bez konwersji float w TFLM (mniejszy RAM, szybciej).
- Opcja --loso: leave-one-subject-out (osoba testowa nie wystepuje w treningu).

Uzycie:
    python 2_train.py --in ../kfall_windows.npz \
                      --out_model ../model.tflite \
                      --out_header ../firmware/03_fall_detector/normalization.h \
                      [--loso]
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Optional, Tuple

import numpy as np

# ---------------------------------------------------------------------------
# TensorFlow jest "ciezki" do importu — robimy to leniwie wewnatrz main().
# ---------------------------------------------------------------------------

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import utils  # noqa: E402


# ---------------------------------------------------------------------------
# Argumenty CLI
# ---------------------------------------------------------------------------
def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Trening 1D-CNN -> TFLite INT8")
    # 'in' jest slowem kluczowym w Pythonie - dodajemy alias.
    p.add_argument("--in", dest="inp", type=str, default="../kfall_windows.npz",
                   help="Sciezka do .npz z 1_preprocess.py")
    p.add_argument("--out_model", type=str, default="../model.tflite",
                   help="Sciezka wyjsciowa modelu TFLite INT8")
    p.add_argument("--out_header", type=str,
                   default="../firmware/03_fall_detector/normalization.h",
                   help="Sciezka wyjsciowa naglowka C z NORM_MEAN/NORM_STD")
    p.add_argument("--epochs", type=int, default=40)
    p.add_argument("--batch", type=int, default=64)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--loso", action="store_true",
                   help="Leave-One-Subject-Out: test na osobie nieobecnej w treningu.")
    p.add_argument("--loso_subject", type=str, default="",
                   help="Konkretna osoba do testu LOSO (np. SA20). Domyslnie wybiera ostatnia.")
    return p.parse_args()


# ---------------------------------------------------------------------------
# Definicja modelu — szczegolowo opisana, zeby latwo bylo bronic kazdej warstwy.
# ---------------------------------------------------------------------------
def build_model(window_size: int, n_channels: int, n_classes: int):
    import tensorflow as tf
    from tensorflow.keras import layers, models

    inp = layers.Input(shape=(window_size, n_channels), name="window")

    # Pierwsza warstwa Conv1D: szuka krotkich wzorcow ~50 ms (kernel=5 @ 100 Hz).
    x = layers.Conv1D(16, kernel_size=5, padding="same", activation="relu")(inp)
    x = layers.MaxPooling1D(pool_size=2)(x)

    # Druga: szuka wzorcow srednio-czasowych (~100 ms).
    x = layers.Conv1D(32, kernel_size=5, padding="same", activation="relu")(x)
    x = layers.MaxPooling1D(pool_size=2)(x)

    # Trzecia: drobne uszczegolowienie cech.
    x = layers.Conv1D(64, kernel_size=3, padding="same", activation="relu")(x)

    # Global pooling -> mocno zmniejsza liczbe parametrow Dense.
    x = layers.GlobalAveragePooling1D()(x)

    x = layers.Dense(32, activation="relu")(x)
    x = layers.Dropout(0.3)(x)
    out = layers.Dense(n_classes, activation="softmax", name="probs")(x)

    model = models.Model(inputs=inp, outputs=out, name="FallCNN")
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


# ---------------------------------------------------------------------------
# Split: losowy stratify lub Leave-One-Subject-Out
# ---------------------------------------------------------------------------
def split_indices(
    y: np.ndarray,
    subjects: np.ndarray,
    loso: bool,
    loso_subject: str,
    seed: int,
) -> Tuple[np.ndarray, np.ndarray, Optional[str]]:
    from sklearn.model_selection import train_test_split

    if loso:
        unique_subj = sorted(set(map(str, subjects.tolist())))
        test_subj = loso_subject.upper() if loso_subject else unique_subj[-1]
        if test_subj not in unique_subj:
            raise ValueError(
                f"LOSO: osoba {test_subj} nie wystepuje w danych. Dostepne: {unique_subj}"
            )
        idx_test = np.where(subjects == test_subj)[0]
        idx_train = np.where(subjects != test_subj)[0]
        return idx_train, idx_test, test_subj

    idx_all = np.arange(len(y))
    idx_train, idx_test = train_test_split(
        idx_all, test_size=0.2, stratify=y, random_state=seed
    )
    return idx_train, idx_test, None


# ---------------------------------------------------------------------------
# Reprezentacyjny dataset do INT8 (~200 okien z treningu).
# ---------------------------------------------------------------------------
def make_representative_dataset(X_train: np.ndarray, n_samples: int = 200):
    rng = np.random.default_rng(0)
    idx = rng.choice(X_train.shape[0], size=min(n_samples, X_train.shape[0]),
                     replace=False)

    def gen():
        for i in idx:
            sample = X_train[i:i + 1].astype(np.float32)
            yield [sample]

    return gen


# ---------------------------------------------------------------------------
# Generowanie naglowka normalization.h dla firmware'u.
# ---------------------------------------------------------------------------
def write_normalization_header(
    path: str,
    mean: np.ndarray,
    std: np.ndarray,
    window_size: int,
    n_channels: int,
) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    assert mean.shape == (n_channels,) and std.shape == (n_channels,)

    def _fmt(arr: np.ndarray) -> str:
        return ", ".join(f"{v:.8f}f" for v in arr.tolist())

    content = f"""// Wygenerowane automatycznie przez 2_train.py — NIE EDYTOWAC RECZNIE.
// Mean/std z-score uzyte podczas treningu. Firmware MUSI uzywac dokladnie
// tych samych wartosci, inaczej model bedzie zawsze zwracal ADL.
#pragma once

#define NORM_WINDOW_SIZE   {window_size}
#define NORM_N_CHANNELS    {n_channels}

static const float NORM_MEAN[NORM_N_CHANNELS] = {{ {_fmt(mean)} }};
static const float NORM_STD[NORM_N_CHANNELS]  = {{ {_fmt(std)} }};
"""
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"[OK] Zapisano naglowek normalizacji: {path}")


# ---------------------------------------------------------------------------
# Konwersja Keras -> TFLite INT8.
# ---------------------------------------------------------------------------
def convert_to_tflite_int8(model, X_train: np.ndarray, out_path: str) -> int:
    import tensorflow as tf

    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.representative_dataset = make_representative_dataset(X_train)
    # Wymuszamy pelne INT8 (tez na wejsciu i wyjsciu) — wymagane przez TFLM.
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    converter.inference_input_type = tf.int8
    converter.inference_output_type = tf.int8

    tflite_bytes = converter.convert()
    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(tflite_bytes)
    print(f"[OK] Zapisano model TFLite INT8: {out_path}  ({len(tflite_bytes)} B)")
    return len(tflite_bytes)


# ---------------------------------------------------------------------------
# Glowna logika
# ---------------------------------------------------------------------------
def main() -> None:
    args = _parse_args()

    import tensorflow as tf
    from sklearn.utils.class_weight import compute_class_weight
    from sklearn.metrics import classification_report, confusion_matrix, f1_score

    np.random.seed(args.seed)
    tf.random.set_seed(args.seed)

    npz = np.load(args.inp, allow_pickle=True)
    X = npz["X"].astype(np.float32)
    y = npz["y"].astype(np.int64)
    mean = npz["mean"].astype(np.float32)
    std = npz["std"].astype(np.float32)
    subjects = npz["subjects"]
    window_size = int(npz["window_size"])
    n_channels = int(npz["n_channels"])

    print(f"[INFO] Dane: X={X.shape}, y={y.shape}, klasy={sorted(set(y.tolist()))}")
    print(f"[INFO] mean={mean}, std={std}")

    idx_train, idx_test, loso_subj = split_indices(
        y, subjects, loso=args.loso, loso_subject=args.loso_subject, seed=args.seed
    )
    if loso_subj:
        print(f"[INFO] LOSO: osoba testowa = {loso_subj}")
    X_train, y_train = X[idx_train], y[idx_train]
    X_test, y_test = X[idx_test], y[idx_test]
    print(f"[INFO] Train: {X_train.shape[0]} okien, Test: {X_test.shape[0]} okien")

    # ----------------------- Wagi klas ------------------------------------
    classes_present = np.unique(y_train)
    class_weights_arr = compute_class_weight(
        class_weight="balanced", classes=classes_present, y=y_train
    )
    class_weight = {int(c): float(w) for c, w in zip(classes_present, class_weights_arr)}
    # Klasy nieobecne w train (np. brak FALL gdy dane uciete) -> waga 1.0.
    for c in range(len(utils.CLASS_NAMES)):
        class_weight.setdefault(c, 1.0)
    print(f"[INFO] class_weight = {class_weight}")

    # ----------------------- Model i trening ------------------------------
    model = build_model(window_size, n_channels, n_classes=len(utils.CLASS_NAMES))
    model.summary(print_fn=lambda s: print("[MODEL]", s))

    callbacks = [
        tf.keras.callbacks.EarlyStopping(
            monitor="val_loss", patience=5, restore_best_weights=True
        ),
        tf.keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss", factor=0.5, patience=3, min_lr=1e-5, verbose=1
        ),
    ]

    history = model.fit(
        X_train, y_train,
        validation_data=(X_test, y_test),
        epochs=args.epochs,
        batch_size=args.batch,
        class_weight=class_weight,
        callbacks=callbacks,
        verbose=2,
    )
    del history  # zachowujemy w razie dopisania wykresow

    # ----------------------- Ewaluacja ------------------------------------
    y_pred = np.argmax(model.predict(X_test, batch_size=args.batch, verbose=0), axis=1)
    print("\n[RAPORT KLASYFIKACJI]")
    print(classification_report(
        y_test, y_pred,
        labels=list(range(len(utils.CLASS_NAMES))),
        target_names=list(utils.CLASS_NAMES),
        digits=4, zero_division=0,
    ))
    print("[MACIERZ POMYLEK] (wiersze = prawdziwe, kolumny = predykcja)")
    cm = confusion_matrix(y_test, y_pred, labels=list(range(len(utils.CLASS_NAMES))))
    header = "          " + " ".join(f"{n:>10s}" for n in utils.CLASS_NAMES)
    print(header)
    for i, row in enumerate(cm):
        print(f"{utils.CLASS_NAMES[i]:>10s} " + " ".join(f"{v:>10d}" for v in row))

    f1_fall = f1_score(y_test, y_pred, labels=[2], average="macro", zero_division=0)
    print(f"\n[KLUCZOWA METRYKA] F1 dla klasy FALL = {f1_fall:.4f}")
    if f1_fall < 0.85:
        print("[OSTRZEZENIE] F1(FALL) < 0.85 — rozwaz: wiekszy POST_IMPACT, oversampling, LOSO.")

    # ----------------------- Eksport TFLite INT8 --------------------------
    size_bytes = convert_to_tflite_int8(model, X_train, args.out_model)
    if size_bytes > 100 * 1024:
        print(f"[OSTRZEZENIE] Model > 100 KB ({size_bytes} B). "
              f"Zmniejsz filtry/dense jesli to problem dla TFLM.")

    # ----------------------- Naglowek normalizacji ------------------------
    write_normalization_header(
        args.out_header, mean=mean, std=std,
        window_size=window_size, n_channels=n_channels,
    )

    print("\n[OK] Trening zakonczony.")
    print(f"     model.tflite       : {os.path.abspath(args.out_model)}")
    print(f"     normalization.h    : {os.path.abspath(args.out_header)}")
    print( "     -> teraz uruchom 3_export_header.py i wgraj firmware 03_fall_detector.")


if __name__ == "__main__":
    main()
