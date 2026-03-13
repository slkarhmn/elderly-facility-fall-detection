from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import yaml


ML_DIR = Path(__file__).resolve().parent
REPO_ROOT = ML_DIR.parent


def repo_path(path_str: str | Path) -> Path:
    path = Path(path_str)
    if path.is_absolute():
        return path
    return REPO_ROOT / path


def load_config(config_path: str | Path | None = None) -> dict[str, Any]:
    path = repo_path(config_path or ML_DIR / "config.yaml")
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def get_artifact_paths(config: dict[str, Any]) -> dict[str, Path]:
    return {
        key: repo_path(value)
        for key, value in config["artifacts"].items()
        if key.endswith("_path") or key.endswith("_dir")
    }


def ensure_parent_dir(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def ensure_artifact_dirs(config: dict[str, Any]) -> dict[str, Path]:
    paths = get_artifact_paths(config)
    root_dir = paths["root_dir"]
    root_dir.mkdir(parents=True, exist_ok=True)
    for key, path in paths.items():
        if key.endswith("_dir"):
            path.mkdir(parents=True, exist_ok=True)
        else:
            ensure_parent_dir(path)
    return paths


def load_manifest(config: dict[str, Any]) -> pd.DataFrame:
    manifest_path = repo_path(config["data"]["manifest_path"])
    manifest_df = pd.read_csv(manifest_path)
    required = {"relative_path", "label", "user_id"}
    missing = required.difference(manifest_df.columns)
    if missing:
        raise ValueError(f"Manifest is missing required columns: {sorted(missing)}")
    manifest_df["relative_path"] = manifest_df["relative_path"].astype(str)
    manifest_df["source_path"] = manifest_df["relative_path"].map(repo_path)
    return manifest_df


def expected_sensor_columns(config: dict[str, Any]) -> list[str]:
    return list(config["data"]["required_columns"])


def read_sensor_csv(path: Path, config: dict[str, Any]) -> pd.DataFrame:
    frame = pd.read_csv(path)
    expected = expected_sensor_columns(config)
    missing = [column for column in expected if column not in frame.columns]
    if missing:
        raise ValueError(f"{path} is missing required columns: {missing}")
    frame = frame[expected].copy()
    numeric_columns = [column for column in expected if column != "label"]
    for column in numeric_columns:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame["label"] = frame["label"].astype(str).str.strip()
    frame = frame.dropna(subset=numeric_columns)
    frame = frame.sort_values("timestamp_ms").reset_index(drop=True)
    if frame.empty:
        raise ValueError(f"{path} has no valid sensor rows after cleaning.")
    return frame


def downsample_to_target_rate(
    frame: pd.DataFrame, recorded_hz: int, target_hz: int
) -> pd.DataFrame:
    if target_hz <= 0:
        raise ValueError("Target sample rate must be positive.")
    if target_hz > recorded_hz:
        raise ValueError("Upsampling is not supported in this pipeline.")
    if target_hz == recorded_hz:
        return frame.reset_index(drop=True)

    timestamps = frame["timestamp_ms"].to_numpy(dtype=np.float64)
    target_period_ms = 1000.0 / float(target_hz)
    target_times = np.arange(
        timestamps[0],
        timestamps[-1] + target_period_ms,
        target_period_ms,
        dtype=np.float64,
    )
    indices = np.searchsorted(timestamps, target_times, side="left")
    indices = np.clip(indices, 0, len(frame) - 1)
    unique_indices = np.unique(indices)
    return frame.iloc[unique_indices].reset_index(drop=True)


def selected_axes(config: dict[str, Any]) -> list[str]:
    axes = list(config["sensors"]["primary_axes"])
    if config["sensors"].get("use_gyro", False):
        axes.extend(config["sensors"]["optional_axes"])
    return axes


def feature_columns(config: dict[str, Any]) -> list[str]:
    columns: list[str] = []
    axes = selected_axes(config)
    for axis in axes:
        for stat_name in config["features"]["per_axis_statistics"]:
            columns.append(f"{axis}_{stat_name}")
    for stat_name in config["features"]["magnitude_statistics"]:
        columns.append(f"magnitude_{stat_name}")
    return columns


def extract_window_features(
    window_frame: pd.DataFrame, config: dict[str, Any]
) -> dict[str, float]:
    features: dict[str, float] = {}
    axes = selected_axes(config)
    axis_statistics = config["features"]["per_axis_statistics"]
    magnitude_statistics = config["features"]["magnitude_statistics"]

    for axis in axes:
        values = window_frame[axis].to_numpy(dtype=np.float32)
        features.update(compute_statistics(values, axis, axis_statistics))

    primary_values = window_frame[config["sensors"]["primary_axes"]].to_numpy(dtype=np.float32)
    magnitude = np.linalg.norm(primary_values, axis=1)
    features.update(compute_statistics(magnitude, "magnitude", magnitude_statistics))
    return features


def compute_statistics(
    values: np.ndarray, prefix: str, statistics_list: list[str]
) -> dict[str, float]:
    stats_map: dict[str, float] = {}
    values = values.astype(np.float32)
    for stat_name in statistics_list:
        if stat_name == "mean":
            stats_map[f"{prefix}_{stat_name}"] = float(np.mean(values))
        elif stat_name == "std":
            stats_map[f"{prefix}_{stat_name}"] = float(np.std(values))
        elif stat_name == "min":
            stats_map[f"{prefix}_{stat_name}"] = float(np.min(values))
        elif stat_name == "max":
            stats_map[f"{prefix}_{stat_name}"] = float(np.max(values))
        elif stat_name == "range":
            stats_map[f"{prefix}_{stat_name}"] = float(np.max(values) - np.min(values))
        elif stat_name == "energy":
            stats_map[f"{prefix}_{stat_name}"] = float(np.mean(np.square(values)))
        else:
            raise ValueError(f"Unsupported statistic: {stat_name}")
    return stats_map


def windowed_feature_dataset(config: dict[str, Any]) -> tuple[pd.DataFrame, list[str]]:
    manifest_df = load_manifest(config)
    rows = materialize_window_rows(manifest_df.to_dict(orient="records"), config)
    dataset = pd.DataFrame(rows)
    if dataset.empty:
        raise ValueError("No windows were generated from the current dataset.")

    dataset = dataset.rename(columns={"window_label": "label"})
    return dataset, feature_columns(config)


def materialize_window_rows(
    manifest_rows: list[dict[str, Any]], config: dict[str, Any], start_window_index: int = 0
) -> list[dict[str, Any]]:
    recorded_rate = int(config["sensors"]["recorded_sample_rate_hz"])
    target_rate = int(config["sensors"]["training_sample_rate_hz"])
    window_seconds = float(config["windowing"]["window_seconds"])
    overlap_fraction = float(config["windowing"]["overlap_fraction"])
    window_size = int(round(target_rate * window_seconds))
    hop_size = max(1, int(round(window_size * (1.0 - overlap_fraction))))
    minimum_rows = int(
        np.ceil(window_size * float(config["windowing"]["minimum_rows_per_window_fraction"]))
    )

    rows: list[dict[str, Any]] = []
    window_counter = start_window_index
    for manifest_row in manifest_rows:
        source_path = Path(manifest_row["source_path"])
        session = read_sensor_csv(source_path, config)
        session = downsample_to_target_rate(session, recorded_rate, target_rate)
        if len(session) < minimum_rows:
            continue

        for start_idx in range(0, len(session) - window_size + 1, hop_size):
            window = session.iloc[start_idx : start_idx + window_size].reset_index(drop=True)
            if len(window) < minimum_rows:
                continue
            feature_row = extract_window_features(window, config)
            feature_row.update(
                {
                    "window_id": f"window_{window_counter:06d}",
                    "relative_path": manifest_row["relative_path"],
                    "user_id": manifest_row["user_id"],
                    "manifest_label": manifest_row["label"],
                    "window_label": manifest_row["label"],
                    "start_timestamp_ms": int(window["timestamp_ms"].iloc[0]),
                    "end_timestamp_ms": int(window["timestamp_ms"].iloc[-1]),
                    "row_count": int(len(window)),
                    "recorded_sample_rate_hz": recorded_rate,
                    "training_sample_rate_hz": target_rate,
                }
            )
            rows.append(feature_row)
            window_counter += 1

    return rows


def compute_user_profiles(
    dataset: pd.DataFrame, config: dict[str, Any], feature_names: list[str]
) -> dict[str, dict[str, Any]]:
    baseline_label = config["personalization"]["baseline_label"]
    profiles: dict[str, dict[str, Any]] = {}
    for user_id, user_frame in dataset.groupby("user_id"):
        walking_frame = user_frame[user_frame["label"] == baseline_label]
        if walking_frame.empty:
            continue

        means = walking_frame[feature_names].mean()
        stds = walking_frame[feature_names].std().fillna(0.0)
        stds = stds.replace(0.0, 1e-6)
        profile = {
            "user_id": user_id,
            "baseline_label": baseline_label,
            "feature_mean": {name: float(means[name]) for name in feature_names},
            "feature_std": {name: float(stds[name]) for name in feature_names},
            "magnitude_baseline": {
                "mean": float(means.get("magnitude_mean", 0.0)),
                "std": float(stds.get("magnitude_std", 1.0)),
            },
            "threshold_adjustments": dict(config["personalization"]["threshold_adjustments"]),
            "calibration_timestamp": utc_now_string(),
        }
        profiles[user_id] = profile
    return profiles


def apply_user_personalization(
    dataset: pd.DataFrame, profiles: dict[str, dict[str, Any]], feature_names: list[str]
) -> pd.DataFrame:
    adjusted = dataset.copy()
    for user_id, profile in profiles.items():
        mask = adjusted["user_id"] == user_id
        if not mask.any():
            continue
        mean_vector = np.array([profile["feature_mean"][name] for name in feature_names], dtype=np.float32)
        std_vector = np.array([profile["feature_std"][name] for name in feature_names], dtype=np.float32)
        raw_values = adjusted.loc[mask, feature_names].to_numpy(dtype=np.float32)
        adjusted.loc[mask, feature_names] = (raw_values - mean_vector) / std_vector
    return adjusted


def build_audit_summary(
    manifest_df: pd.DataFrame,
    processed_df: pd.DataFrame,
    profiles: dict[str, dict[str, Any]],
    config: dict[str, Any],
) -> dict[str, Any]:
    labels = list(config["data"]["labels"])
    session_counts = nested_count_table(manifest_df, "user_id", "label")
    window_counts = nested_count_table(processed_df, "user_id", "label")

    missing_labels_by_user: dict[str, list[str]] = {}
    under_minimum_by_user: dict[str, list[str]] = {}
    min_windows = int(config["evaluation"]["minimum_windows_per_class"])

    all_users = sorted(set(manifest_df["user_id"]))
    for user_id in all_users:
        label_counts = window_counts.get(user_id, {})
        missing_labels_by_user[user_id] = [label for label in labels if label_counts.get(label, 0) == 0]
        under_minimum_by_user[user_id] = [
            label for label in labels if 0 < label_counts.get(label, 0) < min_windows
        ]

    strict_ready_users = [
        user_id
        for user_id in all_users
        if not missing_labels_by_user[user_id] and not under_minimum_by_user[user_id]
    ]

    return {
        "generated_at": utc_now_string(),
        "labels": labels,
        "manifest_session_counts": session_counts,
        "processed_window_counts": window_counts,
        "missing_labels_by_user": missing_labels_by_user,
        "under_minimum_windows_by_user": under_minimum_by_user,
        "strict_ready_holdout_users": strict_ready_users,
        "provisional_mode_required": any(missing_labels_by_user.values()),
        "personalization_profiles_available_for_users": sorted(profiles.keys()),
        "notes": [
            "Strict final cross-user claims require every holdout user to have coverage for every target class.",
            "The current pipeline still allows provisional development evaluation while gaps remain visible.",
        ],
    }


def nested_count_table(frame: pd.DataFrame, outer: str, inner: str) -> dict[str, dict[str, int]]:
    counts: dict[str, dict[str, int]] = defaultdict(dict)
    grouped = frame.groupby([outer, inner]).size()
    for (outer_value, inner_value), count in grouped.items():
        counts[str(outer_value)][str(inner_value)] = int(count)
    return {key: dict(value) for key, value in counts.items()}


def save_json(path: Path, payload: dict[str, Any]) -> None:
    ensure_parent_dir(path)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def utc_now_string() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def metadata_columns(feature_names: list[str]) -> list[str]:
    return [
        "window_id",
        "relative_path",
        "user_id",
        "manifest_label",
        "label",
        "start_timestamp_ms",
        "end_timestamp_ms",
        "row_count",
        "recorded_sample_rate_hz",
        "training_sample_rate_hz",
    ] + feature_names
