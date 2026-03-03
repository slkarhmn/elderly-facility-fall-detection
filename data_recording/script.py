import serial
import os
import csv
import time
import threading
from datetime import datetime

PORT = "COM3"  # Windows: "COM3", Mac: "/dev/cu.usbmodem..."
BAUD = 115200

ser = serial.Serial(PORT, BAUD, timeout=1)

# Wait for Arduino to boot and flush any garbage
time.sleep(2)
ser.reset_input_buffer()

# Skip the header line from Arduino
ser.readline()

# Hardcoded header
header = ["timestamp_ms", "ax", "ay", "az", "gx", "gy", "gz", "label"]

os.makedirs("data", exist_ok=True)

while True:
    label = input("\nEnter activity label (or 'quit' to exit): ").strip()
    if label == "quit":
        break

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
                if len(row) == 7:  # sanity check: 7 data columns expected
                    row.append(label)
                    writer.writerow(row)

    print(f"Saved: {filename}")

ser.close()
print("Done.")