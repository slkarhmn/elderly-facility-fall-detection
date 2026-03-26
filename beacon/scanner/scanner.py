import asyncio
from bleak import BleakScanner
import socket
import time

ROOM_NAME = "ROOM_A" # each scanner needs to change the room name
SERVER_IP = "127.0.0.1" # currently points to host machine
SERVER_PORT = 5000
FALL_UUID = "0000ff01-0000-1000-8000-00805f9b34fb"
PERIODIC_INTERVAL = 5 #sends updates every 5s
STUMBLE_ALERT_SECONDS = 10 #fall likely alert if alert if stumbling detected >10s

STATE_LABELS = {
    0: "walking",
    1: "stumbling",
    2: "idle_standing",
    3: "idle_sitting",
    4: "upstairs",
    5: "downstairs",
    6: "fall",
}

# patient_id → (rssi, state_index)
latest_patient_state = {}

# patient_id → timestamp stumbling started
stumble_start = {}

# patient_id → whether fall_likely alert already fired this stumble episode
stumble_alerted = {}


def send_to_server(patient_id, rssi, state_index, message_override=None):
    try:
        client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        client.connect((SERVER_IP, SERVER_PORT))
        payload = message_override if message_override else f"{patient_id},{ROOM_NAME},{rssi},{state_index}"
        client.send(payload.encode())
        client.close()
    except Exception:
        print("Server not reachable")

#stumble tracking
def handle_stumble_tracking(patient_id, rssi, state_index):
    if state_index == 1:
        if patient_id not in stumble_start:
            stumble_start[patient_id] = time.time()
            stumble_alerted[patient_id] = False
            print(f"{patient_id} started stumbling, watching...")
        elif not stumble_alerted[patient_id]:
            elapsed = time.time() - stumble_start[patient_id]
            if elapsed >= STUMBLE_ALERT_SECONDS:
                print(f"FALL LIKELY: {patient_id} stumbling for {elapsed:.1f}s")
                send_to_server(
                    patient_id, rssi, state_index,
                    message_override=f"{patient_id},{ROOM_NAME},{rssi},FALL_LIKELY"
                )
                stumble_alerted[patient_id] = True
    else:
        if patient_id in stumble_start:
            print(f"{patient_id} stopped stumbling")
            del stumble_start[patient_id]
            del stumble_alerted[patient_id]

#BLE detection callback
def detection_callback(device, advertisement_data):
    if not (device.name and device.name.startswith("PATIENT_")):
        return

    patient_id = device.name
    rssi = advertisement_data.rssi

    state_index = None
    mfr_data = advertisement_data.manufacturer_data or {}
    #reads encoded state from BLE packet
    if 0xFFFF in mfr_data:
        payload = mfr_data[0xFFFF]
        if len(payload) >= 1:
            state_index = payload[0]

    if state_index is None:
        uuids = [str(u).lower() for u in (advertisement_data.service_uuids or [])]
        state_index = 6 if FALL_UUID in uuids else 255

    label = STATE_LABELS.get(state_index, "unknown")
    print(f"{patient_id} → {ROOM_NAME} | RSSI: {rssi} | State: {label} ({state_index})")

    latest_patient_state[patient_id] = (rssi, state_index)

    if state_index == 6: #instant fall detection
        print(f"⚡ Instant fall alert for {patient_id}")
        send_to_server(patient_id, rssi, state_index)

    handle_stumble_tracking(patient_id, rssi, state_index)


async def periodic_state_reporter():
    while True:
        await asyncio.sleep(PERIODIC_INTERVAL)
        if not latest_patient_state:
            print("No patients detected yet, nothing to report.")
            continue
        print(f"📡 Sending periodic update for {len(latest_patient_state)} patient(s)...")
        for patient_id, (rssi, state_index) in latest_patient_state.items():
            if state_index == 6:
                continue  # already sent instantly on detection
            label = STATE_LABELS.get(state_index, "unknown")
            print(f"  → {patient_id}: {label} ({state_index})")
            send_to_server(patient_id, rssi, state_index)


async def run():
    scanner = BleakScanner(detection_callback)
    await scanner.start() #starts BLE scanning
    print(f"Scanning in {ROOM_NAME}...")
    try:
        await periodic_state_reporter()
    except KeyboardInterrupt:
        pass
    finally:
        await scanner.stop()
        print("Scanner stopped.")


asyncio.run(run())