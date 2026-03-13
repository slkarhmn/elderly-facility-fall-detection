# Dataset User Mapping

This file records the participant IDs used in `ml/dataset_manifest.csv`.

- `user1`: participant 1
- `user2`: participant 2
- `user3`: participant 3

Current mapping rule:

- each dataset filename directly encodes the participant as `user1`, `user2`, or `user3`
- `ml/dataset_manifest.csv` now mirrors the renamed files under `data_recording/data/`

This keeps the training pipeline aligned with the renamed dataset while preserving stable cross-user split keys.
