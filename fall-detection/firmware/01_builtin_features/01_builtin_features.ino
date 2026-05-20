/*
 * 01_builtin_features — wbudowane funkcje LSM6DSOX z poziomu surowych rejestrow.
 *
 * Cel: pokazac, ze sam czujnik (BEZ TFLM, BEZ sieci neuronowej) potrafi:
 *   - liczyc kroki (pedometer / STEP_COUNTER_L/H w bank embedded),
 *   - wykrywac pojedyncze i podwojne tapniecie (TAP_SRC),
 *   - rozpoznawac orientacje 6D (D6D_SRC, "ktora sciana do gory"),
 *   - wykrywac wybudzenie / aktywnosc (WAKE_UP_SRC).
 *
 * Te funkcje sa "za darmo" w hardware — kosztuja kilka uA, dzialaja non-stop.
 * W systemie hybrydowym (04) mozemy uzyc np. wake-up zamiast TFLM jako
 * pierwszy filtr aktywnosci.
 *
 * Caly szkic korzysta z Wire.h i SUROWYCH ADRESOW REJESTROW (zob. datasheet
 * LSM6DSOX, sekcje "Application note AN5272"). Adresy podaje w komentarzach,
 * zeby latwo bylo bronic kazdej linijki.
 */

#include <Wire.h>

// --- Pin/I2C ---
static constexpr int PIN_SDA = 8;
static constexpr int PIN_SCL = 9;
static constexpr uint8_t I2C_ADDR_PRIMARY  = 0x6A;
static constexpr uint8_t I2C_ADDR_FALLBACK = 0x6B;
static uint8_t imuAddr = I2C_ADDR_PRIMARY;

// --- Rejestry user bank (datasheet rozdz. 9) ---
static constexpr uint8_t REG_FUNC_CFG_ACCESS = 0x01;  // przelacznik bankow
static constexpr uint8_t REG_WHO_AM_I        = 0x0F;  // powinno zwrocic 0x6C
static constexpr uint8_t REG_CTRL1_XL        = 0x10;  // ODR + zakres accel
static constexpr uint8_t REG_CTRL2_G         = 0x11;  // ODR + zakres gyro
static constexpr uint8_t REG_CTRL3_C         = 0x12;  // IF_INC=1, BDU=1
static constexpr uint8_t REG_CTRL10_C        = 0x19;  // FUNC_EN = embedded functions
static constexpr uint8_t REG_TAP_CFG0        = 0x56;  // tap / wake-up cfg
static constexpr uint8_t REG_TAP_CFG1        = 0x57;  // tap thresholds X
static constexpr uint8_t REG_TAP_CFG2        = 0x58;  // tap thresholds Y + INT_EN
static constexpr uint8_t REG_TAP_THS_6D      = 0x59;  // 6D threshold
static constexpr uint8_t REG_INT_DUR2        = 0x5A;  // dur + quiet + shock
static constexpr uint8_t REG_WAKE_UP_THS     = 0x5B;  // WAKE_UP threshold
static constexpr uint8_t REG_WAKE_UP_DUR     = 0x5C;  // WAKE_UP duration
static constexpr uint8_t REG_MD1_CFG         = 0x5E;  // routing zdarzen na INT1
static constexpr uint8_t REG_TAP_SRC         = 0x1C;  // status TAP
static constexpr uint8_t REG_D6D_SRC         = 0x1D;  // status orient. 6D
static constexpr uint8_t REG_WAKE_UP_SRC     = 0x1B;  // status WAKE_UP
static constexpr uint8_t REG_STEP_COUNTER_L  = 0x4B;  // pedometer LSB (po RESET)
static constexpr uint8_t REG_STEP_COUNTER_H  = 0x4C;  // pedometer MSB

