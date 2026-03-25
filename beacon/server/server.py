import socket
import time

HOST = "0.0.0.0"
PORT = 5000

patient_data = {}

def start_server():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind((HOST, PORT))
    server.listen()

    print("Server started...")

    while True:
        conn, addr = server.accept()
        data = conn.recv(1024).decode()
        conn.close()

        try:
            patient_id, room, rssi = data.split(",")
            rssi = int(rssi)

            update_patient(patient_id, room, rssi)

        except:
            pass

def update_patient(patient_id, room, rssi):
    current_time = time.time()

    if patient_id not in patient_data:
        patient_data[patient_id] = {}

    patient_data[patient_id][room] = (rssi, current_time)

    determine_location(patient_id)

def determine_location(patient_id):
    current_time = time.time()
    rooms = patient_data[patient_id]

    
    valid = {
        room: rssi for room, (rssi, t) in rooms.items()
        if current_time - t < 5
    }

    if not valid:
        return

    best_room = max(valid, key=valid.get)

    print(f"{patient_id} → {best_room}")

start_server()