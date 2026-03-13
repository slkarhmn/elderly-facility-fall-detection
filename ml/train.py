from __future__ import annotations

import argparse
from typing import Any
import shutil

import numpy as np
import pandas as pd

from common import (
    ensure_artifact_dirs,
    feature_columns,
    load_config,
    metadata_columns,
    save_json,
)
from evaluate import summarize_predictions, write_evaluation_artifacts
from splits import leave_one_user_out_splits, stratified_split


def standardize_fit(values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    mean = values.mean(axis=0)
    std = values.std(axis=0)
    std[std == 0.0] = 1.0
    return mean.astype(np.float32), std.astype(np.float32)


def standardize_apply(values: np.ndarray, mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    return ((values - mean) / std).astype(np.float32)


def build_model(input_dim: int, output_dim: int, config: dict[str, Any]):
    try:
        import tensorflow as tf
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "TensorFlow is required for training. Install dependencies from ml/requirements.txt first."
        ) from exc

    tf.random.set_seed(int(config["project"]["random_seed"]))
    model = tf.keras.Sequential(name="tinyml_activity_classifier")
    model.add(tf.keras.layers.Input(shape=(input_dim,), name="features"))
    for index, units in enumerate(config["model"]["hidden_units"]):
        model.add(tf.keras.layers.Dense(units, activation="relu", name=f"dense_{index + 1}"))
        dropout_rate = float(config["model"].get("dropout_rate", 0.0))
        if dropout_rate > 0.0:
            model.add(tf.keras.layers.Dropout(dropout_rate, name=f"dropout_{index + 1}"))
    model.add(tf.keras.layers.Dense(output_dim, activation="softmax", name="classifier"))
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=float(config["model"]["learning_rate"])),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def encode_labels(frame: pd.DataFrame, labels: list[str]) -> np.ndarray:
    mapping = {label: index for index, label in enumerate(labels)}
    return frame["label"].map(mapping).to_numpy(dtype=np.int32)


def train_fold(
    train_frame: pd.DataFrame,
    validation_frame: pd.DataFrame,
    test_frame: pd.DataFrame,
    feature_names: list[str],
    labels: list[str],
    config: dict[str, Any],
):
    try:
        import tensorflow as tf
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "TensorFlow is required for training. Install dependencies from ml/requirements.txt first."
        ) from exc

    x_train = train_frame[feature_names].to_numpy(dtype=np.float32)
    x_val = validation_frame[feature_names].to_numpy(dtype=np.float32)
    x_test = test_frame[feature_names].to_numpy(dtype=np.float32)

    mean, std = standardize_fit(x_train)
    x_train = standardize_apply(x_train, mean, std)
    x_val = standardize_apply(x_val, mean, std) if len(x_val) else x_val
    x_test = standardize_apply(x_test, mean, std)

    y_train = encode_labels(train_frame, labels)
    y_val = encode_labels(validation_frame, labels)
    y_test = encode_labels(test_frame, labels)

    model = build_model(len(feature_names), len(labels), config)
    callbacks = [
        tf.keras.callbacks.EarlyStopping(
            monitor="val_loss",
            patience=int(config["model"]["early_stopping_patience"]),
            restore_best_weights=True,
        )
    ]
    fit_kwargs = {
        "x": x_train,
        "y": y_train,
        "epochs": int(config["model"]["epochs"]),
        "batch_size": int(config["model"]["batch_size"]),
        "verbose": 0,
        "callbacks": callbacks,
    }
    if len(validation_frame):
        fit_kwargs["validation_data"] = (x_val, y_val)
    else:
        fit_kwargs["validation_split"] = 0.1

    history = model.fit(**fit_kwargs)
    probabilities = model.predict(x_test, verbose=0)
    predictions = probabilities.argmax(axis=1).astype(np.int32)

    summary = summarize_predictions(
        y_true=y_test,
        y_pred=predictions,
        labels=labels,
        metadata={
            "epochs_trained": len(history.history["loss"]),
            "test_user": str(test_frame["user_id"].iloc[0]),
        },
    )
    scaler = {"mean": mean.tolist(), "std": std.tolist()}
    return model, scaler, summary


