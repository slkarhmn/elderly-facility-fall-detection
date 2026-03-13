from __future__ import annotations

import argparse

import numpy as np
import pandas as pd

from common import ensure_artifact_dirs, feature_columns, load_config, load_json, save_json


def standardize(values: np.ndarray, mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    return ((values - mean) / std).astype(np.float32)


def quantize(values: np.ndarray, scale: float, zero_point: int) -> np.ndarray:
    quantized = np.round(values / scale + zero_point)
    return np.clip(quantized, -128, 127).astype(np.int8)


def dequantize(values: np.ndarray, scale: float, zero_point: int) -> np.ndarray:
    return scale * (values.astype(np.float32) - zero_point)


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare final Keras predictions against INT8 TFLite predictions.")
    parser.add_argument("--config", default="ml/config.yaml", help="Path to the pipeline config file.")
    parser.add_argument("--samples", type=int, default=128, help="Number of windows to compare.")
    args = parser.parse_args()

    try:
        import tensorflow as tf
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "TensorFlow is required for TFLite validation. Install dependencies from ml/requirements.txt first."
        ) from exc

    config = load_config(args.config)
    artifact_paths = ensure_artifact_dirs(config)
    metadata = load_json(artifact_paths["model_metadata_path"])
    scaler = load_json(artifact_paths["final_scaler_path"])
    feature_names = feature_columns(config)
    dataset = pd.read_csv(artifact_paths["processed_dataset_path"])
    model = tf.keras.models.load_model(artifact_paths["final_model_path"])

    sample_count = min(int(args.samples), len(dataset))
    sample_frame = dataset.iloc[:sample_count].copy()
    sample_values = sample_frame[feature_names].to_numpy(dtype=np.float32)
    mean = np.asarray(scaler["mean"], dtype=np.float32)
    std = np.asarray(scaler["std"], dtype=np.float32)
    standardized = standardize(sample_values, mean, std)

    keras_probs = model.predict(standardized, verbose=0)
    keras_pred = keras_probs.argmax(axis=1)

    interpreter = tf.lite.Interpreter(model_path=str(artifact_paths["tflite_model_path"]))
    interpreter.allocate_tensors()
    input_details = interpreter.get_input_details()[0]
    output_details = interpreter.get_output_details()[0]
    input_scale, input_zero_point = input_details["quantization"]
    output_scale, output_zero_point = output_details["quantization"]

    tflite_pred = []
    for row in standardized:
        quantized_input = quantize(row.reshape(1, -1), input_scale, int(input_zero_point))
        interpreter.set_tensor(input_details["index"], quantized_input)
        interpreter.invoke()
        output_tensor = interpreter.get_tensor(output_details["index"])
        output_values = dequantize(output_tensor, output_scale, int(output_zero_point))
        tflite_pred.append(int(np.argmax(output_values, axis=1)[0]))

    tflite_pred = np.asarray(tflite_pred, dtype=np.int32)
    agreement = float(np.mean(keras_pred == tflite_pred)) if len(tflite_pred) else 0.0
    payload = {
        "sample_count": sample_count,
        "keras_tflite_top1_agreement": agreement,
        "labels": metadata["labels"],
    }
    save_json(artifact_paths["tflite_validation_path"], payload)
    print(f"Saved TFLite validation report to {artifact_paths['tflite_validation_path']}")
    print(f"Keras/TFLite top-1 agreement: {agreement:.4f}")


if __name__ == "__main__":
    main()
