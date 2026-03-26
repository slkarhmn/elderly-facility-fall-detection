# WebSocket Broadcast Packet Formats:
#
# Snapshot (sent to newly connected clients if patient data exists):
#   { "type": "snapshot", "patients": { "<patient_id>": { "location": "<room>", "state": "<label>", "state_index": <int>, "rooms": { "<room>": <rssi>, ... } }, ... } }
#
# Fall detected (state index 6, debounced by FALL_LATCH_SECONDS):
#   { "type": "fall", "patient_id": "<id>", "room": "<room>" }
#
# Fall likely (raw FALL_LIKELY string received from scanner):
#   { "type": "fall_likely", "patient_id": "<id>", "room": "<room>" }
#
# State change (patient state changed since last packet):
#   { "type": "state_change", "patient_id": "<id>", "room": "<room>", "rssi": <int>, "state_index": <int>, "state": "<label>", "location": "<best_room>" }
#
# Heartbeat (patient state unchanged):
#   { "type": "heartbeat", "patient_id": "<id>", "room": "<room>", "rssi": <int>, "state_index": <int>, "state": "<label>", "location": "<best_room>" }
#
# State labels: 0=walking, 1=stumbling, 2=idle_standing, 3=idle_sitting, 4=upstairs, 5=downstairs, 6=fall

import asyncio
import socket
import time
import json 
import websockets   

HOST = "0.0.0.0" #listens on all network interfaces
TCP_PORT = 5000  
WS_PORT = 5001       

connected_clients = set()

patient_data = {}
patient_last_state = {}
fall_alert_latch = {} #prevents spam alerts

FALL_LATCH_SECONDS = 60 #ignores duplicate falls within 10s
STALE_THRESHOLD = 30 #ignores RSSI data older than this

STATE_LABELS = {
    0: "walking",
    1: "stumbling",
    2: "idle_standing",
    3: "idle_sitting",
    4: "upstairs",
    5: "downstairs",
    6: "fall",
}
#websocket connection handler
async def ws_handler(websocket):
    print(f"App connected: {websocket.remote_address}")
    connected_clients.add(websocket)
    try:
        if patient_data:
            await websocket.send(json.dumps({
                "type": "snapshot",
                "patients": build_patient_snapshot()
            }))
        await websocket.wait_closed()
    finally:
        connected_clients.discard(websocket)
        print(f"App disconnected: {websocket.remote_address}")

#broadcasts messages to all connected clients
async def broadcast(message: dict):
    if not connected_clients:
        return
    payload = json.dumps(message)
    websockets.broadcast(connected_clients, payload) #sends message to all connected apps

#builds full patient state
def build_patient_snapshot():
    current_time = time.time()
    snapshot = {}
    for patient_id, rooms in patient_data.items():
        valid = {
            room: rssi for room, (rssi, t) in rooms.items()
            if current_time - t < STALE_THRESHOLD
        }
        #determines best location based on strongest signal
        best_room = max(valid, key=valid.get) if valid else None
        snapshot[patient_id] = {
            "location": best_room,
            "state": STATE_LABELS.get(patient_last_state.get(patient_id), "unknown"),
            "state_index": patient_last_state.get(patient_id),
            "rooms": {r: v for r, v in valid.items()}
        }
    return snapshot

#handles incoming scanner TCP packets
async def handle_scanner_packet(reader, writer):
    addr = writer.get_extra_info('peername')
    data = (await reader.read(1024)).decode()
    writer.close()
    print(f"Packet from {addr}: {data!r}")

    #validate packet format
    try:
        parts = data.split(",")
        if len(parts) != 4:
            print(f"Malformed packet: {data!r}")
            return

        patient_id, room, rssi_str, state_raw = parts
        rssi = int(rssi_str)
        #fall likely state based on stumbling
        if state_raw.strip() == "FALL_LIKELY":
            print(f"FALL_LIKELY: {patient_id} in {room}")
            await broadcast({
                "type": "fall_likely",
                "patient_id": patient_id,
                "room": room,
            })
            return
        
        #normal state processing
        state_index = int(state_raw) #normal state
        label = STATE_LABELS.get(state_index, "unknown")
        #update patient data and check if state changed
        changed = await update_patient(patient_id, room, rssi, state_index)

        #broadcast update to clients
        await broadcast({
            "type": "state_change" if changed else "heartbeat", #broadcast update
            "patient_id": patient_id,
            "room": room,
            "rssi": rssi,
            "state_index": state_index,
            "state": label,
            "location": get_best_room(patient_id),
        })

    except Exception as e:
        print(f"Failed to parse packet {data!r}: {e}")

#updates patient data and detects state changes
async def update_patient(patient_id, room, rssi, state_index):
    """Returns True if the state changed, False if it was a heartbeat."""
    current_time = time.time()

    #register new patient if seen for first time
    if patient_id not in patient_data:
        patient_data[patient_id] = {}
        print(f"New patient registered: {patient_id}")

    #update room RSSI and timestamp
    patient_data[patient_id][room] = (rssi, current_time)


    last = patient_last_state.get(patient_id)
    state_changed = state_index != last
    patient_last_state[patient_id] = state_index

    if state_changed and state_index == 6:
        await trigger_fall_alert(patient_id, room)

    return state_changed

#fall alert logic
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
        })

#determine best room based on RSSI
def get_best_room(patient_id):
    current_time = time.time()
    rooms = patient_data.get(patient_id, {})
    valid = {r: rssi for r, (rssi, t) in rooms.items() if current_time - t < STALE_THRESHOLD}
    return max(valid, key=valid.get) if valid else None

#clears expired fall alerts
async def check_latch_expirations():
    """Runs in the background, clearing expired fall latches every second."""
    while True:
        await asyncio.sleep(1)
        current_time = time.time()
        for patient_id, last_seen in list(fall_alert_latch.items()):
            if current_time - last_seen >= FALL_LATCH_SECONDS:
                print(f"{patient_id} fall alert cleared")
                del fall_alert_latch[patient_id]

#main   
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