// --- Rejestry embedded function bank (po FUNC_CFG_ACCESS = 0x80) ---
static constexpr uint8_t EMB_EMB_FUNC_EN_A   = 0x04;  // bity wlaczajace SFLP, PEDO,...
static constexpr uint8_t EMB_PAGE_SEL        = 0x02;
static constexpr uint8_t EMB_FUNC_INT1       = 0x0A;
static constexpr uint8_t EMB_FUNC_SRC        = 0x14;

// ----------- Pomocnicze: I2C R/W ------------------------------------------
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

static void i2cReadN(uint8_t reg, uint8_t *buf, size_t n) {
  Wire.beginTransmission(imuAddr);
  Wire.write(reg);
  Wire.endTransmission(false);
  Wire.requestFrom((int)imuAddr, (int)n);
  for (size_t i = 0; i < n && Wire.available(); ++i) {
    buf[i] = Wire.read();
  }
}

// Przelacznik dostepu do banku embedded: FUNC_CFG_ACCESS.FUNC_CFG_ACCESS = 1.
static void embeddedBankEnable(bool on) {
  i2cWrite8(REG_FUNC_CFG_ACCESS, on ? 0x80 : 0x00);
}

// Probuje znalezc czujnik na 0x6A, potem 0x6B.
static bool findIMU() {
  for (uint8_t addr : {I2C_ADDR_PRIMARY, I2C_ADDR_FALLBACK}) {
    imuAddr = addr;
    Wire.beginTransmission(imuAddr);
    Wire.write(REG_WHO_AM_I);
    if (Wire.endTransmission(false) != 0) continue;
    Wire.requestFrom((int)imuAddr, 1);
    if (!Wire.available()) continue;
    const uint8_t who = Wire.read();
    if (who == 0x6C) {
      Serial.printf("[OK] WHO_AM_I=0x%02X pod adresem 0x%02X\n", who, imuAddr);
      return true;
    }
  }
  return false;
}

// ----------- Konfiguracja czujnika ----------------------------------------
static void configureSensor() {
  // CTRL3_C: BDU=1 (block data update), IF_INC=1 (auto-increment).
  i2cWrite8(REG_CTRL3_C, 0x44);

  // CTRL1_XL: ODR=104Hz (0x4 << 4), FS_XL=±8g (0x3 << 2) -> 0x48.
  i2cWrite8(REG_CTRL1_XL, 0x48);
  // CTRL2_G: ODR=104Hz (0x4 << 4), FS_G=±1000dps (0x2 << 2) -> 0x48.
  i2cWrite8(REG_CTRL2_G, 0x48);

  // ---- TAP CFG (single + double tap na osiach X/Y/Z) ----
  // TAP_CFG0 (0x56): TAP_X_EN=TAP_Y_EN=TAP_Z_EN=1, LIR=1 (latched IRQ).
  i2cWrite8(REG_TAP_CFG0, 0x0F);
  // TAP_CFG1 (0x57): TAP_THS_X = 0x09 (~0.5g przy ±8g).
  i2cWrite8(REG_TAP_CFG1, 0x09);
  // TAP_CFG2 (0x58): INTERRUPTS_ENABLE=1, TAP_THS_Y=0x09.
  i2cWrite8(REG_TAP_CFG2, 0x89);
  // TAP_THS_6D (0x59): 6D_THS = 60deg (0x40), TAP_THS_Z = 0x09.
  i2cWrite8(REG_TAP_THS_6D, 0x49);
  // INT_DUR2 (0x5A): DUR=4, QUIET=2, SHOCK=2 -> 0x42.
  i2cWrite8(REG_INT_DUR2, 0x42);
  // WAKE_UP_THS (0x5B): SINGLE_DOUBLE_TAP=1 + ths=0x02.
  i2cWrite8(REG_WAKE_UP_THS, 0x82);
  // WAKE_UP_DUR (0x5C): WAKE_DUR=0, SLEEP_DUR=0 (mozemy doregulowac).
  i2cWrite8(REG_WAKE_UP_DUR, 0x00);

  // ---- Wlaczenie embedded functions: pedometer ----
  embeddedBankEnable(true);
  // EMB_FUNC_EN_A (0x04): bit PEDO_EN=1, TILT=1 (zob. datasheet).
  i2cWrite8(EMB_EMB_FUNC_EN_A, 0x18);
  embeddedBankEnable(false);

  // CTRL10_C (0x19): EMBEDDED_FUNCTIONS_EN = 1.
  i2cWrite8(REG_CTRL10_C, 0x04);

  Serial.println("[OK] Konfiguracja LSM6DSOX: TAP + 6D + WAKE_UP + PEDOMETER.");
}

