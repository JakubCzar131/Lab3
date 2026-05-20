#!/usr/bin/env python3
"""Trening modelu 1D-CNN + ewaluacja + eksport TFLite INT8."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import tensorflow as tf
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
from sklearn.utils.class_weight import compute_class_weight
from tensorflow import keras
from tensorflow.keras import layers

from utils import CONFIG, ensure_parent_dir


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Trening modelu wykrywania upadków.")
    parser.add_argument("--data", type=Path, required=True, help="Plik kfall_windows.npz")
    parser.add_argument(
        "--output-model",
        type=Path,
        default=Path("model.tflite"),
        help="Ścieżka wyjściowa modelu TFLite INT8.",
    )
    parser.add_argument(
        "--normalization-header",
        type=Path,
        default=Path("firmware/03_fall_detector/normalization.h"),
        help="Ścieżka wyjściowa normalization.h.",
    )
    parser.add_argument("--epochs", type=int, default=60, help="Maksymalna liczba epok.")
    parser.add_argument("--batch-size", type=int, default=128, help="Rozmiar batcha.")
    parser.add_argument(
        "--loso",
        action="store_true",
        help="Tryb Leave-One-Subject-Out (test na osobie nieobecnej w treningu).",
    )
    parser.add_argument(
        "--loso-subject",
        type=str,
        default=None,
        help="Kod osoby testowej w trybie LOSO, np. SA01.",
    )
    parser.add_argument("--seed", type=int, default=42, help="Losowe ziarno RNG.")
    return parser.parse_args()


def build_model() -> keras.Model:
    """Buduje mały model 1D-CNN (<50k parametrów)."""

    model = keras.Sequential(
        [
            layers.Input(shape=(CONFIG.window_size, CONFIG.n_channels)),
            layers.Conv1D(16, kernel_size=5, activation="relu", padding="same"),
            layers.MaxPooling1D(pool_size=2),
            layers.Conv1D(32, kernel_size=5, activation="relu", padding="same"),
            layers.MaxPooling1D(pool_size=2),
            layers.Conv1D(64, kernel_size=3, activation="relu", padding="same"),
            layers.GlobalAveragePooling1D(),
            layers.Dense(32, activation="relu"),
            layers.Dense(3, activation="softmax"),
        ]
    )
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def compute_balanced_class_weights(y_train: np.ndarray) -> dict[int, float]:
    """Liczy wagi klas; brakujące klasy dostają wagę 1.0."""

    weights = {0: 1.0, 1: 1.0, 2: 1.0}
    present_classes = np.unique(y_train)
    balanced = compute_class_weight(
        class_weight="balanced", classes=present_classes, y=y_train
    )
    for cls, w in zip(present_classes, balanced):
        weights[int(cls)] = float(w)
    return weights


def write_normalization_header(path: Path, mean: np.ndarray, std: np.ndarray) -> None:
    """Zapisuje mean/std do nagłówka C używanego przez firmware."""

    ensure_parent_dir(path)
    mean_values = ", ".join(f"{float(v):.9f}f" for v in mean.tolist())
    std_values = ", ".join(f"{float(v):.9f}f" for v in std.tolist())
    content = f"""#pragma once
// Ten plik jest generowany automatycznie przez python/2_train.py

constexpr int NORM_CHANNELS = 6;
const float NORM_MEAN[NORM_CHANNELS] = {{{mean_values}}};
const float NORM_STD[NORM_CHANNELS] = {{{std_values}}};
"""
    path.write_text(content, encoding="utf-8")


def convert_to_int8_tflite(model: keras.Model, x_train: np.ndarray) -> bytes:
    """Konwersja modelu Keras -> TFLite INT8 z representative dataset."""

    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]

    # Representative dataset stabilizuje zakresy kwantyzacji INT8.
    max_samples = min(500, x_train.shape[0])
    indices = np.linspace(0, x_train.shape[0] - 1, max_samples, dtype=int)
    calibration_data = x_train[indices]

    def representative_dataset():
        for sample in calibration_data:
            yield [sample[np.newaxis, ...].astype(np.float32)]

    converter.representative_dataset = representative_dataset
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    converter.inference_input_type = tf.int8
    converter.inference_output_type = tf.int8
    return converter.convert()


def split_train_test(
    X: np.ndarray,
    y: np.ndarray,
    subjects: np.ndarray | None,
    loso: bool,
    loso_subject: str | None,
    seed: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Dzieli dane na trening i test (random stratify lub LOSO)."""

    if loso:
        if subjects is None:
            raise ValueError(
                "Tryb --loso wymaga tablicy 'subjects' w pliku .npz "
                "(generowanej przez 1_preprocess.py)."
            )
        unique_subjects = sorted(np.unique(subjects))
        chosen_subject = (loso_subject or unique_subjects[-1]).upper()
        if chosen_subject not in unique_subjects:
            raise ValueError(
                f"Nie znaleziono osoby {chosen_subject}. Dostępne: {unique_subjects}"
            )

        test_mask = subjects == chosen_subject
        train_mask = ~test_mask
        if test_mask.sum() == 0 or train_mask.sum() == 0:
            raise ValueError("Niepoprawny podział LOSO: pusty train albo test.")

        print(f"[LOSO] Test subject: {chosen_subject}")
        print(f"[LOSO] Train windows: {int(train_mask.sum())}, Test windows: {int(test_mask.sum())}")
        return X[train_mask], X[test_mask], y[train_mask], y[test_mask]

    return train_test_split(
        X,
        y,
        test_size=0.2,
        random_state=seed,
        stratify=y,
    )


