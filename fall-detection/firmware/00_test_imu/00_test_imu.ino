/*
 * 00_test_imu — najprostszy szkic diagnostyczny dla LSM6DSOX.
 *
 * Cel:
 *   - sprawdzic, czy okablowanie I2C jest poprawne,
 *   - potwierdzic WHO_AM_I = 0x6C,
 *   - przyswiczyc plytke do konfiguracji ODR=104Hz, ±8g, ±1000dps,
 *   - wypisac 6 osi na Serial @ 115200 co 100 ms.
 *
 * Wgraj ten szkic JAKO PIERWSZY na ESP32-S3 Dev Module. Jezeli tu zobaczysz
 * sensowne wartosci, mozna isc dalej (preprocess/train -> 03_fall_detector).
 *
 * Polaczenia:
 *   LSM6DSOX VIN -> 3V3
 *   LSM6DSOX GND -> GND
 *   LSM6DSOX SDA -> GPIO 8
 *   LSM6DSOX SCL -> GPIO 9
 *
 * UWAGA: w Arduino IDE wlacz "USB CDC On Boot = Enabled", inaczej Serial milczy.
 */

#include <Wire.h>
#include <Adafruit_LSM6DSOX.h>

// --- Stale pinow / I2C ---
static constexpr int PIN_SDA      = 8;
static constexpr int PIN_SCL      = 9;
static constexpr uint8_t I2C_ADDR_PRIMARY  = 0x6A;  // gdy SA0 = GND
static constexpr uint8_t I2C_ADDR_FALLBACK = 0x6B;  // gdy SA0 = VCC

// Obiekt biblioteki Adafruit
Adafruit_LSM6DSOX imu;

// Probkujemy "diagnostycznie" co 100 ms.
static constexpr uint32_t SAMPLE_PERIOD_MS = 100;
static uint32_t lastSampleMs = 0;

// Probuje zainicjowac LSM6DSOX, najpierw na 0x6A, potem na 0x6B.
// Zwraca true w razie sukcesu i wypisuje znaleziony adres.
static bool initIMU() {
  if (imu.begin_I2C(I2C_ADDR_PRIMARY, &Wire)) {
    Serial.printf("[OK] LSM6DSOX znaleziony pod adresem 0x%02X\n", I2C_ADDR_PRIMARY);
    return true;
  }
  Serial.printf("[INFO] Brak odpowiedzi pod 0x%02X, probuje fallback 0x%02X...\n",
                I2C_ADDR_PRIMARY, I2C_ADDR_FALLBACK);
  if (imu.begin_I2C(I2C_ADDR_FALLBACK, &Wire)) {
    Serial.printf("[OK] LSM6DSOX znaleziony pod adresem 0x%02X\n", I2C_ADDR_FALLBACK);
    return true;
  }
  return false;
}

void setup() {
  Serial.begin(115200);
  delay(200);  // mala pauza, zeby host zdazyl otworzyc port

  Serial.println();
  Serial.println("=== 00_test_imu — diagnostyka LSM6DSOX ===");

  // Inicjalizacja I2C na pinach 8/9 (domyslne dla wielu plytek ESP32-S3 DevKit).
  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);  // szybkie I2C 400 kHz

  if (!initIMU()) {
    Serial.println("[BLAD] Nie znaleziono LSM6DSOX. Sprawdz SDA/SCL/3V3/GND i adres I2C.");
    while (true) {
      delay(1000);
    }
  }

  // Konfiguracja zakresow zgodna ze stalymi projektu (zob. README §8).
  imu.setAccelRange(LSM6DS_ACCEL_RANGE_8_G);
  imu.setGyroRange(LSM6DS_GYRO_RANGE_1000_DPS);

  // ODR = 104 Hz: najblizsze 100 Hz dla LSM6DSOX (zob. datasheet, CTRL1_XL/CTRL2_G).
  imu.setAccelDataRate(LSM6DS_RATE_104_HZ);
  imu.setGyroDataRate(LSM6DS_RATE_104_HZ);

  Serial.println("[OK] Konfiguracja: ±8 g, ±1000 dps, ODR 104 Hz.");
  Serial.println("Format: t_ms, AccX[g], AccY[g], AccZ[g], GyrX[dps], GyrY[dps], GyrZ[dps]");
}

void loop() {
  const uint32_t now = millis();
  if (now - lastSampleMs < SAMPLE_PERIOD_MS) {
    return;
  }
  lastSampleMs = now;

  // Adafruit zwraca przyspieszenie w m/s^2 i obrot w rad/s. Przeliczamy.
  sensors_event_t a, g, t;
  imu.getEvent(&a, &g, &t);

  const float accX_g  = a.acceleration.x / 9.80665f;
  const float accY_g  = a.acceleration.y / 9.80665f;
  const float accZ_g  = a.acceleration.z / 9.80665f;
  const float gyrX_dps = g.gyro.x * 57.2957795f;  // rad/s -> deg/s
  const float gyrY_dps = g.gyro.y * 57.2957795f;
  const float gyrZ_dps = g.gyro.z * 57.2957795f;

  Serial.printf("%lu, %+0.3f, %+0.3f, %+0.3f, %+0.2f, %+0.2f, %+0.2f\n",
                (unsigned long)now,
                accX_g, accY_g, accZ_g,
                gyrX_dps, gyrY_dps, gyrZ_dps);
}