// ----------- Setup / Loop -------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(200);

  Serial.println();
  Serial.println("=== 01_builtin_features — wbudowane funkcje LSM6DSOX ===");

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);

  if (!findIMU()) {
    Serial.println("[BLAD] Nie znaleziono LSM6DSOX. Sprawdz okablowanie.");
    while (true) delay(1000);
  }
  configureSensor();

  Serial.println("Wiersz: t_ms | kroki | TAP(s,d,sign,X,Y,Z) | 6D(ZH,ZL,YH,YL,XH,XL) | WAKE(X,Y,Z,FREE_FALL,SLEEP)");
}

void loop() {
  // Loguj co 200 ms.
  static uint32_t lastMs = 0;
  const uint32_t now = millis();
  if (now - lastMs < 200) return;
  lastMs = now;

  // --- Pedometer: STEP_COUNTER_L/H (rejestr user bank po wlaczeniu PEDO) ---
  uint8_t stepLH[2] = {0};
  i2cReadN(REG_STEP_COUNTER_L, stepLH, 2);
  const uint16_t steps = (uint16_t)stepLH[0] | ((uint16_t)stepLH[1] << 8);

  // --- TAP_SRC (0x1C): TAP_IA, SINGLE, DOUBLE, sign, X, Y, Z ---
  const uint8_t tapSrc = i2cRead8(REG_TAP_SRC);
  const bool tap_single = tapSrc & 0x20;
  const bool tap_double = tapSrc & 0x10;
  const bool tap_sign   = tapSrc & 0x08;
  const bool tap_x      = tapSrc & 0x04;
  const bool tap_y      = tapSrc & 0x02;
  const bool tap_z      = tapSrc & 0x01;

  // --- D6D_SRC (0x1D): D6D_IA + ZH/ZL/YH/YL/XH/XL ---
  const uint8_t d6dSrc = i2cRead8(REG_D6D_SRC);
  const bool d_zh = d6dSrc & 0x20;
  const bool d_zl = d6dSrc & 0x10;
  const bool d_yh = d6dSrc & 0x08;
  const bool d_yl = d6dSrc & 0x04;
  const bool d_xh = d6dSrc & 0x02;
  const bool d_xl = d6dSrc & 0x01;

  // --- WAKE_UP_SRC (0x1B): X/Y/Z wakeup, FF_IA (free fall), SLEEP_STATE ---
  const uint8_t wuSrc = i2cRead8(REG_WAKE_UP_SRC);
  const bool wu_x       = wuSrc & 0x04;
  const bool wu_y       = wuSrc & 0x02;
  const bool wu_z       = wuSrc & 0x01;
  const bool wu_freefall = wuSrc & 0x20;
  const bool wu_sleep    = wuSrc & 0x10;

  Serial.printf("%6lu | kroki=%u | TAP(s=%d d=%d sign=%d X=%d Y=%d Z=%d) | "
                "6D(ZH=%d ZL=%d YH=%d YL=%d XH=%d XL=%d) | "
                "WAKE(X=%d Y=%d Z=%d FF=%d SLEEP=%d)\n",
                (unsigned long)now, steps,
                tap_single, tap_double, tap_sign, tap_x, tap_y, tap_z,
                d_zh, d_zl, d_yh, d_yl, d_xh, d_xl,
                wu_x, wu_y, wu_z, wu_freefall, wu_sleep);
}
