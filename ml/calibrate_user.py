from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from common import (
    compute_user_profiles,
    ensure_artifact_dirs,
    feature_columns,
    load_config,
    materialize_window_rows,
    repo_path,
    save_json,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a walking-baseline calibration profile for a new user.")
    parser.add_argument("--user-id", required=True, help="Identifier to use for the saved user profile.")
    parser.add_argument(
        "--inputs",
        nargs="+",
        required=True,
        help="One or more walking CSV files collected for calibration.",
    )
    parser.add_argument("--config", default="ml/config.yaml", help="Path to the pipeline config file.")
    args = parser.parse_args()

    config = load_config(args.config)
    artifact_paths = ensure_artifact_dirs(config)
    rows = []
    manifest_rows = []
    for index, input_path in enumerate(args.inputs):
        absolute_path = repo_path(input_path)
        manifest_rows.append(
            {
                "relative_path": str(Path(input_path)),
                "source_path": absolute_path,
                "label": config["personalization"]["baseline_label"],
                "user_id": args.user_id,
            }
        )

    rows = materialize_window_rows(manifest_rows, config)
    if not rows:
        raise ValueError("Calibration inputs did not produce any valid walking windows.")

    calibration_df = pd.DataFrame(rows).rename(columns={"window_label": "label"})
    feature_names = feature_columns(config)
    profiles = compute_user_profiles(calibration_df, config, feature_names)
    profile = profiles.get(args.user_id)
    if not profile:
        raise ValueError("Failed to build a calibration profile for the provided user.")

    output_path = artifact_paths["user_profiles_dir"] / f"{args.user_id}.json"
    save_json(output_path, profile)
    print(f"Saved calibration profile to {output_path}")


if __name__ == "__main__":
    main()
