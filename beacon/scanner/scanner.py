import asyncio
from bleak import BleakScanner
import socket

ROOM_NAME = "ROOM_A"
//each scanner needs to change the room name
SERVER_IP = "127.0.0.1" //points to host machine
//each scanner needs to change the IP to point to the server laptop
SERVER_PORT = 5000

def send_to_server(patient_id, rssi):
    try:
        client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        client.connect((SERVER_IP, SERVER_PORT))
        message = f"{patient_id},{ROOM_NAME},{rssi}"
        client.send(message.encode())
        client.close()
    except:
        print("Server not reachable")

# Windows-compatible callback
def detection_callback(device, advertisement_data):
    if device.name and device.name.startswith("PATIENT_"):
        patient_id = device.name

        
        rssi = advertisement_data.rssi
        print(f"{patient_id} → {ROOM_NAME} | RSSI: {rssi}")

        send_to_server(patient_id, rssi)

async def run():
    scanner = BleakScanner(detection_callback)
    await scanner.start()
    print(f"Scanning in {ROOM_NAME}...")
    try:
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        await scanner.stop()
        print("Scanner stopped.")

asyncio.run(run())