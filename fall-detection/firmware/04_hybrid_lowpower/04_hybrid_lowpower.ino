/*
 * 04_hybrid_lowpower — hybryda free-fall + TFLM + deep sleep.
 *
 * Idea (od 02 + 03):
 *   1. ESP32-S3 w deep sleep. Zegar CPU off, RTC peripherals on -> ~10 uA.
 *   2. LSM6DSOX dziala autonomicznie i monitoruje free-fall (~3 uA @ low-power).
 *   3. Gdy nastapi free-fall, INT1 -> GPIO 4 = HIGH -> ESP32 budzi sie (ext0_wakeup).
 *   4. Po obudzeniu zbieramy okno 2 s (200 probek @ 100 Hz), karmimy modelem CNN,
 *      klasyfikujemy. Jezeli wynik = FALL -> alert (Serial + LED na GPIO 5).
 *      Tutaj jest miejsce na: WiFi/MQTT/SMS/buzzer.
 *   5. Wracamy do deep sleep.
 *
 * Plik wymaga model.h i normalization.h (skopiuj z firmware/03_fall_detector/).
 *
 * Ostrzezenie: w trakcie deep sleep Serial sie rozlacza. Po obudzeniu Serial
 * musi byc na nowo otwarty przez Serial.begin(); host PC tez musi otworzyc port.
 */

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_LSM6DSOX.h>
#include <esp_sleep.h>
#include <driver/rtc_io.h>

// #include <TensorFlowLite_ESP32.h>   // alternatywa
#include <Chirale_TensorFlowLite.h>
#include "tensorflow/lite/micro/all_ops_resolver.h"
#include "tensorflow/lite/micro/micro_interpreter.h"
#include "tensorflow/lite/micro/system_setup.h"
#include "tensorflow/lite/schema/schema_generated.h"

#include "model.h"
#include "normalization.h"

// ===========================================================================
// Stale projektu
// ===========================================================================
static constexpr int WINDOW_SIZE = NORM_WINDOW_SIZE;
static constexpr int N_CHANNELS  = NORM_N_CHANNELS;
static constexpr int N_CLASSES   = 3;
static const char* CLASS_NAMES[N_CLASSES] = { "ADL", "PRE-FALL", "FALL" };

// 2 s @ 100 Hz = 200 probek. Z tych probek robimy multiokienkowa klasyfikacje:
// 200 - 51 = 149 okien jesli STRIDE=1, my robimy STRIDE=25 -> 7 okien.
static constexpr int LONG_WINDOW = 200;
static constexpr int STRIDE      = 25;
static constexpr uint32_t SAMPLE_PERIOD_US = 10000;  // 100 Hz

// Piny
static constexpr int PIN_SDA  = 8;
static constexpr int PIN_SCL  = 9;
static constexpr int PIN_INT1 = 4;
static constexpr gpio_num_t PIN_INT1_RTC = GPIO_NUM_4;
static constexpr int PIN_LED  = 5;

static constexpr uint8_t I2C_ADDR_PRIMARY  = 0x6A;
static constexpr uint8_t I2C_ADDR_FALLBACK = 0x6B;
static uint8_t imuAddr = I2C_ADDR_PRIMARY;

Adafruit_LSM6DSOX imu;

// ===========================================================================
// TFLM
// ===========================================================================
static constexpr int kTensorArenaSize = 80 * 1024;
alignas(16) static uint8_t tensor_arena[kTensorArenaSize];

static const tflite::Model* tflModel = nullptr;
static tflite::MicroInterpreter* interpreter = nullptr;
static TfLiteTensor* tflInput = nullptr;
static TfLiteTensor* tflOutput = nullptr;
static float in_scale = 1.0f, out_scale = 1.0f;
static int   in_zero_point = 0, out_zero_point = 0;

// ===========================================================================
// Surowe I2C (do konfiguracji free-fall przed deep sleep).
// ===========================================================================
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

// Rejestry potrzebne do free-fall (zob. 02_freefall_interrupt).
static constexpr uint8_t REG_WHO_AM_I    = 0x0F;
static constexpr uint8_t REG_CTRL1_XL    = 0x10;
static constexpr uint8_t REG_CTRL2_G     = 0x11;
static constexpr uint8_t REG_CTRL3_C     = 0x12;
static constexpr uint8_t REG_TAP_CFG0    = 0x56;
static constexpr uint8_t REG_TAP_CFG2    = 0x58;
static constexpr uint8_t REG_WAKE_UP_DUR = 0x5C;
static constexpr uint8_t REG_FREE_FALL   = 0x5D;
static constexpr uint8_t REG_MD1_CFG     = 0x5E;
static constexpr uint8_t REG_WAKE_UP_SRC = 0x1B;

static bool findIMU() {
  for (uint8_t addr : {I2C_ADDR_PRIMARY, I2C_ADDR_FALLBACK}) {
    imuAddr = addr;
    if (i2cRead8(REG_WHO_AM_I) == 0x6C) return true;
  }
  return false;
}

