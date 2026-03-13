from __future__ import annotations

import argparse

from common import (
    build_audit_summary,
    compute_user_profiles,
    ensure_artifact_dirs,
    feature_columns,
    load_config,
    load_manifest,
    save_json,
    windowed_feature_dataset,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit dataset class coverage and window counts.")
    parser.add_argument("--config", default="ml/config.yaml", help="Path to the pipeline config file.")
    args = parser.parse_args()

    config = load_config(args.config)
    artifact_paths = ensure_artifact_dirs(config)
    manifest_df = load_manifest(config)
    dataset_df, feature_names = windowed_feature_dataset(config)
    profiles = compute_user_profiles(dataset_df, config, feature_names)
    audit = build_audit_summary(manifest_df, dataset_df, profiles, config)
    save_json(artifact_paths["audit_report_path"], audit)

    print(f"Audit report saved to {artifact_paths['audit_report_path']}")
    print("Strict-ready holdout users:", ", ".join(audit["strict_ready_holdout_users"]) or "none")
    for user_id, missing in audit["missing_labels_by_user"].items():
        if missing:
            print(f"{user_id} missing labels: {', '.join(missing)}")


if __name__ == "__main__":
    main()
