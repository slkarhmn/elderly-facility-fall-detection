import serial
import os
import csv
import time
import threading
import re
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


def sanitize_tag(raw_value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "_", raw_value.strip().lower())
    return cleaned.strip("_")


participant_tag = sanitize_tag(
    input("Optional participant tag for filenames (e.g. user_1, sister, brother). Press Enter to skip: ")
)
if participant_tag:
    print(f"Using participant tag: {participant_tag}")

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
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    if participant_tag:
        filename = f"data/data_{label}_{participant_tag}_{timestamp}.csv"
    else:
        filename = f"data/data_{label}_{timestamp}.csv"
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