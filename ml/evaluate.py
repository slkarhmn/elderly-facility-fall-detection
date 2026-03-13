from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from common import ensure_parent_dir, load_json, repo_path, save_json


def confusion_matrix(
    y_true: np.ndarray, y_pred: np.ndarray, num_classes: int
) -> np.ndarray:
    matrix = np.zeros((num_classes, num_classes), dtype=np.int32)
    for true_idx, pred_idx in zip(y_true, y_pred):
        matrix[int(true_idx), int(pred_idx)] += 1
    return matrix


def classification_report(
    matrix: np.ndarray, labels: list[str]
) -> dict[str, dict[str, float | int]]:
    report: dict[str, dict[str, float | int]] = {}
    for index, label in enumerate(labels):
        tp = int(matrix[index, index])
        fp = int(matrix[:, index].sum() - tp)
        fn = int(matrix[index, :].sum() - tp)
        support = int(matrix[index, :].sum())
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = (
            2 * precision * recall / (precision + recall)
            if (precision + recall)
            else 0.0
        )
        report[label] = {
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "support": support,
        }
    return report


def summarize_predictions(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    labels: list[str],
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    matrix = confusion_matrix(y_true, y_pred, len(labels))
    report = classification_report(matrix, labels)
    accuracy = float(np.mean(y_true == y_pred)) if len(y_true) else 0.0
    macro_f1 = float(np.mean([report[label]["f1"] for label in labels])) if labels else 0.0
    return {
        "accuracy": accuracy,
        "macro_f1": macro_f1,
        "labels": labels,
        "confusion_matrix": matrix.tolist(),
        "classification_report": report,
        "metadata": metadata or {},
    }


def write_evaluation_artifacts(
    output_dir: Path,
    prefix: str,
    summary: dict[str, Any],
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    summary_path = output_dir / f"{prefix}_summary.json"
    confusion_path = output_dir / f"{prefix}_confusion_matrix.csv"
    save_json(summary_path, summary)

    matrix = np.array(summary["confusion_matrix"], dtype=np.int32)
    labels = summary["labels"]
    matrix_frame = pd.DataFrame(matrix, index=labels, columns=labels)
    matrix_frame.to_csv(confusion_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Summarize saved prediction arrays.")
    parser.add_argument("--predictions", required=True, help="Path to a JSON file containing y_true and y_pred arrays.")
    parser.add_argument("--output-dir", required=True, help="Where to save summary artifacts.")
    parser.add_argument("--prefix", default="evaluation", help="Output filename prefix.")
    args = parser.parse_args()

    payload = load_json(repo_path(args.predictions))
    y_true = np.asarray(payload["y_true"], dtype=np.int32)
    y_pred = np.asarray(payload["y_pred"], dtype=np.int32)
    labels = list(payload["labels"])
    summary = summarize_predictions(y_true, y_pred, labels, payload.get("metadata"))
    write_evaluation_artifacts(repo_path(args.output_dir), args.prefix, summary)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
