#include <Arduino.h>
#include <Wire.h>

// ====== Konfiguracja sprzętowa ======
constexpr uint8_t PIN_SDA = 8;
constexpr uint8_t PIN_SCL = 9;
constexpr uint8_t PIN_INT1 = 4;
constexpr uint32_t SERIAL_BAUD = 115200;

constexpr uint8_t ADDR_PRIMARY = 0x6A;
constexpr uint8_t ADDR_FALLBACK = 0x6B;

// ====== Rejestry LSM6DSOX ======
constexpr uint8_t REG_WHO_AM_I = 0x0F;       // Oczekiwane 0x6C
constexpr uint8_t REG_CTRL1_XL = 0x10;       // Konfiguracja akcelerometru
constexpr uint8_t REG_CTRL3_C = 0x12;        // BDU/IF_INC
constexpr uint8_t REG_TAP_CFG0 = 0x56;       // Latching / routing config
constexpr uint8_t REG_FREE_FALL = 0x5D;      // Prog + czas free-fall
constexpr uint8_t REG_MD1_CFG = 0x5E;        // Routing zdarzeń na INT1
constexpr uint8_t REG_WAKE_UP_SRC = 0x1B;    // Flagi źródła zdarzenia

volatile bool g_freeFallInterrupt = false;
uint8_t g_imuAddr = ADDR_PRIMARY;

void IRAM_ATTR onInt1() {
  g_freeFallInterrupt = true;
}

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

bool detectImuAddress() {
  g_imuAddr = ADDR_PRIMARY;
  if (readReg(REG_WHO_AM_I) == 0x6C) return true;
  g_imuAddr = ADDR_FALLBACK;
  if (readReg(REG_WHO_AM_I) == 0x6C) return true;
  return false;
}

void configureFreeFallInterrupt() {
  // IF_INC + BDU.
  writeReg(REG_CTRL3_C, 0x44);
  // Acc only: ODR=104Hz, FS=+/-8g.
  writeReg(REG_CTRL1_XL, 0x4C);

  // TAP_CFG0:
  // - LIR (latched interrupt) ułatwia stabilny odczyt flag.
  writeReg(REG_TAP_CFG0, 0x01);

  // FREE_FALL:
  // FF_DUR = 6 próbek (bity [7:3]), FF_THS = kod 3 (bity [2:0]).
  // To punkt startowy do strojenia czułości pod konkretną aplikację.
  const uint8_t freeFallCfg = static_cast<uint8_t>((6 << 3) | 0x03);
  writeReg(REG_FREE_FALL, freeFallCfg);

  // MD1_CFG: routing sygnału free-fall na pin INT1.
  // Bit INT1_FF = 1.
  writeReg(REG_MD1_CFG, 0x10);
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(1000);
  Serial.println("\n=== 02_freefall_interrupt ===");

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);

  if (!detectImuAddress()) {
    Serial.println("[BLAD] Nie wykryto LSM6DSOX.");
    while (true) delay(1000);
  }

  Serial.print("[OK] IMU na adresie 0x");
  Serial.println(g_imuAddr, HEX);

  configureFreeFallInterrupt();

  pinMode(PIN_INT1, INPUT);
  attachInterrupt(digitalPinToInterrupt(PIN_INT1), onInt1, RISING);
  Serial.println("[OK] Free-fall routed na INT1 (GPIO4).");
  Serial.println("Porusz sensorem: oczekuj logu >>> FREE FALL <<<");
}

void loop() {
  if (g_freeFallInterrupt) {
    g_freeFallInterrupt = false;
    const uint8_t wakeSrc = readReg(REG_WAKE_UP_SRC);
    Serial.print(">>> FREE FALL <<< WAKE_UP_SRC=0x");
    Serial.println(wakeSrc, HEX);
  }

  delay(10);
}
