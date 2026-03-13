#!/usr/bin/env python3
"""
Generate evaluation graphs from ml/artifacts/training for the model overview doc.
Run from repo root: python3 ml/generate_evaluation_graphs.py
"""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent
SUMMARY_PATH = REPO_ROOT / "ml" / "artifacts" / "training" / "final_training_summary.json"
OUTPUT_DIR = REPO_ROOT / "docs" / "model_evaluation" / "graphs"


def load_summary() -> dict:
    with open(SUMMARY_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def plot_confusion_matrix(matrix: list[list[int]], labels: list[str], title: str, path: Path) -> None:
    """Save confusion matrix as heatmap."""
    arr = np.array(matrix, dtype=float)
    fig, ax = plt.subplots(figsize=(8, 6))
    im = ax.imshow(arr, cmap="Blues", aspect="auto", vmin=0)

    ax.set_xticks(np.arange(len(labels)))
    ax.set_yticks(np.arange(len(labels)))
    ax.set_xticklabels(labels)
    ax.set_yticklabels(labels)
    plt.setp(ax.get_xticklabels(), rotation=45, ha="right", rotation_mode="anchor")

    for i in range(len(labels)):
        for j in range(len(labels)):
            val = int(arr[i, j])
            color = "white" if arr[i, j] > arr.max() * 0.5 else "black"
            ax.text(j, i, val, ha="center", va="center", color=color, fontsize=10)

    ax.set_title(title)
    fig.colorbar(im, ax=ax, label="Count")
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close()


def plot_per_class_metrics(report: dict, title: str, path: Path) -> None:
    """Bar chart of precision, recall, F1 per class."""
    labels = list(report.keys())
    precision = [report[c]["precision"] for c in labels]
    recall = [report[c]["recall"] for c in labels]
    f1 = [report[c]["f1"] for c in labels]

    x = np.arange(len(labels))
    width = 0.25

    fig, ax = plt.subplots(figsize=(10, 5))
    bars1 = ax.bar(x - width, precision, width, label="Precision")
    bars2 = ax.bar(x, recall, width, label="Recall")
    bars3 = ax.bar(x + width, f1, width, label="F1")

    ax.set_ylabel("Score")
    ax.set_title(title)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=45, ha="right")
    ax.legend()
    ax.set_ylim(0, 1.05)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close()


def plot_fold_comparison(summary: dict, path: Path) -> None:
    """Bar chart of accuracy and macro-F1 across folds and final validation."""
    names = ["user1\n(holdout)", "user2\n(holdout)", "user3\n(holdout)", "Final\nvalidation"]
    accuracies = [f["accuracy"] for f in summary["folds"]] + [summary["final_validation"]["accuracy"]]
    macro_f1s = [f["macro_f1"] for f in summary["folds"]] + [summary["final_validation"]["macro_f1"]]

    x = np.arange(len(names))
    width = 0.35

    fig, ax = plt.subplots(figsize=(8, 5))
    bars1 = ax.bar(x - width / 2, accuracies, width, label="Accuracy")
    bars2 = ax.bar(x + width / 2, macro_f1s, width, label="Macro-F1")

    ax.set_ylabel("Score")
    ax.set_title("Accuracy and Macro-F1 by Evaluation Split")
    ax.set_xticks(x)
    ax.set_xticklabels(names)
    ax.legend()
    ax.set_ylim(0, 1.05)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close()


def plot_fold_confusion_grid(summary: dict, path: Path) -> None:
    """2x2 grid of confusion matrices: user1, user2, user3, final."""
    fig, axes = plt.subplots(2, 2, figsize=(12, 10))

    items = [
        (summary["folds"][0], "Holdout: user1", axes[0, 0]),
        (summary["folds"][1], "Holdout: user2", axes[0, 1]),
        (summary["folds"][2], "Holdout: user3", axes[1, 0]),
        (summary["final_validation"], "Final validation", axes[1, 1]),
    ]

    for data, title, ax in items:
        matrix = np.array(data["confusion_matrix"], dtype=float)
        labels = data["labels"]
        im = ax.imshow(matrix, cmap="Blues", aspect="auto", vmin=0)
        ax.set_xticks(np.arange(len(labels)))
        ax.set_yticks(np.arange(len(labels)))
        ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=8)
        ax.set_yticklabels(labels, fontsize=8)
        ax.set_title(title, fontsize=10)
        for i in range(len(labels)):
            for j in range(len(labels)):
                val = int(matrix[i, j])
                color = "white" if matrix[i, j] > matrix.max() * 0.5 else "black"
                ax.text(j, i, val, ha="center", va="center", color=color, fontsize=8)

    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close()


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if not SUMMARY_PATH.exists():
        print(f"Training summary not found: {SUMMARY_PATH}")
        print("Run the ML pipeline first: python3 ml/train.py")
        return

    summary = load_summary()
    labels = summary["labels"]

    # Final validation confusion matrix
    plot_confusion_matrix(
        summary["final_validation"]["confusion_matrix"],
        labels,
        "Final Validation Confusion Matrix",
        OUTPUT_DIR / "confusion_matrix_final_validation.png",
    )

    # Per-fold confusion matrices
    for fold in summary["folds"]:
        user = fold["metadata"]["test_user"]
        plot_confusion_matrix(
            fold["confusion_matrix"],
            fold["labels"],
            f"Holdout: {user} Confusion Matrix",
            OUTPUT_DIR / f"confusion_matrix_fold_{user}.png",
        )

    # Per-class metrics (final validation)
    plot_per_class_metrics(
        summary["final_validation"]["classification_report"],
        "Final Validation: Per-Class Precision, Recall, F1",
        OUTPUT_DIR / "per_class_metrics_final.png",
    )

    # Fold comparison
    plot_fold_comparison(summary, OUTPUT_DIR / "fold_comparison.png")

    # 2x2 confusion grid
    plot_fold_confusion_grid(summary, OUTPUT_DIR / "confusion_matrices_grid.png")

    print(f"Graphs saved to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
