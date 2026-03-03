#include <Arduino_LSM9DS1.h>

const int SAMPLE_INTERVAL_MS = 10; // 100Hz
unsigned long lastSampleTime = 0;

void setup() {
  Serial.begin(115200);
  while (!Serial);
  if (!IMU.begin()) {
    Serial.println("ERROR");
    while (1);
  }
  Serial.println("timestamp_ms,ax,ay,az,gx,gy,gz");
}

void loop() {
  unsigned long now = millis();
  if (now - lastSampleTime >= SAMPLE_INTERVAL_MS) {
    lastSampleTime = now;
    float ax, ay, az, gx, gy, gz;
    if (IMU.accelerationAvailable() && IMU.gyroscopeAvailable()) {
      IMU.readAcceleration(ax, ay, az);
      IMU.readGyroscope(gx, gy, gz);
      Serial.print(now);   Serial.print(",");
      Serial.print(ax, 4); Serial.print(",");
      Serial.print(ay, 4); Serial.print(",");
      Serial.print(az, 4); Serial.print(",");
      Serial.print(gx, 4); Serial.print(",");
      Serial.print(gy, 4); Serial.print(",");
      Serial.println(gz, 4);
    }
  }
}