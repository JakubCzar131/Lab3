#include <Arduino.h>
#include <Wire.h>

// ====== Piny i I2C ======
constexpr uint8_t PIN_SDA = 8;
constexpr uint8_t PIN_SCL = 9;
constexpr uint32_t SERIAL_BAUD = 115200;
constexpr uint8_t ADDR_PRIMARY = 0x6A;
constexpr uint8_t ADDR_FALLBACK = 0x6B;

// ====== Rejestry LSM6DSOX (bank USER) ======
constexpr uint8_t REG_FUNC_CFG_ACCESS = 0x01;  // Przełączanie banków rejestrów
constexpr uint8_t REG_WHO_AM_I = 0x0F;         // ID układu, oczekiwane 0x6C
constexpr uint8_t REG_CTRL1_XL = 0x10;         // ODR i zakres akcelerometru
constexpr uint8_t REG_CTRL2_G = 0x11;          // ODR i zakres żyroskopu
constexpr uint8_t REG_CTRL3_C = 0x12;          // IF_INC / BDU
constexpr uint8_t REG_CTRL10_C = 0x19;         // Włączenie funkcji embedded
constexpr uint8_t REG_WAKE_UP_SRC = 0x1B;      // Źródła wake-up/motion
constexpr uint8_t REG_TAP_SRC = 0x1C;          // Źródła single/double tap
constexpr uint8_t REG_D6D_SRC = 0x1D;          // Źródła orientacji 6D
constexpr uint8_t REG_TAP_CFG0 = 0x56;         // Konfiguracja tap i routing
constexpr uint8_t REG_TAP_CFG1 = 0x57;         // Progi tap X
constexpr uint8_t REG_TAP_CFG2 = 0x58;         // Progi tap Y + double tap
constexpr uint8_t REG_TAP_THS_6D = 0x59;       // Prog Z tap + prog 6D
constexpr uint8_t REG_INT_DUR2 = 0x5A;         // Czas trwania tap
constexpr uint8_t REG_WAKE_UP_THS = 0x5B;      // Prog wykrycia ruchu
constexpr uint8_t REG_WAKE_UP_DUR = 0x5C;      // Czas dla wake-up
constexpr uint8_t REG_MD1_CFG = 0x5E;          // Routing interruptów na INT1

// ====== Rejestry LSM6DSOX (embedded function bank) ======
constexpr uint8_t REG_EMB_FUNC_EN_A = 0x04;    // Włączenie pedometru
constexpr uint8_t REG_STEP_COUNTER_L = 0x62;   // Licznik kroków (LSB)
constexpr uint8_t REG_STEP_COUNTER_H = 0x63;   // Licznik kroków (MSB)

uint8_t g_imuAddr = ADDR_PRIMARY;

bool writeReg(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(g_imuAddr);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

uint8_t readReg(uint8_t reg) {
  Wire.beginTransmission(g_imuAddr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) {
    return 0;
  }
  Wire.requestFrom(static_cast<int>(g_imuAddr), 1);
  if (Wire.available()) {
    return Wire.read();
  }
  return 0;
}

void setEmbeddedBank(bool enable) {
  // 0x80 = embedded function register bank, 0x00 = user bank.
  writeReg(REG_FUNC_CFG_ACCESS, enable ? 0x80 : 0x00);
}

bool detectImuAddress() {
  g_imuAddr = ADDR_PRIMARY;
  if (readReg(REG_WHO_AM_I) == 0x6C) {
    return true;
  }
  g_imuAddr = ADDR_FALLBACK;
  if (readReg(REG_WHO_AM_I) == 0x6C) {
    return true;
  }
  return false;
}

uint16_t readStepCounter() {
  setEmbeddedBank(true);
  uint8_t lo = readReg(REG_STEP_COUNTER_L);
  uint8_t hi = readReg(REG_STEP_COUNTER_H);
  setEmbeddedBank(false);
  return static_cast<uint16_t>((hi << 8) | lo);
}

void configureImuAndFeatures() {
  // IF_INC + BDU: autoinkrementacja adresu i blokada aktualizacji podczas odczytu.
  writeReg(REG_CTRL3_C, 0x44);

  // Acc: ODR=104Hz, FS=+/-8g.
  writeReg(REG_CTRL1_XL, 0x4C);
  // Gyro: ODR=104Hz, FS=+/-1000 dps.
  writeReg(REG_CTRL2_G, 0x48);

  // Włączenie embedded funkcji (m.in. pedometer).
  writeReg(REG_CTRL10_C, 0x3C);

  setEmbeddedBank(true);
  // Pedometer enable (bit PEDO_EN).
  writeReg(REG_EMB_FUNC_EN_A, 0x08);
  setEmbeddedBank(false);

  // Konfiguracja tap: osie XYZ + latching.
  writeReg(REG_TAP_CFG0, 0x8E);
  writeReg(REG_TAP_CFG1, 0x09);
  writeReg(REG_TAP_CFG2, 0x89);   // Włączenie double tap + próg Y.
  writeReg(REG_TAP_THS_6D, 0x40); // 6D threshold + próg tap Z.
  writeReg(REG_INT_DUR2, 0x7F);   // Czas i quiet/shock tap.

  // Konfiguracja wake-up/motion.
  writeReg(REG_WAKE_UP_THS, 0x02);
  writeReg(REG_WAKE_UP_DUR, 0x00);

  // Routing sygnałów na INT1 (opcjonalnie do dalszych testów).
  writeReg(REG_MD1_CFG, 0x48);
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(1000);
  Serial.println("\n=== 01_builtin_features: pedometer/tap/6D/wake-up ===");

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);

  if (!detectImuAddress()) {
    Serial.println("[BLAD] Nie wykryto LSM6DSOX (WHO_AM_I != 0x6C).");
    while (true) {
      delay(1000);
    }
  }

  Serial.print("[OK] IMU na adresie 0x");
  Serial.println(g_imuAddr, HEX);

  configureImuAndFeatures();
  Serial.println("[OK] Funkcje wbudowane skonfigurowane.");
  Serial.println("Format: STEPS | TAP_SRC | D6D_SRC | WAKE_UP_SRC");
}

void loop() {
  const uint16_t steps = readStepCounter();
  const uint8_t tapSrc = readReg(REG_TAP_SRC);
  const uint8_t d6dSrc = readReg(REG_D6D_SRC);
  const uint8_t wakeSrc = readReg(REG_WAKE_UP_SRC);

  const bool tapDetected = (tapSrc & 0x40) != 0;      // TAP_IA
  const bool singleTap = (tapSrc & 0x20) != 0;        // SINGLE_TAP
  const bool doubleTap = (tapSrc & 0x10) != 0;        // DOUBLE_TAP
  const bool d6dDetected = (d6dSrc & 0x40) != 0;      // D6D_IA
  const bool wakeDetected = (wakeSrc & 0x08) != 0;    // WU_IA

  Serial.print("STEPS=");
  Serial.print(steps);

  Serial.print(" | TAP_SRC=0x");
  Serial.print(tapSrc, HEX);
  Serial.print(" [");
  if (tapDetected) {
    if (singleTap) Serial.print("single ");
    if (doubleTap) Serial.print("double ");
  } else {
    Serial.print("none");
  }
  Serial.print("]");

  Serial.print(" | D6D_SRC=0x");
  Serial.print(d6dSrc, HEX);
  Serial.print(d6dDetected ? " [6D]" : " [none]");

  Serial.print(" | WAKE_UP_SRC=0x");
  Serial.print(wakeSrc, HEX);
  Serial.print(wakeDetected ? " [motion]" : " [none]");

  Serial.println();
  delay(200);
}
