# TinyML Pipeline

This directory contains the end-to-end TinyML workflow for the Arduino Nano 33 BLE fall/activity project.

## Files

- `config.yaml`: shared pipeline configuration
- `dataset_manifest.csv`: raw CSV to `user_id` mapping
- `user_mapping.md`: participant reference for the current dataset
- `audit_dataset.py`: checks class coverage and window counts per user
- `preprocess.py`: converts raw CSV sessions into window-level statistical features
- `train.py`: trains the compact MLP and writes evaluation artifacts
- `export_tflite.py`: exports the final Keras model to INT8 TFLite and generates Arduino headers
- `validate_tflite.py`: checks Keras vs TFLite prediction agreement
- `calibrate_user.py`: builds a per-user walking calibration profile
- `requirements.txt`: Python dependencies for the ML pipeline

## Typical workflow

```bash
python3 -m pip install -r ml/requirements.txt
python3 ml/audit_dataset.py
python3 ml/preprocess.py
python3 ml/train.py
python3 ml/export_tflite.py
python3 ml/validate_tflite.py
```

## Calibration workflow

Use a short walking-only recording for a new user:

```bash
python3 ml/calibrate_user.py --user-id new_user --inputs data_recording/data/data_walking_example.csv
```

This saves a profile under `ml/artifacts/user_profiles/`. The profile stores per-feature walking baseline statistics and does not retrain the model.

## Current dataset note

The current manifest is sufficient to build and test the pipeline, but `user_3` still lacks `fall` recordings. Final strict cross-user evaluation claims should wait until that gap is filled.
