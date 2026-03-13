# How to record data

Record data with the Arduino mounted at the waist in a consistent position. The current TinyML pipeline assumes the belt orientation does not change between users, calibration, and deployment.

## Setup

1. Wear the Arduino belt around your waist, with the stitches facing inward and the board/wire on the right side.
2. Plug the Arduino into your computer and note the serial port.
3. Open `data_recording/script.py` and update `PORT` if needed.
4. Create a Python environment and run `pip install pyserial`.
5. Run the recorder script from `data_recording/`.
6. When prompted, enter an optional participant tag such as `user1`, `user2`, or `user3`.
7. Select the activity label, press Enter to start, then Enter again to stop.

## Recording rules

- Keep recordings at 10-15 seconds each.
- Aim for at least 10 recordings per activity and participant.
- Keep each file to one activity only. Do not mix actions inside a labeled recording.
- Use the same waist placement and strap orientation for every participant.
- Record from the Arduino sensor, not a phone substitute.
- Falls should be done safely on a bed, mat, or other soft surface.

## Target activities

1. `walking`
2. `stumbling`
3. `idle_standing`
4. `idle_sitting`
5. `upstairs`
6. `downstairs`
7. `fall`

## Cross-user dataset requirements

- Keep participant IDs explicit in filenames or the manifest using `user1`, `user2`, and `user3`.
- For cross-user evaluation, every participant should have data for all 7 classes.
- The ML pipeline uses the filename/manifest user ID as the source of truth for leave-one-user-out testing.

## Calibration workflow for a new user

Before normal inference, the TinyML pipeline supports a short walking calibration:

1. Ask the new user to walk normally for 10-20 seconds.
2. Save that data and run `ml/calibrate_user.py`.
3. This produces a per-user profile in `ml/artifacts/user_profiles/`.
4. The profile stores baseline feature mean/std and magnitude statistics.
5. The neural network does not retrain. Only the input normalization changes for that user.

## Runtime deployment

For live inference, calibration, post-processing, and the serial/BLE-ready output contract, see `data_recording/runtime_and_demo.md`.

## CSV file

| Column | Description |
|---|---|
| `timestamp_ms` | Time in milliseconds since the Arduino powered on |
| `ax` | Acceleration X-axis (g-force) |
| `ay` | Acceleration Y-axis (g-force) |
| `az` | Acceleration Z-axis (g-force) |
| `gx` | Gyroscope X-axis (degrees/second) |
| `gy` | Gyroscope Y-axis (degrees/second) |
| `gz` | Gyroscope Z-axis (degrees/second) |
| `label` | Activity label selected in the recorder |

Accelerometer values are in **g** and gyroscope values are in **degrees/second**, matching the LSM9DS1 IMU on the Arduino Nano 33 BLE.