/*
  00_test_imu

  Najprostszy test okablowania ESP32-S3 + LSM6DSOX.
  Program uzywa biblioteki Adafruit_LSM6DSOX, konfiguruje zakresy projektu
  i wypisuje 6 osi IMU co 100 ms.
*/

#include <Adafruit_LSM6DSOX.h>
#include <Wire.h>

constexpr uint8_t PIN_SDA = 8;
constexpr uint8_t PIN_SCL = 9;
constexpr uint8_t LSM6DSOX_ADDR_PRIMARY = 0x6A;
constexpr uint8_t LSM6DSOX_ADDR_FALLBACK = 0x6B;

Adafruit_LSM6DSOX imu;

bool beginImuAt(uint8_t address) {
  Serial.print("Proba inicjalizacji LSM6DSOX pod adresem 0x");
  Serial.println(address, HEX);
  return imu.begin_I2C(address, &Wire);
}

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println();
  Serial.println("00_test_imu: test 6 osi LSM6DSOX");

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);

  if (!beginImuAt(LSM6DSOX_ADDR_PRIMARY) && !beginImuAt(LSM6DSOX_ADDR_FALLBACK)) {
    Serial.println("BLAD: nie znaleziono LSM6DSOX. Sprawdz VIN/GND/SDA/SCL i adres I2C.");
    while (true) {
      delay(1000);
    }
  }

  // Zakresy zgodne ze stalymi projektu.
  imu.setAccelRange(LSM6DS_ACCEL_RANGE_8_G);
  imu.setGyroRange(LSM6DS_GYRO_RANGE_1000_DPS);
  imu.setAccelDataRate(LSM6DS_RATE_104_HZ);
  imu.setGyroDataRate(LSM6DS_RATE_104_HZ);

  Serial.println("IMU gotowe: accel +/-8 g, gyro +/-1000 dps, ODR 104 Hz");
  Serial.println("Czas_ms, AccX_g, AccY_g, AccZ_g, GyrX_dps, GyrY_dps, GyrZ_dps");
}

void loop() {
  sensors_event_t accel;
  sensors_event_t gyro;
  sensors_event_t temp;
  imu.getEvent(&accel, &gyro, &temp);

  // Adafruit zwraca akceleracje w m/s^2 i zyroskop w rad/s.
  // Model KFall uzywa typowo g oraz deg/s, wiec tutaj pokazujemy te jednostki.
  const float ax_g = accel.acceleration.x / 9.80665f;
  const float ay_g = accel.acceleration.y / 9.80665f;
  const float az_g = accel.acceleration.z / 9.80665f;
  const float gx_dps = gyro.gyro.x * 57.2957795f;
  const float gy_dps = gyro.gyro.y * 57.2957795f;
  const float gz_dps = gyro.gyro.z * 57.2957795f;

  Serial.print(millis());
  Serial.print(", ");
  Serial.print(ax_g, 4);
  Serial.print(", ");
  Serial.print(ay_g, 4);
  Serial.print(", ");
  Serial.print(az_g, 4);
  Serial.print(", ");
  Serial.print(gx_dps, 2);
  Serial.print(", ");
  Serial.print(gy_dps, 2);
  Serial.print(", ");
  Serial.println(gz_dps, 2);

  delay(100);
}

