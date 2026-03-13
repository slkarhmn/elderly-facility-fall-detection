# Arduino Inference Test Guide

## Purpose

Use this guide if someone wants to take the current frozen TinyML model, flash it to an Arduino Nano 33 BLE, and test live inference on the board.

This is for:

- flashing the board
- enabling the model
- calibrating a new user
- running live inference
- checking serial output

This is not for retraining the model.

## Files You Need

Main Arduino sketch:

- `data_recording/data_record_arduino_sketch.ino`

Model files already generated:

- `data_recording/model_data.h`
- `data_recording/model_settings.h`

Optional raw-data recording script:

- `data_recording/script.py`

Additional runtime details:

- `data_recording/runtime_and_demo.md`

## Hardware Needed

- Arduino Nano 33 BLE
- USB cable
- computer with Arduino IDE installed

## Before You Start

Make sure these files exist in `data_recording/`:

- `data_record_arduino_sketch.ino`
- `model_data.h`
- `model_settings.h`

The current exported model expects:

- `24` features
- `7` classes
- `50 Hz` inference sampling
- `100` samples per window
- `10` calibration windows

## Step 1: Open The Arduino Project

1. Open Arduino IDE.
2. Open the file `data_recording/data_record_arduino_sketch.ino`.
3. Make sure `model_data.h` and `model_settings.h` are in the same `data_recording/` folder.

## Step 2: Enable TinyML Inference

At the top of `data_recording/data_record_arduino_sketch.ino`, change:

```cpp
#define ENABLE_TINYML 0
```

to:

```cpp
#define ENABLE_TINYML 1
```

This turns on live model inference on the board.

## Step 3: Select The Correct Board

In Arduino IDE:

1. Go to `Tools -> Board`
2. Select `Arduino Nano 33 BLE`
3. Go to `Tools -> Port`
4. Select the correct USB serial port for the board

## Step 4: Install Required Libraries If Prompted

If Arduino IDE reports missing libraries, install:

- `Arduino_LSM9DS1`
- a TensorFlow Lite Micro Arduino library that provides `TensorFlowLite.h`

If your environment matches mine, the sketch compiled after these were available.

## Step 5: Verify / Compile

1. Click `Verify`
2. Confirm the sketch compiles with no errors

If compile fails, stop and fix that first before testing on hardware.

## Step 6: Upload The Sketch

1. Click `Upload`
2. Wait for upload to finish
3. Open `Serial Monitor`
4. Set baud rate to `115200`

On startup, you should see status/help lines such as:

```text
Commands: r=record, c=calibrate, i=infer, p=status, h=help
MODE,mode=record,sample_rate_hz=100,window_samples=100,cal_ready=0
STATUS,...
INFO,...
```

## Step 7: Understand The Modes

The board supports three modes:

- `r` = record raw sensor data
- `c` = calibration mode
- `i` = inference mode
- `p` = print runtime/calibration status
- `h` = print help

## Step 8: Calibrate A New User

Calibration should be done before inference.

What calibration does:

- collects about `10` walking windows
- computes the current user's walking baseline
- does not retrain the model
- only adjusts feature normalization at inference time

How to do it:

1. Wear the board in the normal waist position.
2. Open Serial Monitor.
3. Send the character `c`
4. Walk normally for about 20 seconds
5. Wait until calibration completes

Expected serial output:

```text
MODE,mode=calibrate,sample_rate_hz=50,window_samples=100,cal_ready=0
INFO,action=walk_normally_for_calibration
CALIBRATION,progress=1,target=10,ready=0
...
CALIBRATION,progress=10,target=10,ready=1
CALIBRATION,status=complete
CALIBRATION,status=ready,count=10,target=10,mode=calibrate
```

You can also send `p` to check status.

## Step 9: Start Live Inference

1. Send the character `i`
2. Keep wearing the board at the waist
3. Perform activities such as:
   - walking
   - sitting
   - standing
   - stairs
   - careful stumble-like tests
   - safe fall demo only if supervised and padded

If calibration has not been done yet, you will see:

```text
INFO,action=calibration_required_before_inference
```

## Step 10: Read The Inference Output

Each window produces one line like:

```text
INFER,mode=infer,window=12,pred=walking,conf=0.8125,top2=downstairs,top2_conf=0.1094,fall_state=none,fall_candidate=0,fall_alert=0,impact=0,low_motion=1,mag_mean=1.0234,mag_std=0.0412,mag_max=1.1311,mag_range=0.2023,mag_energy=1.0490,cal_ready=1,cal_count=10,fall_alerts=0,stumble_predictions=3
```

Most important fields:

- `pred`: top predicted class
- `conf`: confidence for top class
- `top2`: second most likely class
- `top2_conf`: confidence for second class
- `fall_state`: `none`, `pending`, or `alert`
- `fall_alert`: `1` means confirmed fall alert
- `cal_ready`: `1` means calibration is active

## Step 11: Understand Fall Confirmation

The board does lightweight post-processing after model inference.

A fall alert is not raised just because the model says `fall` once.

The runtime also checks:

- fall confidence threshold
- impact-like motion
- short follow-up confirmation across nearby windows
- low-motion behavior after the event when available

This is meant to reduce false positives from `stumbling`.

## Step 12: Optional Raw Recording Mode

If you want to record raw CSV data instead of live inference:

1. Send `r` in Serial Monitor
2. Or run the Python recorder script:

```bash
cd data_recording
python3 script.py
```

Before running `script.py`, update the serial port in:

- `data_recording/script.py`

That script is for dataset recording, not inference.

## Step 13: What To Test On Real Hardware

Run these tests in order:

1. Boot test
   - board powers on
   - serial output appears
2. Calibration test
   - `c` works
   - progress reaches `10/10`
   - `cal_ready=1`
3. Basic inference test
   - `i` works
   - `INFER,...` lines appear regularly
4. Walking test
   - predictions often show `walking`
5. Idle test
   - sitting/standing look stable
6. Stairs test
   - upstairs/downstairs produce reasonable outputs
7. Stumble test
   - should not easily jump to `fall_alert=1`
8. Safe fall demo
   - only do this with padding and supervision
   - check whether `fall_state` moves from `pending` to `alert`

## Expected Limitations

- The model is a university prototype, not a medical device.
- The biggest known weakness is still `fall` vs `stumbling` across different users.
- Post-processing helps, but does not make the system perfect.
- Real-world threshold tuning may still be needed after live testing.

## Quick Summary

If someone just wants the shortest possible steps:

1. Open `data_recording/data_record_arduino_sketch.ino`
2. Set `ENABLE_TINYML` to `1`
3. Select `Arduino Nano 33 BLE`
4. Verify and upload
5. Open Serial Monitor at `115200`
6. Send `c` and walk until calibration completes
7. Send `i` to start live inference
8. Watch `INFER,...` lines for predictions and fall alerts
