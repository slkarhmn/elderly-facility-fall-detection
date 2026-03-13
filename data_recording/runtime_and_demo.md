# Runtime And Demo Guide

## Purpose

This guide explains how to use the frozen TinyML baseline on the Arduino Nano 33 BLE for:

- raw data recording
- walking calibration
- live inference
- fall alert demo output

The ML model itself is unchanged in this phase. Only runtime behavior, post-processing, and developer-facing output are hardened.

## Frozen ML Contract

The current exported model contract is:

- `24` input features
- `7` classes
- `50 Hz` inference sample rate
- `100` samples per window
- `10` calibration windows

Class order:

1. `walking`
2. `stumbling`
3. `idle_standing`
4. `idle_sitting`
5. `upstairs`
6. `downstairs`
7. `fall`

## Files Used On The Board

- `data_recording/data_record_arduino_sketch.ino`
- `data_recording/model_data.h`
- `data_recording/model_settings.h`

Set `ENABLE_TINYML` to `1` in `data_recording/data_record_arduino_sketch.ino` before flashing if you want live inference on the board.

## Modes

The sketch supports three modes.

### Record mode

Command: `r`

What it does:

- streams raw IMU samples over serial
- keeps the existing CSV-friendly format
- used by `data_recording/script.py`

Output format:

```text
timestamp_ms,ax,ay,az,gx,gy,gz
1234,0.0123,-0.0456,1.0021,0.1234,-0.4321,0.0000
```

### Calibration mode

Command: `c`

What it does:

- collects about `10` walking windows from the current user
- computes per-feature mean and standard deviation on-device
- does not change model weights
- prepares the user-specific baseline used before normal inference

What the user should do:

1. Wear the board in the normal waist position.
2. Enter calibration mode.
3. Walk normally until calibration completes.

Example output:

```text
MODE,mode=calibrate,sample_rate_hz=50,window_samples=100,cal_ready=0
INFO,action=walk_normally_for_calibration
CALIBRATION,progress=4,target=10,ready=0
CALIBRATION,progress=10,target=10,ready=1
CALIBRATION,status=complete
CALIBRATION,status=ready,count=10,target=10,mode=calibrate
```

### Inference mode

Command: `i`

What it does:

- collects `100` accelerometer samples at `50 Hz`
- extracts the same `24` statistical features used in Python
- applies user calibration first
- applies global training normalization second
- runs the frozen INT8 model
- applies lightweight fall confirmation after model inference

If calibration is missing, the sketch will emit:

```text
INFO,action=calibration_required_before_inference
```

## Serial Output Contract

The runtime output is structured so it can be consumed over serial now and mapped to BLE later.

### Status/event lines

- `MODE,...` for mode changes
- `STATUS,...` for runtime summary
- `CALIBRATION,...` for calibration progress/state
- `INFO,...` for hints and non-error notices
- `ERROR,...` for failures

### Inference lines

Each inference window emits one structured line:

```text
INFER,mode=infer,window=12,pred=walking,conf=0.8125,top2=downstairs,top2_conf=0.1094,fall_state=none,fall_candidate=0,fall_alert=0,impact=0,low_motion=1,mag_mean=1.0234,mag_std=0.0412,mag_max=1.1311,mag_range=0.2023,mag_energy=1.0490,cal_ready=1,cal_count=10,fall_alerts=0,stumble_predictions=3
```

Recommended app-side fields to consume:

- `pred`
- `conf`
- `top2`
- `top2_conf`
- `fall_state`
- `fall_alert`
- `cal_ready`
- `cal_count`

Optional debug fields:

- `impact`
- `low_motion`
- `mag_mean`
- `mag_std`
- `mag_max`
- `mag_range`
- `mag_energy`
- `fall_alerts`
- `stumble_predictions`

## Fall Confirmation Post-Processing

This layer does not retrain or modify the neural network. It only reduces false fall alerts after inference.

Current logic:

1. A fall must be the top predicted class.
2. Fall confidence must exceed `kFallConfidenceThreshold` (`0.55`).
3. The window must also show impact-like motion using either:
   - `magnitude_max >= 2.35 g`, or
   - `magnitude_range >= 1.40 g`
4. After a fall candidate, the runtime looks for either:
   - repeated fall candidates across consecutive windows, or
   - a short post-event low-motion window with an idle-like class

Low-motion rule:

- `magnitude_std <= 0.20 g`

Alert states:

- `none`: no current fall evidence
- `pending`: possible fall, waiting for confirmation
- `alert`: confirmed or latched fall alert

These thresholds are intentionally centralized near the top of `data_recording/data_record_arduino_sketch.ino` so they are easy to explain and tune.

## Calibration Logic

Calibration stays lightweight and embedded-friendly.

What changes during calibration:

- the board learns the current user's walking feature mean/std

What does not change:

- model weights
- class order
- exported quantization parameters
- feature extractor structure

Inference-time normalization order:

1. extract raw 24-feature window
2. normalize using the user's walking calibration
3. normalize using the frozen global training scaler
4. quantize and run INT8 inference

This mirrors the Python-side personalization approach without online learning.

## Flash And Test

1. Open `data_recording/data_record_arduino_sketch.ino` in Arduino IDE.
2. Set `ENABLE_TINYML` to `1` for live inference.
3. Confirm `model_data.h` and `model_settings.h` are present in `data_recording/`.
4. Select Arduino Nano 33 BLE and the correct serial port.
5. Flash the sketch.
6. Open Serial Monitor at `115200`.
7. Send `c` and walk normally until calibration completes.
8. Send `i` and observe structured `INFER,...` lines.
9. Send `p` anytime to print runtime/calibration status.
10. Send `r` to switch back to raw recording mode.

## Limitations

- The model remains small and explainable, but cross-user `fall` vs `stumbling` confusion is still the main weakness.
- Post-processing helps reduce false positives, but it is not a medical-grade fall detector.
- Inference currently uses accelerometer-only features because that is what the frozen baseline expects.
- BLE transport is not implemented here; the serial message structure is designed so BLE can mirror it later.
