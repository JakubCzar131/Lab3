/*
  01_builtin_features

  Demonstracja funkcji wbudowanych LSM6DSOX przez surowe rejestry I2C:
  - pedometer / licznik krokow,
  - single/double tap,
  - orientacja 6D,
  - wake-up / motion.

  Ten szkic celowo nie uzywa biblioteki Adafruit. Pokazuje, ktore rejestry
  czujnika odpowiadaja za funkcje embedded.
*/

#include <Wire.h>

constexpr uint8_t PIN_SDA = 8;
constexpr uint8_t PIN_SCL = 9;
constexpr uint8_t LSM6DSOX_ADDR_PRIMARY = 0x6A;
constexpr uint8_t LSM6DSOX_ADDR_FALLBACK = 0x6B;
constexpr uint8_t WHO_AM_I_EXPECTED = 0x6C;

// Rejestry glownej strony LSM6DSOX.
constexpr uint8_t REG_FUNC_CFG_ACCESS = 0x01;  // Przelaczanie banku embedded.
constexpr uint8_t REG_WHO_AM_I = 0x0F;         // Identyfikator ukladu, powinno byc 0x6C.
constexpr uint8_t REG_CTRL1_XL = 0x10;         // ODR i zakres akcelerometru.
constexpr uint8_t REG_CTRL2_G = 0x11;          // ODR i zakres zyroskopu.
constexpr uint8_t REG_CTRL3_C = 0x12;          // BDU, autoinkrementacja adresu.
constexpr uint8_t REG_WAKE_UP_SRC = 0x1B;      // Flagi wake-up / free-fall / sleep.
constexpr uint8_t REG_TAP_SRC = 0x1C;          // Flagi single tap i double tap.
constexpr uint8_t REG_D6D_SRC = 0x1D;          // Flagi orientacji 6D.
constexpr uint8_t REG_TAP_CFG0 = 0x56;         // Wlaczenie latch/interrupt embedded.
constexpr uint8_t REG_TAP_CFG1 = 0x57;         // Osie tap i filtr HP.
constexpr uint8_t REG_TAP_CFG2 = 0x58;         // Prog tap i enable interruptow.
constexpr uint8_t REG_TAP_THS_6D = 0x59;       // Prog tap Z i prog orientacji 6D.
constexpr uint8_t REG_INT_DUR2 = 0x5A;         // Czasy tap: shock/quiet/duration.
constexpr uint8_t REG_WAKE_UP_THS = 0x5B;      // Prog ruchu wake-up.
constexpr uint8_t REG_WAKE_UP_DUR = 0x5C;      // Czas trwania wake-up.
constexpr uint8_t REG_MD1_CFG = 0x5E;          // Routing zdarzen na INT1.

// Rejestry banku embedded functions. Adresy sa z dokumentacji LSM6DSOX.
constexpr uint8_t REG_EMB_FUNC_EN_A = 0x04;    // Bity wlaczajace m.in. pedometer.
constexpr uint8_t REG_EMB_FUNC_EN_B = 0x05;    // Dodatkowe funkcje embedded.
constexpr uint8_t REG_STEP_COUNTER_L = 0x62;   // Mlodszy bajt licznika krokow.
constexpr uint8_t REG_STEP_COUNTER_H = 0x63;   // Starszy bajt licznika krokow.

uint8_t imuAddr = LSM6DSOX_ADDR_PRIMARY;

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

uint16_t readReg16(uint8_t regLow) {
  const uint8_t low = readReg(regLow);
  const uint8_t high = readReg(regLow + 1);
  return static_cast<uint16_t>(low) | (static_cast<uint16_t>(high) << 8);
}