def main() -> None:
    args = parse_args()
    np.random.seed(args.seed)
    tf.random.set_seed(args.seed)

    data = np.load(args.data, allow_pickle=False)
    X = data["X"].astype(np.float32)
    y = data["y"].astype(np.int64)
    mean = data["mean"].astype(np.float32)
    std = data["std"].astype(np.float32)
    subjects = data["subjects"] if "subjects" in data.files else None

    if X.ndim != 3 or X.shape[1:] != (CONFIG.window_size, CONFIG.n_channels):
        raise ValueError(
            f"Oczekiwany kształt X=(N,{CONFIG.window_size},{CONFIG.n_channels}), "
            f"otrzymano: {X.shape}"
        )

    print("=== TRENING MODELU 1D-CNN ===")
    print(f"Dane: X={X.shape}, y={y.shape}")
    print(f"Klasy: {dict(zip(*np.unique(y, return_counts=True)))}")

    X_train, X_test, y_train, y_test = split_train_test(
        X=X,
        y=y,
        subjects=subjects,
        loso=args.loso,
        loso_subject=args.loso_subject,
        seed=args.seed,
    )

    class_weights = compute_balanced_class_weights(y_train)
    print(f"Wagi klas: {class_weights}")

    model = build_model()
    model.summary()
    n_params = model.count_params()
    print(f"Liczba parametrów: {n_params}")
    if n_params > 50_000:
        print("[UWAGA] Model przekracza 50k parametrów (sprawdź wymagania projektu).")

    callbacks = [
        keras.callbacks.EarlyStopping(
            monitor="val_loss",
            patience=5,
            restore_best_weights=True,
            verbose=1,
        )
    ]

    _ = model.fit(
        X_train,
        y_train,
        validation_split=0.2,
        epochs=args.epochs,
        batch_size=args.batch_size,
        class_weight=class_weights,
        callbacks=callbacks,
        verbose=2,
    )

    print("\n=== EWALUACJA ===")
    y_prob = model.predict(X_test, batch_size=256, verbose=0)
    y_pred = np.argmax(y_prob, axis=1)

    report_text = classification_report(
        y_test,
        y_pred,
        labels=[0, 1, 2],
        target_names=list(CONFIG.class_names),
        digits=4,
        zero_division=0,
    )
    report_dict = classification_report(
        y_test,
        y_pred,
        labels=[0, 1, 2],
        target_names=list(CONFIG.class_names),
        output_dict=True,
        zero_division=0,
    )
    cm = confusion_matrix(y_test, y_pred, labels=[0, 1, 2])

    print(report_text)
    print("Confusion matrix [ADL, PRE-FALL, FALL]:")
    print(cm)

    fall_f1 = float(report_dict["FALL"]["f1-score"])
    print(f"F1 (FALL): {fall_f1:.4f}")
    if fall_f1 < 0.85:
        print(
            "[UWAGA] F1(FALL) < 0.85. Sprawdź balans klas, hiperparametry, "
            "LOSO i jakość etykiet."
        )

    print("\n=== KWANTYZACJA INT8 (TFLite) ===")
    tflite_model = convert_to_int8_tflite(model, X_train)
    ensure_parent_dir(args.output_model)
    args.output_model.write_bytes(tflite_model)
    model_size_kb = len(tflite_model) / 1024.0
    print(f"Zapisano model: {args.output_model.resolve()} ({model_size_kb:.2f} KB)")
    if model_size_kb > 100:
        print("[UWAGA] model.tflite > 100 KB (rozważ uproszczenie modelu).")

    # Walidacja typu wejścia/wyjścia po konwersji.
    interpreter = tf.lite.Interpreter(model_content=tflite_model)
    interpreter.allocate_tensors()
    input_dtype = interpreter.get_input_details()[0]["dtype"]
    output_dtype = interpreter.get_output_details()[0]["dtype"]
    print(f"Typ wejścia TFLite: {input_dtype}, typ wyjścia TFLite: {output_dtype}")
    if input_dtype != np.int8 or output_dtype != np.int8:
        raise RuntimeError("Model po konwersji NIE ma INT8 na wejściu/wyjściu.")

    write_normalization_header(args.normalization_header, mean=mean, std=std)
    print(f"Zapisano normalization.h: {args.normalization_header.resolve()}")


if __name__ == "__main__":
    main()
