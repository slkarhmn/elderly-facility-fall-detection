import serial
import os
import csv
import time
import threading
from datetime import datetime

PORT = "COM3"  # Windows: "COM3", Mac: "/dev/cu.usbmodem..."
BAUD = 115200

ACTIVITIES = [
    "walking",
    "stumbling",
    "idle_standing",
    "idle_sitting",
    "upstairs",
    "downstairs",
    "fall"
]

ser = serial.Serial(PORT, BAUD, timeout=1)
time.sleep(2)
ser.reset_input_buffer()
ser.readline()

header = ["timestamp_ms", "ax", "ay", "az", "gx", "gy", "gz", "label"]
os.makedirs("data", exist_ok=True)

while True:
    print("\nActivities:")
    for i, activity in enumerate(ACTIVITIES, 1):
        print(f"  {i}. {activity}")
    print("  0. quit")

    choice = input("\nEnter activity number: ").strip()

    if choice == "0":
        break

    if not choice.isdigit() or not (1 <= int(choice) <= len(ACTIVITIES)):
        print(f"Invalid choice. Please enter a number between 0 and {len(ACTIVITIES)}.")
        continue

    label = ACTIVITIES[int(choice) - 1]
    filename = f"data/data_{label}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    print(f"Recording '{label}' → {filename}")
    print("Press Enter to START, then Enter again to STOP...")
    input()

    with open(filename, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(header)
        print("Recording... press Enter to stop.")
        ser.reset_input_buffer()
        stop_flag = threading.Event()
        threading.Thread(target=lambda: (input(), stop_flag.set()), daemon=True).start()

        while not stop_flag.is_set():
            line = ser.readline().decode('utf-8').strip()
            if line and not line.startswith("timestamp") and not line.startswith("ERROR"):
                row = line.split(",")
                if len(row) == 7:
                    row.append(label)
                    writer.writerow(row)

    print(f"Saved: {filename}")

ser.close()
print("Done.")