// Konfiguracja free-fall identyczna jak w 02_freefall_interrupt.
static void configureFreeFallInterrupt() {
  i2cWrite8(REG_CTRL3_C, 0x44);
  i2cWrite8(REG_CTRL1_XL, 0x6C);   // 416Hz, ±8g — wieksza ODR dla free-fall
  i2cWrite8(REG_CTRL2_G, 0x48);    // gyro 104Hz, ±1000dps (na potem)
  i2cWrite8(REG_TAP_CFG0, 0x41);   // LIR=1, INT_CLR_ON_READ=1
  i2cWrite8(REG_TAP_CFG2, 0x80);   // INTERRUPTS_ENABLE=1
  i2cWrite8(REG_WAKE_UP_DUR, 0x00);
  i2cWrite8(REG_FREE_FALL, (6 << 3) | 0x03);  // FF_DUR=6, FF_THS=312mg
  i2cWrite8(REG_MD1_CFG, 0x10);    // INT1_FF=1
}

// ===========================================================================
// TFLM init + inference (jak w 03).
// ===========================================================================
static bool initTFLM() {
  if (g_model_len < 8) {
    Serial.println("[BLAD] model.h to placeholder. Skopiuj z 03_fall_detector po treningu.");
    return false;
  }
  tflModel = tflite::GetModel(g_model);
  if (tflModel->version() != TFLITE_SCHEMA_VERSION) {
    Serial.printf("[BLAD] Zla wersja schematu TFLite (%lu).\n",
                  (unsigned long)tflModel->version());
    return false;
  }
  static tflite::AllOpsResolver resolver;
  static tflite::MicroInterpreter static_interpreter(
      tflModel, resolver, tensor_arena, kTensorArenaSize);
  interpreter = &static_interpreter;

  if (interpreter->AllocateTensors() != kTfLiteOk) {
    Serial.println("[BLAD] AllocateTensors() failed.");
    return false;
  }
  tflInput  = interpreter->input(0);
  tflOutput = interpreter->output(0);
  in_scale  = tflInput->params.scale;
  in_zero_point = tflInput->params.zero_point;
  out_scale = tflOutput->params.scale;
  out_zero_point = tflOutput->params.zero_point;
  return true;
}

// ===========================================================================
// Inferencja na jednym oknie WINDOW_SIZE x N_CHANNELS (juz znormalizowanym).
// Zwraca klase (0/1/2).
// ===========================================================================
static int inferOneWindow(const float window[][N_CHANNELS]) {
  int8_t* in_data = tflInput->data.int8;
  int idx = 0;
  for (int t = 0; t < WINDOW_SIZE; ++t) {
    for (int c = 0; c < N_CHANNELS; ++c) {
      int32_t q = (int32_t)lroundf(window[t][c] / in_scale) + in_zero_point;
      if (q < -128) q = -128;
      if (q >  127) q =  127;
      in_data[idx++] = (int8_t)q;
    }
  }
  if (interpreter->Invoke() != kTfLiteOk) return 0;

  int best = 0; float best_p = -1.0f;
  for (int i = 0; i < N_CLASSES; ++i) {
    const float p = (tflOutput->data.int8[i] - out_zero_point) * out_scale;
    if (p > best_p) { best_p = p; best = i; }
  }
  return best;
}

// ===========================================================================
// Zbieranie okna 2 s i klasyfikacja kazdym oknem WINDOW_SIZE.
// Konczy alarmem jezeli ktorekolwiek okno = FALL (2).
// ===========================================================================
static bool collectAndClassify() {
  static float buffer[LONG_WINDOW][N_CHANNELS];

  // 1. Zbieramy 2 s @ 100 Hz.
  Serial.println("[INFO] Zbieram 2 s danych po wybudzeniu...");
  uint32_t nextUs = micros();
  for (int i = 0; i < LONG_WINDOW; ++i) {
    sensors_event_t a, g, t;
    imu.getEvent(&a, &g, &t);
    const float acc[3] = {
      a.acceleration.x / 9.80665f,
      a.acceleration.y / 9.80665f,
      a.acceleration.z / 9.80665f
    };
    const float gyr[3] = {
      g.gyro.x * 57.2957795f,
      g.gyro.y * 57.2957795f,
      g.gyro.z * 57.2957795f
    };
    // z-score
    buffer[i][0] = (acc[0] - NORM_MEAN[0]) / NORM_STD[0];
    buffer[i][1] = (acc[1] - NORM_MEAN[1]) / NORM_STD[1];
    buffer[i][2] = (acc[2] - NORM_MEAN[2]) / NORM_STD[2];
    buffer[i][3] = (gyr[0] - NORM_MEAN[3]) / NORM_STD[3];
    buffer[i][4] = (gyr[1] - NORM_MEAN[4]) / NORM_STD[4];
    buffer[i][5] = (gyr[2] - NORM_MEAN[5]) / NORM_STD[5];

    nextUs += SAMPLE_PERIOD_US;
    while ((int32_t)(micros() - nextUs) < 0) { /* spin */ }
  }

  // 2. Klasyfikujemy kazde okno (stride STRIDE).
  bool any_fall = false;
  int votes[N_CLASSES] = {0, 0, 0};
  for (int s = 0; s + WINDOW_SIZE <= LONG_WINDOW; s += STRIDE) {
    // Zbuduj wskaznik do podtablicy (typowo C++: aliasujemy przez VLA-pointer).
    float win[WINDOW_SIZE][N_CHANNELS];
    for (int t = 0; t < WINDOW_SIZE; ++t)
      for (int c = 0; c < N_CHANNELS; ++c)
        win[t][c] = buffer[s + t][c];
    const int cls = inferOneWindow(win);
    votes[cls]++;
    if (cls == 2) any_fall = true;
    Serial.printf("   okno [%3d:%3d] -> %s\n", s, s + WINDOW_SIZE, CLASS_NAMES[cls]);
  }
  Serial.printf("[WYNIK] glosy: ADL=%d, PRE-FALL=%d, FALL=%d\n",
                votes[0], votes[1], votes[2]);
  return any_fall;
}