void useEmbeddedBank(bool enable) {
  // 0x80 ustawia dostep do rejestrow funkcji embedded; 0x00 wraca na main page.
  writeReg(REG_FUNC_CFG_ACCESS, enable ? 0x80 : 0x00);
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

void configureImu() {
  // BDU=1 blokuje aktualizacje polowy slowa podczas odczytu, IF_INC=1 wlacza autoinkrementacje.
  writeReg(REG_CTRL3_C, 0x44);

  // ODR 104 Hz (0x40) + zakres akcelerometru +/-8 g (0x0C).
  writeReg(REG_CTRL1_XL, 0x4C);

  // ODR 104 Hz (0x40) + zakres zyroskopu +/-1000 dps (0x08).
  writeReg(REG_CTRL2_G, 0x48);

  // Konfiguracja tap: aktywne osie X/Y/Z, progi i czasy dobrane demonstracyjnie.
  writeReg(REG_TAP_CFG0, 0x0E);
  writeReg(REG_TAP_CFG1, 0x7F);
  writeReg(REG_TAP_CFG2, 0x8C);
  writeReg(REG_TAP_THS_6D, 0x44);
  writeReg(REG_INT_DUR2, 0x7F);

  // Wake-up: niski prog ruchu, krotki czas trwania.
  writeReg(REG_WAKE_UP_THS, 0x02);
  writeReg(REG_WAKE_UP_DUR, 0x00);

  // Routing na INT1: wake-up, tap i 6D. Nawet bez pinu INT1 zrodla odczytujemy z rejestrow SRC.
  writeReg(REG_MD1_CFG, 0xE8);

  useEmbeddedBank(true);
  // Wlacz pedometer. W typowych rewizjach LSM6DSOX bit PEDO_EN jest w EMB_FUNC_EN_A.
  writeReg(REG_EMB_FUNC_EN_A, 0x08);
  writeReg(REG_EMB_FUNC_EN_B, 0x10);
  useEmbeddedBank(false);
}

uint16_t readStepCounter() {
  useEmbeddedBank(true);
  const uint16_t steps = readReg16(REG_STEP_COUNTER_L);
  useEmbeddedBank(false);
  return steps;
}

void setup() {
  Serial.begin(115200);
  delay(1500);

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);

  Serial.println();
  Serial.println("01_builtin_features: pedometer, tap, 6D, wake-up");

  if (!detectImu()) {
    Serial.println("BLAD: WHO_AM_I != 0x6C pod adresami 0x6A/0x6B.");
    while (true) {
      delay(1000);
    }
  }

  Serial.print("Znaleziono LSM6DSOX pod adresem 0x");
  Serial.println(imuAddr, HEX);
  configureImu();
}

void loop() {
  const uint16_t steps = readStepCounter();
  const uint8_t tap = readReg(REG_TAP_SRC);
  const uint8_t d6d = readReg(REG_D6D_SRC);
  const uint8_t wake = readReg(REG_WAKE_UP_SRC);

  const bool singleTap = tap & 0x20;
  const bool doubleTap = tap & 0x10;
  const bool wakeUp = wake & 0x08;

  Serial.print("steps=");
  Serial.print(steps);
  Serial.print(" | tap=");
  if (singleTap) {
    Serial.print("single ");
  }
  if (doubleTap) {
    Serial.print("double ");
  }
  if (!singleTap && !doubleTap) {
    Serial.print("-");
  }

  Serial.print(" | 6D=");
  Serial.print((d6d & 0x20) ? "XL " : "");
  Serial.print((d6d & 0x10) ? "XH " : "");
  Serial.print((d6d & 0x08) ? "YL " : "");
  Serial.print((d6d & 0x04) ? "YH " : "");
  Serial.print((d6d & 0x02) ? "ZL " : "");
  Serial.print((d6d & 0x01) ? "ZH " : "");

  Serial.print(" | wake=");
  Serial.print(wakeUp ? "motion" : "-");
  Serial.print(" | raw TAP_SRC=0x");
  Serial.print(tap, HEX);
  Serial.print(" D6D_SRC=0x");
  Serial.print(d6d, HEX);
  Serial.print(" WAKE_UP_SRC=0x");
  Serial.println(wake, HEX);

  delay(200);
}

