#!/usr/bin/env python3
"""Trening malego 1D-CNN oraz eksport TFLite INT8.

Najwazniejsze elementy dla tego projektu:

- split stratified 80/20 albo LOSO,
- wagi klas ``compute_class_weight("balanced")``,
- model ponizej 50k parametrow,
- kwantyzacja pelna INT8 z representative dataset,
- eksport ``normalization.h`` dla firmware.
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

import numpy as np
import tensorflow as tf
from sklearn.metrics import classification_report, confusion_matrix, f1_score
from sklearn.model_selection import train_test_split
from sklearn.utils.class_weight import compute_class_weight

from utils import CLASS_NAMES, N_CHANNELS, WINDOW_SIZE, print_class_distribution


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Trening 1D-CNN dla KFall")
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("kfall_windows.npz"),
        help="Plik .npz z preprocessingiem.",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("build"),
        help="Katalog na model.keras, model.tflite i normalization.h.",
    )
    parser.add_argument(
        "--loso",
        nargs="?",
        const="auto",
        default=None,
        help=(
            "Leave-one-subject-out. Podaj np. SA01 albo uzyj samego --loso, "
            "aby wybrac pierwsza osobe z danych."
        ),
    )
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def build_model() -> tf.keras.Model:
    """Buduje maly model 1D-CNN zgodny z TFLite Micro."""

    model = tf.keras.Sequential(
        [
            tf.keras.layers.Input(shape=(WINDOW_SIZE, N_CHANNELS)),
            tf.keras.layers.Conv1D(16, 5, activation="relu", padding="same"),
            tf.keras.layers.MaxPooling1D(pool_size=2),
            tf.keras.layers.Conv1D(32, 5, activation="relu", padding="same"),
            tf.keras.layers.MaxPooling1D(pool_size=2),
            tf.keras.layers.Conv1D(64, 3, activation="relu", padding="same"),
            tf.keras.layers.GlobalAveragePooling1D(),
            tf.keras.layers.Dense(32, activation="relu"),
            tf.keras.layers.Dense(len(CLASS_NAMES), activation="softmax"),
        ]
    )
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def split_data(
    x: np.ndarray,
    y: np.ndarray,
    subjects: np.ndarray,
    loso: str | None,
    seed: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Wybiera split random stratified albo leave-one-subject-out."""

    if loso is None:
        return train_test_split(
            x,
            y,
            test_size=0.2,
            random_state=seed,
            stratify=y,
        )

    unique_subjects = np.unique(subjects)
    if len(unique_subjects) < 2:
        raise ValueError("LOSO wymaga danych z co najmniej dwoch osob.")
    test_subject = str(unique_subjects[0]) if loso == "auto" else loso.upper()
    if test_subject not in unique_subjects:
        raise ValueError(
            f"Nie znaleziono osoby {test_subject}. Dostepne: {list(unique_subjects)}"
        )

    test_mask = subjects == test_subject
    train_mask = ~test_mask
    print(f"LOSO: test na osobie {test_subject}")
    return x[train_mask], x[test_mask], y[train_mask], y[test_mask]


def representative_dataset(x_train: np.ndarray):
    """Generator probek kalibracyjnych dla pelnej kwantyzacji INT8."""

    count = min(500, len(x_train))
    for sample in x_train[:count]:
        yield [sample.reshape(1, WINDOW_SIZE, N_CHANNELS).astype(np.float32)]


def export_tflite_int8(model: tf.keras.Model, x_train: np.ndarray, output_path: Path) -> bytes:
    """Konwertuje Keras -> TFLite z wejsciem i wyjsciem INT8."""

    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.representative_dataset = lambda: representative_dataset(x_train)
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    converter.inference_input_type = tf.int8
    converter.inference_output_type = tf.int8
    tflite_model = converter.convert()

    output_path.write_bytes(tflite_model)
    size_kb = len(tflite_model) / 1024.0
    print(f"Zapisano {output_path} ({size_kb:.1f} KB)")
    if len(tflite_model) >= 100 * 1024:
        print("OSTRZEZENIE: model.tflite przekracza 100 KB.")
    return tflite_model


