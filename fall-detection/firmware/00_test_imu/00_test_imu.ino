#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_LSM6DSOX.h>
#include <Adafruit_Sensor.h>

// ====== Stałe sprzętowe ======
constexpr uint8_t PIN_SDA = 8;
constexpr uint8_t PIN_SCL = 9;
constexpr uint32_t SERIAL_BAUD = 115200;

constexpr uint8_t I2C_ADDR_PRIMARY = 0x6A;
constexpr uint8_t I2C_ADDR_FALLBACK = 0x6B;

Adafruit_LSM6DSOX imu;

void configureImu() {
  // Konfiguracja zgodna z założeniami projektu.
  imu.setAccelRange(LSM6DS_ACCEL_RANGE_8_G);
  imu.setGyroRange(LSM6DS_GYRO_RANGE_1000_DPS);
  imu.setAccelDataRate(LSM6DS_RATE_104_HZ);
  imu.setGyroDataRate(LSM6DS_RATE_104_HZ);
}

bool beginImuWithFallback() {
  if (imu.begin_I2C(I2C_ADDR_PRIMARY, &Wire)) {
    Serial.println("[IMU] Wykryto LSM6DSOX pod adresem 0x6A");
    return true;
  }

  if (imu.begin_I2C(I2C_ADDR_FALLBACK, &Wire)) {
    Serial.println("[IMU] Wykryto LSM6DSOX pod adresem 0x6B (fallback)");
    return true;
  }

  return false;
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(1000);
  Serial.println("\n=== 00_test_imu: diagnostyka 6 osi ===");

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);

  if (!beginImuWithFallback()) {
    Serial.println("[BLAD] Nie wykryto LSM6DSOX pod 0x6A ani 0x6B.");
    while (true) {
      delay(1000);
    }
  }

  configureImu();
  Serial.println("[OK] IMU skonfigurowane: +/-8g, +/-1000dps, 104Hz");
}

void loop() {
  sensors_event_t accel, gyro, temp;
  imu.getEvent(&accel, &gyro, &temp);

  // Wypis surowych 6 osi co 100 ms.
  Serial.print("ACC[m/s^2] ");
  Serial.print(accel.acceleration.x, 4);
  Serial.print(", ");
  Serial.print(accel.acceleration.y, 4);
  Serial.print(", ");
  Serial.print(accel.acceleration.z, 4);

  Serial.print(" | GYRO[rad/s] ");
  Serial.print(gyro.gyro.x, 4);
  Serial.print(", ");
  Serial.print(gyro.gyro.y, 4);
  Serial.print(", ");
  Serial.println(gyro.gyro.z, 4);

  delay(100);
}
