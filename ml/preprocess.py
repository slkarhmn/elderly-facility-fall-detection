from __future__ import annotations

import argparse

from common import (
    apply_user_personalization,
    build_audit_summary,
    compute_user_profiles,
    ensure_artifact_dirs,
    feature_columns,
    load_config,
    load_manifest,
    metadata_columns,
    save_json,
    windowed_feature_dataset,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Preprocess raw IMU CSV sessions into window-level features.")
    parser.add_argument("--config", default="ml/config.yaml", help="Path to the pipeline config file.")
    args = parser.parse_args()

    config = load_config(args.config)
    artifact_paths = ensure_artifact_dirs(config)
    manifest_df = load_manifest(config)
    dataset_df, feature_names = windowed_feature_dataset(config)

    profiles = compute_user_profiles(dataset_df, config, feature_names)
    if config["personalization"]["enabled"]:
        dataset_df = apply_user_personalization(dataset_df, profiles, feature_names)

    ordered_columns = metadata_columns(feature_names)
    dataset_df = dataset_df[ordered_columns].sort_values(["user_id", "label", "relative_path", "start_timestamp_ms"])
    dataset_df.to_csv(artifact_paths["processed_dataset_path"], index=False)
    save_json(artifact_paths["training_user_profiles_path"], profiles)

    audit = build_audit_summary(manifest_df, dataset_df, profiles, config)
    audit["feature_columns"] = feature_names
    audit["processed_dataset_path"] = str(artifact_paths["processed_dataset_path"])
    save_json(artifact_paths["audit_report_path"], audit)

    print(f"Processed dataset saved to {artifact_paths['processed_dataset_path']}")
    print(f"Saved {len(dataset_df)} windows with {len(feature_names)} features each.")
    print(f"Audit report saved to {artifact_paths['audit_report_path']}")


if __name__ == "__main__":
    main()
