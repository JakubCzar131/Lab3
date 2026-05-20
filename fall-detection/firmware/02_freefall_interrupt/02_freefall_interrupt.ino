/*
  02_freefall_interrupt

  Autonomiczna detekcja free-fall w LSM6DSOX.
  Czujnik sam monitoruje przyspieszenie i wystawia przerwanie na INT1.
  ESP32-S3 odbiera INT1 na GPIO 4 i wypisuje komunikat.
*/

#include <Wire.h>

constexpr uint8_t PIN_SDA = 8;
constexpr uint8_t PIN_SCL = 9;
constexpr uint8_t PIN_INT1 = 4;
constexpr uint8_t LSM6DSOX_ADDR_PRIMARY = 0x6A;
constexpr uint8_t LSM6DSOX_ADDR_FALLBACK = 0x6B;
constexpr uint8_t WHO_AM_I_EXPECTED = 0x6C;

constexpr uint8_t REG_WHO_AM_I = 0x0F;
constexpr uint8_t REG_CTRL1_XL = 0x10;
constexpr uint8_t REG_CTRL2_G = 0x11;
constexpr uint8_t REG_CTRL3_C = 0x12;
constexpr uint8_t REG_WAKE_UP_SRC = 0x1B;
constexpr uint8_t REG_TAP_CFG0 = 0x56;
constexpr uint8_t REG_FREE_FALL = 0x5D;
constexpr uint8_t REG_MD1_CFG = 0x5E;

uint8_t imuAddr = LSM6DSOX_ADDR_PRIMARY;
volatile bool freeFallIrq = false;

bool writeReg(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(imuAddr);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

uint8_t readReg(uint8_t reg) {
  Wire.beginTransmission(imuAddr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) {
    return 0;
  }
  Wire.requestFrom(imuAddr, static_cast<uint8_t>(1));
  return Wire.available() ? Wire.read() : 0;
}

bool detectImu() {
  for (uint8_t addr : {LSM6DSOX_ADDR_PRIMARY, LSM6DSOX_ADDR_FALLBACK}) {
    imuAddr = addr;
    if (readReg(REG_WHO_AM_I) == WHO_AM_I_EXPECTED) {
      return true;
    }
  }
  return false;
}

void IRAM_ATTR onFreeFallInt() {
  freeFallIrq = true;
}

void configureFreeFall() {
  // BDU=1, IF_INC=1.
  writeReg(REG_CTRL3_C, 0x44);

  // ODR 104 Hz + +/-8 g. Detektor free-fall dziala w domenie akcelerometru.
  writeReg(REG_CTRL1_XL, 0x4C);

  // Zyroskop nie jest potrzebny do free-fall, ale wlaczamy zakres projektu.
  writeReg(REG_CTRL2_G, 0x48);

  // LIR=1 zatrzaskuje przerwanie do czasu odczytu zrodla.
  writeReg(REG_TAP_CFG0, 0x01);

  // FREE_FALL:
  // FF_DUR=0x06 (kilka probek) oraz FF_THS=0x03 (prog ok. 312 mg).
  // To ustawienie demonstracyjne; w pracy nalezy dobrac je eksperymentalnie.
  writeReg(REG_FREE_FALL, 0x33);

  // MD1_CFG bit INT1_FF kieruje free-fall na pin INT1.
  writeReg(REG_MD1_CFG, 0x10);

  // Odczyt czysci ewentualne stare flagi.
  (void)readReg(REG_WAKE_UP_SRC);
}

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println();
  Serial.println("02_freefall_interrupt: INT1 -> GPIO4");

  pinMode(PIN_INT1, INPUT);
  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);

  if (!detectImu()) {
    Serial.println("BLAD: nie znaleziono LSM6DSOX (WHO_AM_I 0x6C).");
    while (true) {
      delay(1000);
    }
  }

  Serial.print("LSM6DSOX adres 0x");
  Serial.println(imuAddr, HEX);
  configureFreeFall();
  attachInterrupt(digitalPinToInterrupt(PIN_INT1), onFreeFallInt, RISING);

  Serial.println("Gotowe. Porusz czujnikiem ostroznie i zasymuluj krotki free-fall.");
}

void loop() {
  if (freeFallIrq) {
    freeFallIrq = false;
    const uint8_t src = readReg(REG_WAKE_UP_SRC);
    Serial.print(">>> FREE FALL <<< WAKE_UP_SRC=0x");
    Serial.println(src, HEX);
  }

  delay(5);
}