def train_final_model(
    dataset: pd.DataFrame,
    feature_names: list[str],
    labels: list[str],
    config: dict[str, Any],
):
    try:
        import tensorflow as tf
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "TensorFlow is required for training. Install dependencies from ml/requirements.txt first."
        ) from exc

    train_frame, validation_frame = stratified_split(
        dataset,
        float(config["evaluation"]["validation_fraction"]),
        int(config["project"]["random_seed"]),
    )
    x_train = train_frame[feature_names].to_numpy(dtype=np.float32)
    x_val = validation_frame[feature_names].to_numpy(dtype=np.float32)
    mean, std = standardize_fit(x_train)
    x_train = standardize_apply(x_train, mean, std)
    x_val = standardize_apply(x_val, mean, std)
    y_train = encode_labels(train_frame, labels)
    y_val = encode_labels(validation_frame, labels)

    model = build_model(len(feature_names), len(labels), config)
    callbacks = [
        tf.keras.callbacks.EarlyStopping(
            monitor="val_loss",
            patience=int(config["model"]["early_stopping_patience"]),
            restore_best_weights=True,
        )
    ]
    history = model.fit(
        x_train,
        y_train,
        validation_data=(x_val, y_val),
        epochs=int(config["model"]["epochs"]),
        batch_size=int(config["model"]["batch_size"]),
        verbose=0,
        callbacks=callbacks,
    )

    final_probs = model.predict(x_val, verbose=0)
    final_predictions = final_probs.argmax(axis=1).astype(np.int32)
    summary = summarize_predictions(
        y_true=y_val,
        y_pred=final_predictions,
        labels=labels,
        metadata={"epochs_trained": len(history.history["loss"]), "dataset": "final_validation"},
    )
    scaler = {"mean": mean.tolist(), "std": std.tolist()}
    return model, scaler, summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a compact TinyML MLP on processed windows.")
    parser.add_argument("--config", default="ml/config.yaml", help="Path to the pipeline config file.")
    args = parser.parse_args()

    config = load_config(args.config)
    artifact_paths = ensure_artifact_dirs(config)
    processed_dataset_path = artifact_paths["processed_dataset_path"]
    if not processed_dataset_path.exists():
        raise FileNotFoundError(
            f"Processed dataset not found at {processed_dataset_path}. Run ml/preprocess.py first."
        )

    dataset = pd.read_csv(processed_dataset_path)
    labels = list(config["data"]["labels"])
    feature_names = feature_columns(config)
    evaluation_dir = artifact_paths["evaluation_dir"]
    if evaluation_dir.exists():
        shutil.rmtree(evaluation_dir)
    evaluation_dir.mkdir(parents=True, exist_ok=True)

    folds = leave_one_user_out_splits(
        dataset=dataset,
        labels=labels,
        validation_fraction=float(config["evaluation"]["validation_fraction"]),
        seed=int(config["project"]["random_seed"]),
    )

    fold_summaries: list[dict[str, Any]] = []
    for fold in folds:
        _, _, fold_summary = train_fold(
            train_frame=fold.train_frame,
            validation_frame=fold.validation_frame,
            test_frame=fold.test_frame,
            feature_names=feature_names,
            labels=labels,
            config=config,
        )
        fold_summary["metadata"]["missing_test_labels"] = fold.missing_test_labels
        fold_summary["metadata"]["strict_ready"] = fold.strict_ready
        write_evaluation_artifacts(evaluation_dir, f"fold_{fold.test_user}", fold_summary)
        fold_summaries.append(fold_summary)

    final_model, final_scaler, final_summary = train_final_model(
        dataset=dataset,
        feature_names=feature_names,
        labels=labels,
        config=config,
    )
    final_model.save(artifact_paths["final_model_path"])
    save_json(artifact_paths["final_scaler_path"], final_scaler)
    write_evaluation_artifacts(evaluation_dir, "final_validation", final_summary)

    overall_summary = {
        "labels": labels,
        "feature_columns": feature_names,
        "processed_dataset_path": str(processed_dataset_path),
        "folds": fold_summaries,
        "final_validation": final_summary,
        "notes": [
            "Personalized features are generated before global train-split standardization.",
            "Strict cross-user claims are only valid for holdout users whose test data covers every target class.",
        ],
    }
    save_json(artifact_paths["final_training_summary_path"], overall_summary)
    print(f"Training summary saved to {artifact_paths['final_training_summary_path']}")


if __name__ == "__main__":
    main()
