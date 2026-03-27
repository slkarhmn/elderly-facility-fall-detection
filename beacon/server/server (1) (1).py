# WebSocket Broadcast Packet Formats:
#
# Snapshot (sent to newly connected clients if patient data exists):
#   { "type": "snapshot", "patients": { "<patient_id>": { "location": "<room>", "state": "<label>", "state_index": <int>, "rooms": { "<room>": <rssi>, ... }, "profile": { ... } } } }
#
# Fall detected (state index 6, debounced by FALL_LATCH_SECONDS):
#   { "type": "fall", "patient_id": "<id>", "room": "<room>" }
#
# Fall likely (raw FALL_LIKELY string received from scanner):
#   { "type": "fall_likely", "patient_id": "<id>", "room": "<room>" }
#
# State change (patient state changed since last packet):
#   { "type": "state_change", "patient_id": "<id>", "room": "<room>", "rssi": <int>, "state_index": <int>, "state": "<label>", "location": "<best_room>", "profile": { ... } | null }
#
# Heartbeat (patient state unchanged):
#   { "type": "heartbeat", "patient_id": "<id>", "room": "<room>", "rssi": <int>, "state_index": <int>, "state": "<label>", "location": "<best_room>", "profile": { ... } | null }
#
# Registered (confirmation sent back to registering client):
#   { "type": "registered", "patient_id": "<id>" }
#
# Incoming from app (register message):
#   { "type": "register", "patient_id": "<id>", "name": "<name>", "age": "<age>", "room": "<room>", "facility": "<facility>", "contacts": [ { "name", "phone", "relation", "isPrimary" } ] }
#
# State labels: 0=walking, 1=stumbling, 2=idle_standing, 3=idle_sitting, 4=upstairs, 5=downstairs, 6=fall

import asyncio
import socket
import time
import json
import websockets

HOST = "0.0.0.0"
TCP_PORT = 5000
WS_PORT = 5001

connected_clients = set()

patient_data = {}         # patient_id → { room: (rssi, timestamp) }
patient_last_state = {}   # patient_id → state_index
patient_profiles = {}     # patient_id → profile dict (from register message)
fall_alert_latch = {}

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

# ── WebSocket handler ──────────────────────────────────────────────────────────
async def ws_handler(websocket):
    print(f"App connected: {websocket.remote_address}")
    connected_clients.add(websocket)
    try:
        # Send current snapshot to newly connected client
        if patient_data:
            await websocket.send(json.dumps({
                "type": "snapshot",
                "patients": build_patient_snapshot()
            }))

        # Read incoming messages (e.g. register from resident app)
        async for raw in websocket:
            try:
                msg = json.loads(raw)
                msg_type = msg.get("type")

                if msg_type == "register":
                    await handle_register(websocket, msg)
                else:
                    print(f"Unknown message type from app: {msg_type!r}")

            except json.JSONDecodeError:
                print(f"Non-JSON message from app: {raw!r}")

    finally:
        connected_clients.discard(websocket)
        print(f"App disconnected: {websocket.remote_address}")


# ── Handle register message from resident app ──────────────────────────────────
async def handle_register(websocket, msg):
    patient_id = msg.get("patient_id")
    if not patient_id:
        print("Register message missing patient_id, ignoring.")
        return

    profile = {
        "name":     msg.get("name", "Unknown"),
        "age":      msg.get("age", ""),
        "room":     msg.get("room", ""),
        "facility": msg.get("facility", ""),
        "contacts": msg.get("contacts", []),
    }

    patient_profiles[patient_id] = profile
    print(f"Registered profile for {patient_id}: {profile['name']} in {profile['room']}")

    # Confirm back to the registering app
    await websocket.send(json.dumps({
        "type": "registered",
        "patient_id": patient_id,
    }))

    # Broadcast updated profile to all manager clients so they see it immediately
    # even if no scanner packet has arrived yet
    await broadcast({
        "type": "profile_update",
        "patient_id": patient_id,
        "profile": profile,
    })


# ── Broadcast to all connected clients ────────────────────────────────────────
async def broadcast(message: dict):
    if not connected_clients:
        return
    payload = json.dumps(message)
    websockets.broadcast(connected_clients, payload)


# ── Build full patient snapshot ────────────────────────────────────────────────
def build_patient_snapshot():
    current_time = time.time()
    snapshot = {}

    # Include patients seen by scanner
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
            "profile": patient_profiles.get(patient_id),
        }

    # Also include registered patients not yet seen by scanner
    for patient_id, profile in patient_profiles.items():
        if patient_id not in snapshot:
            snapshot[patient_id] = {
                "location": profile.get("room"),
                "state": "offline",
                "state_index": None,
                "rooms": {},
                "profile": profile,
            }

    return snapshot


# ── Handle incoming TCP scanner packet ────────────────────────────────────────
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
                "profile": patient_profiles.get(patient_id),
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
            "profile": patient_profiles.get(patient_id),  # ← attached here
        })

    except Exception as e:
        print(f"Failed to parse packet {data!r}: {e}")


# ── Update patient state ───────────────────────────────────────────────────────
async def update_patient(patient_id, room, rssi, state_index):
    current_time = time.time()

    if patient_id not in patient_data:
        patient_data[patient_id] = {}
        print(f"New patient seen by scanner: {patient_id}")

    patient_data[patient_id][room] = (rssi, current_time)

    last = patient_last_state.get(patient_id)
    state_changed = state_index != last
    patient_last_state[patient_id] = state_index

    if state_changed and state_index == 6:
        await trigger_fall_alert(patient_id, room)

    return state_changed


# ── Fall alert ─────────────────────────────────────────────────────────────────
async def trigger_fall_alert(patient_id, room):
    current_time = time.time()
    already_alerting = (
        patient_id in fall_alert_latch and
        current_time - fall_alert_latch[patient_id] < FALL_LATCH_SECONDS
    )
    fall_alert_latch[patient_id] = current_time
    if not already_alerting:
        print(f"FALL DETECTED: {patient_id} in {room}")
        await broadcast({
            "type": "fall",
            "patient_id": patient_id,
            "room": room,
            "profile": patient_profiles.get(patient_id),
        })


# ── Best room ──────────────────────────────────────────────────────────────────
def get_best_room(patient_id):
    current_time = time.time()
    rooms = patient_data.get(patient_id, {})
    valid = {r: rssi for r, (rssi, t) in rooms.items() if current_time - t < STALE_THRESHOLD}
    return max(valid, key=valid.get) if valid else None


# ── Latch expiry background task ───────────────────────────────────────────────
async def check_latch_expirations():
    while True:
        await asyncio.sleep(1)
        current_time = time.time()
        for patient_id, last_seen in list(fall_alert_latch.items()):
            if current_time - last_seen >= FALL_LATCH_SECONDS:
                print(f"{patient_id} fall alert cleared")
                del fall_alert_latch[patient_id]


# ── Main ───────────────────────────────────────────────────────────────────────
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
        print(f"  TCP: {ip}:{TCP_PORT}")
        print(f"  WS:  ws://{ip}:{WS_PORT}")

    await asyncio.gather(
        tcp_server.serve_forever(),
        ws_server.serve_forever(),
        check_latch_expirations(),
    )

asyncio.run(main())
