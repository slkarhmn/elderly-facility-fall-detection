# WebSocket Broadcast Packet Formats:
#
# Snapshot (sent to newly connected clients if patient data exists):
#   { "type": "snapshot", "patients": { "<patient_id>": { "location": "<room>", "state": "<label>", "state_index": <int>, "rooms": { "<room>": <rssi>, ... }, "name": "<name>", "contacts": [...] } } }
#
# Fall detected:
#   { "type": "fall", "patient_id": "<id>", "room": "<room>", "name": "<name>", "contacts": [...] }
#
# Fall likely:
#   { "type": "fall_likely", "patient_id": "<id>", "room": "<room>", "name": "<name>", "contacts": [...] }
#
# State change / Heartbeat:
#   { "type": "state_change"|"heartbeat", "patient_id": "<id>", "room": "<room>", "rssi": <int>, "state_index": <int>, "state": "<label>", "location": "<best_room>", "name": "<name>", "contacts": [...] }
#
# Registration confirmation (sent back to registering client):
#   { "type": "registered", "patient_id": "<id>" }
#
# Incoming WebSocket message (sent from patient app to server):
#   { "type": "register", "patient_id": "<id>", "name": "<name>", "age": "<age>", "room": "<room>", "facility": "<facility>", "contacts": [...] }
#
# State labels: 0=walking, 1=stumbling, 2=idle_standing, 3=idle_sitting, 4=upstairs, 5=downstairs, 6=fall

import asyncio
import socket
import time
import json
import websockets
from websockets.exceptions import ConnectionClosedError, ConnectionClosedOK

HOST = "0.0.0.0"
TCP_PORT = 5000
WS_PORT = 5001

connected_clients = set()

patient_data = {}
patient_last_state = {}
fall_alert_latch = {}
patient_registry = {}  # patient_id -> { name, age, room, facility, contacts }

FALL_LATCH_SECONDS = 60
STALE_THRESHOLD = 30

STATE_LABELS = {
    0: "walking",
    1: "stumbling",
    2: "idle_standing",
    3: "idle_sitting",
    4: "upstairs",
    5: "downstairs",
    6: "fall",
}

# websocket connection handler
async def ws_handler(websocket):
    print(f"App connected: {websocket.remote_address}")
    connected_clients.add(websocket)
    try:
        if patient_data:
            await websocket.send(json.dumps({
                "type": "snapshot",
                "patients": build_patient_snapshot()
            }))

        async for message in websocket:
            try:
                data = json.loads(message)
                msg_type = data.get("type")

                if msg_type == "register":
                    patient_id = data.get("patient_id")
                    if not patient_id:
                        print("Register message missing patient_id, ignoring")
                        continue

                    patient_registry[patient_id] = {
                        "name": data.get("name", "Unknown"),
                        "age": data.get("age", ""),
                        "room": data.get("room", ""),
                        "facility": data.get("facility", ""),
                        "contacts": data.get("contacts", []),
                    }
                    print(f"Patient registered: {patient_id} — {patient_registry[patient_id]['name']}")
                    await websocket.send(json.dumps({
                        "type": "registered",
                        "patient_id": patient_id
                    }))

                else:
                    print(f"Unknown message type from app: {msg_type!r}")

            except json.JSONDecodeError as e:
                print(f"Invalid JSON from app {websocket.remote_address}: {e}")

    except ConnectionClosedOK:
        pass
    except ConnectionClosedError as e:
        print(f"Client {websocket.remote_address} dropped connection: {e}")
    finally:
        connected_clients.discard(websocket)
        print(f"App disconnected: {websocket.remote_address}")


# broadcasts messages to all connected clients, pruning dead ones
async def broadcast(message: dict):
    if not connected_clients:
        return
    payload = json.dumps(message)
    dead = set()
    for client in connected_clients:
        try:
            await client.send(payload)
        except (ConnectionClosedError, ConnectionClosedOK):
            dead.add(client)
    connected_clients.difference_update(dead)  


# builds full patient state snapshot
def build_patient_snapshot():
    current_time = time.time()
    snapshot = {}
    for patient_id, rooms in patient_data.items():
        valid = {
            room: rssi for room, (rssi, t) in rooms.items()
            if current_time - t < STALE_THRESHOLD
        }
        best_room = max(valid, key=valid.get) if valid else None
        snapshot[patient_id] = {
            "location": best_room,
            "state": STATE_LABELS.get(patient_last_state.get(patient_id), "unknown"),
            "state_index": patient_last_state.get(patient_id),
            "rooms": {r: v for r, v in valid.items()},
            **get_registry(patient_id),
        }
    return snapshot


