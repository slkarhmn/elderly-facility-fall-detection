# How to record data
Make sure you record data using a laptop, as this requires you to walk around holding the laptop while connected to the Arduino.

1. Plug in the Arduino to your computer and note down the port.
2. Open script.py, and change the port value to what you noted down.
3. Create a python environment and activate it
4. Run `pip install pyserial`
5. Once installed, place the Arduino board around your waist (using a belt, your hand, anything)
6. Run the script and follow the instructions. You must perform the activities while holding your computer, with the Arduino at your waist.
7. Make sure to record 10-15s of data for each activity. At least 10 times for each activity.
8. Once all data is saved to the data folder in new csv files, push the files to github

# Activities to Record
1. Walking (do this in different environments/floor types if possible)
2. Stumbling (make sure to do this in different environments, like on the stairs, even ground, uneven/rough ground, etc.)
3. Idle (this should be done both sitting and standing)
4. Walk up Stairs
5. Walk Down Stairs
6. Fall (this should be done sideways, front, and back. Please do this on a bed or beanbag or something soft. Don't break your laptop or the board)

## CSV File Columns
| Column | Description |
|---|---|
| `timestamp_ms` | Time in milliseconds since the Arduino powered on |
| `ax` | Acceleration X-axis (g-force) |
| `ay` | Acceleration Y-axis (g-force) |
| `az` | Acceleration Z-axis (g-force) |
| `gx` | Gyroscope X-axis (degrees/second) |
| `gy` | Gyroscope Y-axis (degrees/second) |
| `gz` | Gyroscope Z-axis (degrees/second) |
| `label` | Activity label you typed in (e.g. "walking") |

The accelerometer values are in **g** (1g ≈ 9.8 m/s²) and gyroscope in **°/s**, which is standard for the LSM9DS1 IMU on the Arduino Nano 33 BLE. All float values are recorded to 4 decimal places.