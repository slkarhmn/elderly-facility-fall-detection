# Fall and Activity Detection for Care Homes and Rehab Facilities

> Real-time fall detection for individuals and care facilities, powered by an Arduino Nano 33 BLE, a TinyML inference model, and an Expo React Native mobile app.

## Overview

This is an end-to-end fall detection system designed for two primary use cases:

- **Care homes / facilities**: managers can monitor all residents in real time, receive fall alerts with location data, and review activity history.
- **Independent living / home caregivers**: patients can set up emergency contacts to be automatically notified in the event of a fall.

A wearable Arduino Nano 33 BLE runs a TinyML model (on device) trained on IMU data to classify movement and detect falls. Inferences are broadcast over BLE, picked up by a Python Bleak scanner, and forwarded with location data to a backend server. The Expo / React Native app catches these alerts from a WebSocket, and sends them to care home managers, and also allows the patient to call a chosen emergency contact.

| Component       | Details                             |
| --------------- | ----------------------------------- |
| Microcontroller | Arduino Nano 33 BLE                 |
| Sensors         | Onboard LSM9DS1 IMU (accelerometer) |
| Connectivity    | Bluetooth Low Energy                |
| Power           | 2000 mAh USB powerbank              |

## Components

### Arduino Sketch (`/sketch`)
This is the firmware running on the Nano 33 BLE. It:
- Samples the IMU at a fixed frequency
- Runs inference using a quantised TFLite model via TensorFlow Lite for Microcontrollers
- Broadcasts the inference result (different activity states) as a BLE characteristic

**Key files:**
- `model_data.h` — compiled TFLite model as a C byte array
- `model_settings.h` — input shape, class labels, thresholds
- `sketch.ino` — main loop, IMU sampling, inference, BLE advertising

**Directories:**
ML Model (`/ml`): Training and conversion pipeline for the TinyML model:
- Data preprocessing and feature engineering from raw IMU recordings
- Model architecture (see `docs/model_overview.md`)
- Training scripts and export to `.tflite` + post-training quantisation
- Conversion to C header (`model_data.h`) for deployment

### BLE Scanner (`/beacon/scanner`)

A Python process (intended to run on a Raspberry Pi or similar hub) that:
- Scans for BLE advertisements from FallGuard devices
- Reads inference payloads from BLE characteristics
- Uses RSSI from known BLE beacons to estimate room/zone location
- POSTs inference events and location estimates to the backend server

### Server (`/beacon/server`)

Backend server that:
- Receives events from the BLE scanner
- Associates events with patient records
- Serves a REST / WebSocket API consumed by the mobile app
- Triggers push notifications for fall events

### Mobile App (`/fallguard`)

Expo React Native application with two distinct sides — see [App Usage](#app-usage).

### Data Recording (`/data_recording`)

Scripts for recording labelled IMU data from the board to use in model training. Handles serial capture, timestamping, and CSV export.

## Getting Started

### Prerequisites

- Arduino IDE or Arduino CLI with the following libraries:
  - `Arduino_LSM9DS1`
  - `ArduinoBLE`
  - `TensorFlowLite_ESP32` / Arduino TFLite Micro
- Python 3.9+
- Node.js 18+ and npm / yarn
- Expo CLI (`npm install -g expo-cli`)

### Arduino Setup
```bash
# Open in Arduino IDE
open sketch/Arduino.code-workspace

# Board: Arduino Nano 33 BLE
# Flash sketch.ino
```

### Python Environment Setup
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Server Setup
```bash
cd beacon/server
# Configure your .env (copy from .env.example)
python server.py
```

### BLE Scanner Setup
```bash
cd beacon/scanner
python scanner.py
```

### Mobile App Setup
```bash
cd fallguard
npm install
npx expo start
```
## App Usage

### Patient Side

- **Board Calibration** — walk with the device to record a baseline gait pattern; the model uses this to personalise fall detection thresholds
- **Emergency Contacts** — add contacts who will be called or messaged automatically if a fall is confirmed
- **Activity Feed** — view your own recent activity and any flagged events

*Best suited for independent living or home caregiving scenarios.*

### Manager Side

- **Resident Dashboard** — live overview of all residents and their current status
- **Fall & Alert Log** — timestamped log of falls and potential falls with room/zone location
- **Resident Profiles** — manage patient records and contact details
- **Notifications** — push alerts for any high-confidence fall events

*Designed for care home or assisted living facility staff.*

## Model Overview

See [`docs/model_overview.md`](docs/model_overview.md) for full details on:

- Input features (accelerometer + gyroscope axes, window size, sampling rate)
- Model architecture
- Training dataset and labelling methodology
- Quantisation approach
- Evaluation metrics and confusion matrix
## Data Flow
```
IMU sample (accelerometer + gyro)
  → fixed-length sliding window
  → TFLite inference on-device
  → BLE advertisement (inference class + confidence)
  → Python scanner (RSSI triangulation → location estimate)
  → POST to server (patient ID, inference, location, timestamp)
  → Push notification → mobile app
  → Manager dashboard / patient emergency contact call
```

## Install Instructions
### Firmware
`sketch/sketch.ino` needs to be flashed onto an Arduino Nano 33 BLE.

## Authors
This was a project developed for during the Mobile and Ubiquitous Computing Module at the University of Birmingham.

Team:
[devna-m](https://github.com/devna-m)
[notnrml](https://github.com/notnrml)
[slkarhmn](https://github.com/slkarhmn)
[xxivani](https://github.com/xxivani)
[Vishal-code-bit](https://github.com/Vishal-code-bit)