def inspect_tflite(tflite_model: bytes) -> None:
    """Sprawdza typy tensora wejscia/wyjscia po kwantyzacji."""

    interpreter = tf.lite.Interpreter(model_content=tflite_model)
    interpreter.allocate_tensors()
    input_info = interpreter.get_input_details()[0]
    output_info = interpreter.get_output_details()[0]
    print(f"TFLite input dtype : {input_info['dtype']}")
    print(f"TFLite output dtype: {output_info['dtype']}")
    if input_info["dtype"] != np.int8 or output_info["dtype"] != np.int8:
        raise RuntimeError("Model TFLite nie ma wejscia/wyjscia INT8.")


def write_normalization_header(mean: np.ndarray, std: np.ndarray, path: Path) -> None:
    """Zapisuje mean/std jako naglowek C++ dla Arduino."""

    mean_values = ", ".join(f"{v:.9g}f" for v in mean)
    std_values = ", ".join(f"{v:.9g}f" for v in std)
    text = f"""#pragma once

// Plik wygenerowany przez python/2_train.py.
// Wartosci musza odpowiadac normalizacji uzytej przy treningu modelu.

constexpr int NORM_CHANNELS = {N_CHANNELS};
const float NORM_MEAN[NORM_CHANNELS] = {{{mean_values}}};
const float NORM_STD[NORM_CHANNELS] = {{{std_values}}};
"""
    path.write_text(text, encoding="utf-8")
    print(f"Zapisano {path}")


def main() -> None:
    args = parse_args()
    tf.keras.utils.set_random_seed(args.seed)
    args.out_dir.mkdir(parents=True, exist_ok=True)

    data = np.load(args.input, allow_pickle=True)
    x = data["X"].astype(np.float32)
    y = data["y"].astype(np.int64)
    mean = data["mean"].astype(np.float32)
    std = data["std"].astype(np.float32)
    subjects = data["subjects"].astype(str)

    if x.shape[1:] != (WINDOW_SIZE, N_CHANNELS):
        raise ValueError(f"Niepoprawny ksztalt X: {x.shape}")

    print_class_distribution(y, prefix="Rozklad wszystkich okien")
    x_train, x_test, y_train, y_test = split_data(x, y, subjects, args.loso, args.seed)
    print_class_distribution(y_train, prefix="Rozklad train")
    print_class_distribution(y_test, prefix="Rozklad test")

    classes = np.unique(y_train)
    class_weights_values = compute_class_weight(
        class_weight="balanced",
        classes=classes,
        y=y_train,
    )
    class_weight = {
        int(cls): float(weight) for cls, weight in zip(classes, class_weights_values)
    }
    print(f"Wagi klas: {class_weight}")

    model = build_model()
    model.summary()
    print(f"Liczba parametrow: {model.count_params()}")
    if model.count_params() >= 50_000:
        print("OSTRZEZENIE: model przekracza 50k parametrow.")

    callbacks = [
        tf.keras.callbacks.EarlyStopping(
            monitor="val_loss",
            patience=5,
            restore_best_weights=True,
        )
    ]
    model.fit(
        x_train,
        y_train,
        validation_split=0.15,
        epochs=args.epochs,
        batch_size=args.batch_size,
        class_weight=class_weight,
        callbacks=callbacks,
        verbose=2,
    )

    y_prob = model.predict(x_test, batch_size=args.batch_size, verbose=0)
    y_pred = np.argmax(y_prob, axis=1)
    labels = list(range(len(CLASS_NAMES)))
    print(
        classification_report(
            y_test,
            y_pred,
            labels=labels,
            target_names=CLASS_NAMES,
            digits=4,
            zero_division=0,
        )
    )
    print("Macierz pomylek [wiersze=prawda, kolumny=predykcja]:")
    print(confusion_matrix(y_test, y_pred, labels=labels))
    fall_f1 = f1_score(y_test, y_pred, labels=[2], average="macro", zero_division=0)
    print(f"F1 dla klasy FALL: {fall_f1:.4f}")

    keras_path = args.out_dir / "model.keras"
    model.save(keras_path)
    print(f"Zapisano {keras_path}")

    tflite_model = export_tflite_int8(model, x_train, args.out_dir / "model.tflite")
    inspect_tflite(tflite_model)

    normalization_path = args.out_dir / "normalization.h"
    write_normalization_header(mean, std, normalization_path)

    firmware_root = Path(__file__).resolve().parents[1] / "firmware"
    for sketch in ("03_fall_detector", "04_hybrid_lowpower"):
        firmware_dir = firmware_root / sketch
        firmware_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(normalization_path, firmware_dir / "normalization.h")
        print(f"Skopiowano normalization.h do {firmware_dir}")


if __name__ == "__main__":
    main()

