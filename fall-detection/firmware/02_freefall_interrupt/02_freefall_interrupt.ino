/*
 * 02_freefall_interrupt — sprzetowa detekcja swobodnego spadania w LSM6DSOX.
 *
 * Cel: pokazac, ze sam czujnik (bez TFLM) potrafi rozpoznac swobodny spadek
 * i obudzic MCU przez przerwanie INT1 (GPIO 4). W systemie hybrydowym (04)
 * to wlasnie ten mechanizm wybudza CPU z deep sleep.
 *
 * Wbudowana detekcja free-fall korzysta z rejestrow:
 *   FREE_FALL (0x5D) -> prog i czas trwania (FF_THS + FF_DUR)
 *   TAP_CFG0  (0x56) -> LIR=1 (latched), INT_EN=1
 *   MD1_CFG   (0x5E) -> routing zdarzen na INT1 (bit INT1_FF)
 *
 * Po wystapieniu zdarzenia bit FF_IA (WAKE_UP_SRC.5) jest ustawiany i pin INT1
 * przechodzi w stan wysoki. Czyscimy go odczytujac WAKE_UP_SRC.
 *
 * Polaczenia:
 *   LSM6DSOX INT1 -> ESP32-S3 GPIO 4
 */

#include <Wire.h>

static constexpr int PIN_SDA = 8;
static constexpr int PIN_SCL = 9;
static constexpr int PIN_INT1 = 4;

static constexpr uint8_t I2C_ADDR_PRIMARY  = 0x6A;
static constexpr uint8_t I2C_ADDR_FALLBACK = 0x6B;
static uint8_t imuAddr = I2C_ADDR_PRIMARY;

// Rejestry
static constexpr uint8_t REG_WHO_AM_I    = 0x0F;
static constexpr uint8_t REG_CTRL1_XL    = 0x10;
static constexpr uint8_t REG_CTRL3_C     = 0x12;
static constexpr uint8_t REG_TAP_CFG0    = 0x56;
static constexpr uint8_t REG_TAP_CFG2    = 0x58;
static constexpr uint8_t REG_WAKE_UP_DUR = 0x5C;
static constexpr uint8_t REG_FREE_FALL   = 0x5D;
static constexpr uint8_t REG_MD1_CFG     = 0x5E;
static constexpr uint8_t REG_WAKE_UP_SRC = 0x1B;

// Flaga ustawiana z ISR.
static volatile bool g_freeFallFlag = false;
// Licznik dla diagnostyki.
static volatile uint32_t g_freeFallCount = 0;

static void i2cWrite8(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(imuAddr);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}
static uint8_t i2cRead8(uint8_t reg) {
  Wire.beginTransmission(imuAddr);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom((int)imuAddr, 1);
  return Wire.available() ? Wire.read() : 0;
}

static bool findIMU() {
  for (uint8_t addr : {I2C_ADDR_PRIMARY, I2C_ADDR_FALLBACK}) {
    imuAddr = addr;
    if (i2cRead8(REG_WHO_AM_I) == 0x6C) {
      Serial.printf("[OK] LSM6DSOX pod 0x%02X\n", imuAddr);
      return true;
    }
  }
  return false;
}

// ISR — musi byc krotka. Tylko ustawiamy flage.
static void IRAM_ATTR onFreeFallIsr() {
  g_freeFallFlag = true;
  g_freeFallCount++;
}

static void configureFreeFall() {
  // CTRL3_C: BDU + IF_INC.
  i2cWrite8(REG_CTRL3_C, 0x44);

  // CTRL1_XL: ODR=416 Hz, ±8g (dla free-fall lepsza wyzsza ODR).
  i2cWrite8(REG_CTRL1_XL, 0x6C);  // 0x6 (416Hz) << 4 | 0x3 (±8g) << 2

  // TAP_CFG0 (0x56): LIR=1 (bit 0), INTERRUPTS_ENABLED=1 (bit 7 w TAP_CFG2),
  // INT_CLR_ON_READ=1 (bit 6) - reset bit po odczycie zrodla.
  i2cWrite8(REG_TAP_CFG0, 0x41);

  // TAP_CFG2 (0x58): INTERRUPTS_ENABLE=1, reszta 0.
  i2cWrite8(REG_TAP_CFG2, 0x80);

  // WAKE_UP_DUR (0x5C): FF_DUR (bit 7) = 0, reszta 0.
  i2cWrite8(REG_WAKE_UP_DUR, 0x00);

  // FREE_FALL (0x5D):
  //   bity 7..3 = FF_DUR[4:0]  (czas trwania spadku w probkach ODR)
  //   bity 2..0 = FF_THS[2:0]  (prog: 0=156 mg, 1=219, 2=250, 3=312, 4=375, 5=438, 6=500)
  // FF_DUR = 6 (ok. 15 ms @ 416 Hz) i FF_THS = 3 (312 mg) — zalecane przez AN5272.
  i2cWrite8(REG_FREE_FALL, (6 << 3) | 0x03);

  // MD1_CFG (0x5E): INT1_FF (bit 4) = 1 -> routuj free-fall na INT1.
  i2cWrite8(REG_MD1_CFG, 0x10);

  Serial.println("[OK] Konfiguracja free-fall: FF_DUR=6 (~15ms), FF_THS=312mg, routing -> INT1.");
}

void setup() {
  Serial.begin(115200);
  delay(200);

  Serial.println();
  Serial.println("=== 02_freefall_interrupt — sprzetowa detekcja free-fall ===");

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);

  if (!findIMU()) {
    Serial.println("[BLAD] Nie znaleziono LSM6DSOX.");
    while (true) delay(1000);
  }
  configureFreeFall();

  // Konfiguracja pinu przerwania.
  pinMode(PIN_INT1, INPUT_PULLDOWN);
  // INT1 LSM6DSOX domyslnie aktywny stanem wysokim, latched (LIR=1).
  attachInterrupt(digitalPinToInterrupt(PIN_INT1), onFreeFallIsr, RISING);

  // Wyczysc historyczne flagi przez odczyt WAKE_UP_SRC.
  (void)i2cRead8(REG_WAKE_UP_SRC);

  Serial.println("Czekam na free-fall... (upusc czujnik bezpiecznie z malej wysokosci).");
}

void loop() {
  if (g_freeFallFlag) {
    g_freeFallFlag = false;

    // Odczytanie WAKE_UP_SRC zeruje LATCHED INT.
    const uint8_t src = i2cRead8(REG_WAKE_UP_SRC);
    const bool ff_ia = src & 0x20;

    if (ff_ia) {
      Serial.printf(">>> FREE FALL <<<  t=%lums  count=%lu  WAKE_UP_SRC=0x%02X\n",
                    (unsigned long)millis(),
                    (unsigned long)g_freeFallCount, src);
    } else {
      // Zdarzenie INT1, ale FF_IA = 0 — np. inny event przy testach.
      Serial.printf("[INFO] INT1 high, ale FF_IA=0 (SRC=0x%02X)\n", src);
    }
  }
  delay(5);  // niskie obciazenie CPU
}