// ===========================================================================
// Alert: Serial + miganie LED. Tu wstaw realny mechanizm (WiFi/SMS/buzzer).
// ===========================================================================
static void triggerAlert() {
  Serial.println("!!!!! UPADEK WYKRYTY !!!!!");
  // TODO(student): tutaj wstaw realny alert. Np.:
  //   - WiFi.begin(); klient HTTP POST do serwera opieki.
  //   - Twilio/SMS przez API.
  //   - Buzzer na GPIO X.
  pinMode(PIN_LED, OUTPUT);
  for (int i = 0; i < 10; ++i) {
    digitalWrite(PIN_LED, HIGH);
    delay(100);
    digitalWrite(PIN_LED, LOW);
    delay(100);
  }
}

// ===========================================================================
// SETUP — uruchamia sie tez po wybudzeniu z deep sleep.
// ===========================================================================
void setup() {
  Serial.begin(115200);
  delay(300);

  const esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();
  const bool fromSleep = (cause == ESP_SLEEP_WAKEUP_EXT0);

  Serial.println();
  Serial.printf("=== 04_hybrid_lowpower — wakeup cause: %d %s ===\n",
                (int)cause, fromSleep ? "(EXT0 = free-fall)" : "(power-on / inny)");

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);

  if (!findIMU()) {
    Serial.println("[BLAD] Nie znaleziono LSM6DSOX.");
    while (true) delay(1000);
  }

  // Zawsze rekonfigurujemy: po deep sleep stan rejestrow czujnika sie utrzymuje
  // (czujnik nie tracil zasilania), ale dla pewnosci ustawiamy raz jeszcze.
  configureFreeFallInterrupt();

  // Inicjalizuj IMU "wysoko poziomowo" (Adafruit) tylko gdy mamy reagowac
  // na free-fall, czyli teraz musimy zebrac okno.
  if (!imu.begin_I2C(imuAddr, &Wire)) {
    Serial.println("[BLAD] Adafruit lib nie zainicjalizowala czujnika.");
    while (true) delay(1000);
  }
  imu.setAccelRange(LSM6DS_ACCEL_RANGE_8_G);
  imu.setGyroRange(LSM6DS_GYRO_RANGE_1000_DPS);
  imu.setAccelDataRate(LSM6DS_RATE_104_HZ);
  imu.setGyroDataRate(LSM6DS_RATE_104_HZ);

  if (fromSleep) {
    // 1) Inicjalizujemy model i klasyfikujemy okno po wybudzeniu.
    if (!initTFLM()) {
      Serial.println("[BLAD] TFLM init nieudany — wracam do deep sleep.");
    } else {
      const bool fall = collectAndClassify();
      if (fall) triggerAlert();
      else      Serial.println("[INFO] Free-fall byl false-positive (np. silne machanie).");
    }
    // Wyczysc latched INT.
    (void)i2cRead8(REG_WAKE_UP_SRC);
  } else {
    Serial.println("[INFO] Pierwszy start — konfiguracja gotowa, ide spac.");
  }

  // Konfiguracja wybudzania: GPIO 4 HIGH (LSM6DSOX INT1 aktywny stanem wysokim).
  rtc_gpio_init(PIN_INT1_RTC);
  rtc_gpio_set_direction(PIN_INT1_RTC, RTC_GPIO_MODE_INPUT_ONLY);
  rtc_gpio_pulldown_en(PIN_INT1_RTC);
  rtc_gpio_pullup_dis(PIN_INT1_RTC);

  esp_sleep_enable_ext0_wakeup(PIN_INT1_RTC, 1);  // wybudzaj na HIGH

  Serial.println("[INFO] Wchodze w deep sleep. Czekam na free-fall...");
  Serial.flush();
  esp_deep_sleep_start();
  // Nigdy nie wracamy z tej funkcji — po wybudzeniu setup() jest wolany od nowa.
}

void loop() {
  // Niewykorzystywane — caly cykl jest w setup() + deep sleep.
}