# returns flattened registry info for broadcast payloads
def get_registry(patient_id):
    reg = patient_registry.get(patient_id, {})
    return {
        "name": reg.get("name", "Unknown"),
        "contacts": reg.get("contacts", []),
    }


# handles incoming scanner TCP packets
async def handle_scanner_packet(reader, writer):
    addr = writer.get_extra_info('peername')
    data = (await reader.read(1024)).decode()
    writer.close()
    print(f"Packet from {addr}: {data!r}")

    try:
        parts = data.split(",")
        if len(parts) != 4:
            print(f"Malformed packet: {data!r}")
            return

        patient_id, room, rssi_str, state_raw = parts
        rssi = int(rssi_str)

        if state_raw.strip() == "FALL_LIKELY":
            print(f"FALL_LIKELY: {patient_id} in {room}")
            await broadcast({
                "type": "fall_likely",
                "patient_id": patient_id,
                "room": room,
                **get_registry(patient_id),
            })
            return

        state_index = int(state_raw)
        label = STATE_LABELS.get(state_index, "unknown")
        changed = await update_patient(patient_id, room, rssi, state_index)

        await broadcast({
            "type": "state_change" if changed else "heartbeat",
            "patient_id": patient_id,
            "room": room,
            "rssi": rssi,
            "state_index": state_index,
            "state": label,
            "location": get_best_room(patient_id),
            **get_registry(patient_id),
        })

    except Exception as e:
        print(f"Failed to parse packet {data!r}: {e}")


# updates patient data and detects state changes
async def update_patient(patient_id, room, rssi, state_index):
    """Returns True if the state changed, False if it was a heartbeat."""
    current_time = time.time()

    if patient_id not in patient_data:
        patient_data[patient_id] = {}
        print(f"New patient detected: {patient_id}")

    patient_data[patient_id][room] = (rssi, current_time)

    last = patient_last_state.get(patient_id)
    state_changed = state_index != last
    patient_last_state[patient_id] = state_index

    if state_changed and state_index == 6:
        await trigger_fall_alert(patient_id, room)

    return state_changed


# fall alert with debounce latch
async def trigger_fall_alert(patient_id, room):
    current_time = time.time()
    already_alerting = (
        patient_id in fall_alert_latch and
        current_time - fall_alert_latch[patient_id] < FALL_LATCH_SECONDS
    )
    fall_alert_latch[patient_id] = current_time
    if not already_alerting:
        reg = get_registry(patient_id)
        print(f"FALL DETECTED: {reg['name']} ({patient_id}) in {room}")
        await broadcast({
            "type": "fall",
            "patient_id": patient_id,
            "room": room,
            **reg,
        })


# determine best room based on RSSI
def get_best_room(patient_id):
    current_time = time.time()
    rooms = patient_data.get(patient_id, {})
    valid = {r: rssi for r, (rssi, t) in rooms.items() if current_time - t < STALE_THRESHOLD}
    return max(valid, key=valid.get) if valid else None


# clears expired fall latches
async def check_latch_expirations():
    """Runs in the background, clearing expired fall latches every second."""
    while True:
        await asyncio.sleep(1)
        current_time = time.time()
        for patient_id, last_seen in list(fall_alert_latch.items()):
            if current_time - last_seen >= FALL_LATCH_SECONDS:
                print(f"{patient_id} fall alert cleared")
                del fall_alert_latch[patient_id]


async def main():
    tcp_server = await asyncio.start_server(handle_scanner_packet, HOST, TCP_PORT)
    ws_server = await websockets.serve(ws_handler, HOST, WS_PORT)

    hostname = socket.gethostname()
    local_ips = socket.getaddrinfo(hostname, None, socket.AF_INET)
    ip_list = list({info[4][0] for info in local_ips})

    print(f"TCP server listening on port {TCP_PORT} (room scanners)")
    print(f"WebSocket server listening on port {WS_PORT} (app clients)")
    print(f"Available on:")
    for ip in ip_list:
        print(f"TCP: {ip}:{TCP_PORT}")
        print(f"WS:  ws://{ip}:{WS_PORT}")

    await asyncio.gather(
        tcp_server.serve_forever(),
        ws_server.serve_forever(),
        check_latch_expirations(),
    )

asyncio.run(main())