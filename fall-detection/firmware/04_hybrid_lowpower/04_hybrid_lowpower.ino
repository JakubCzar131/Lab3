#include <Arduino.h>
#include <Wire.h>
#include <esp_sleep.h>
#include <Adafruit_LSM6DSOX.h>
#include <Adafruit_Sensor.h>

#include <TensorFlowLite.h>
#include "tensorflow/lite/micro/all_ops_resolver.h"
#include "tensorflow/lite/micro/micro_error_reporter.h"
#include "tensorflow/lite/micro/micro_interpreter.h"
#include "tensorflow/lite/schema/schema_generated.h"

#include "../03_fall_detector/model.h"
#include "../03_fall_detector/normalization.h"

// ====== Stałe projektu ======
constexpr int WINDOW_SIZE = 51;
constexpr int N_CHANNELS = 6;
constexpr int STRIDE = 25;
constexpr int SAMPLE_RATE = 100;
constexpr int SAMPLE_PERIOD_MS = 10;
constexpr int CAPTURE_SECONDS = 2;
constexpr int CAPTURE_SAMPLES = SAMPLE_RATE * CAPTURE_SECONDS; // 200 próbek
constexpr float G_TO_MS2 = 9.80665f;
constexpr float RAD_TO_DPS = 57.2957795f;
constexpr int kTensorArenaSize = 80 * 1024;

// ====== Piny ======
constexpr gpio_num_t PIN_INT1_GPIO = GPIO_NUM_4; // RTC pin do ext0 wakeup
constexpr int PIN_SDA = 8;
constexpr int PIN_SCL = 9;
constexpr int PIN_LED = 5;

// ====== I2C / rejestry ======
constexpr uint8_t ADDR_PRIMARY = 0x6A;
constexpr uint8_t ADDR_FALLBACK = 0x6B;
constexpr uint8_t REG_WHO_AM_I = 0x0F;
constexpr uint8_t REG_CTRL1_XL = 0x10;
constexpr uint8_t REG_CTRL3_C = 0x12;
constexpr uint8_t REG_TAP_CFG0 = 0x56;
constexpr uint8_t REG_FREE_FALL = 0x5D;
constexpr uint8_t REG_MD1_CFG = 0x5E;
constexpr uint8_t REG_WAKE_UP_SRC = 0x1B;

Adafruit_LSM6DSOX imu;
uint8_t g_imuAddr = ADDR_PRIMARY;
const char* CLASS_NAMES[3] = {"ADL", "PRE-FALL", "FALL"};

// ====== TFLM ======
tflite::MicroErrorReporter micro_error_reporter;
tflite::ErrorReporter* error_reporter = &micro_error_reporter;
tflite::AllOpsResolver resolver;
const tflite::Model* model = nullptr;
tflite::MicroInterpreter* interpreter = nullptr;
TfLiteTensor* input_tensor = nullptr;
TfLiteTensor* output_tensor = nullptr;
alignas(16) uint8_t tensor_arena[kTensorArenaSize];

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
  // Acc: 104Hz, +/-8g + IF_INC/BDU.
  writeReg(REG_CTRL3_C, 0x44);
  writeReg(REG_CTRL1_XL, 0x4C);

  // Latch interrupt, aby nie zgubić sygnału podczas deep sleep wake.
  writeReg(REG_TAP_CFG0, 0x01);

  // Próg/czas free-fall (punkt startowy do strojenia).
  const uint8_t freeFallCfg = static_cast<uint8_t>((6 << 3) | 0x03);
  writeReg(REG_FREE_FALL, freeFallCfg);

  // Routing free-fall na INT1.
  writeReg(REG_MD1_CFG, 0x10);
}

bool beginImuDriver() {
  if (imu.begin_I2C(g_imuAddr, &Wire)) return true;
  return false;
}

void configureImuForSampling() {
  imu.setAccelRange(LSM6DS_ACCEL_RANGE_8_G);
  imu.setGyroRange(LSM6DS_GYRO_RANGE_1000_DPS);
  imu.setAccelDataRate(LSM6DS_RATE_104_HZ);
  imu.setGyroDataRate(LSM6DS_RATE_104_HZ);
}

void initTflm() {
  model = tflite::GetModel(g_model);
  if (model->version() != TFLITE_SCHEMA_VERSION) {
    Serial.println("[BLAD] Niezgodna wersja modelu TFLite.");
    while (true) delay(1000);
  }

  static tflite::MicroInterpreter static_interpreter(
      model, resolver, tensor_arena, kTensorArenaSize, error_reporter);
  interpreter = &static_interpreter;

  if (interpreter->AllocateTensors() != kTfLiteOk) {
    Serial.println("[BLAD] AllocateTensors failed.");
    while (true) delay(1000);
  }
  input_tensor = interpreter->input(0);
  output_tensor = interpreter->output(0);
}

int8_t quantizeToInt8(float value, float scale, int32_t zero_point) {
  const int32_t q = static_cast<int32_t>(roundf(value / scale)) + zero_point;
  if (q > 127) return 127;
  if (q < -128) return -128;
  return static_cast<int8_t>(q);
}

float dequantizeFromInt8(int8_t value, float scale, int32_t zero_point) {
  return (static_cast<int32_t>(value) - zero_point) * scale;
}

void readNormalizedSample(float out_sample[N_CHANNELS]) {
  sensors_event_t accel, gyro, temp;
  imu.getEvent(&accel, &gyro, &temp);

  float raw[N_CHANNELS] = {
      accel.acceleration.x / G_TO_MS2,
      accel.acceleration.y / G_TO_MS2,
      accel.acceleration.z / G_TO_MS2,
      gyro.gyro.x * RAD_TO_DPS,
      gyro.gyro.y * RAD_TO_DPS,
      gyro.gyro.z * RAD_TO_DPS,
  };

  for (int i = 0; i < N_CHANNELS; ++i) {
    const float denom = (fabsf(NORM_STD[i]) < 1e-9f) ? 1.0f : NORM_STD[i];
    out_sample[i] = (raw[i] - NORM_MEAN[i]) / denom;
  }
}

void copyWindowToInput(const float capture[CAPTURE_SAMPLES][N_CHANNELS], int start_idx) {
  const float in_scale = input_tensor->params.scale;
  const int32_t in_zero = input_tensor->params.zero_point;

  for (int t = 0; t < WINDOW_SIZE; ++t) {
    for (int ch = 0; ch < N_CHANNELS; ++ch) {
      const float v = capture[start_idx + t][ch];
      input_tensor->data.int8[t * N_CHANNELS + ch] =
          quantizeToInt8(v, in_scale, in_zero);
    }
  }
}

void inferWindow(const float capture[CAPTURE_SAMPLES][N_CHANNELS], int start_idx, int& out_class, float& out_conf) {
  copyWindowToInput(capture, start_idx);
  if (interpreter->Invoke() != kTfLiteOk) {
    out_class = 0;
    out_conf = 0.0f;
    return;
  }

  const float out_scale = output_tensor->params.scale;
  const int32_t out_zero = output_tensor->params.zero_point;
  out_class = 0;
  out_conf = -1.0f;

  for (int i = 0; i < 3; ++i) {
    const float prob = dequantizeFromInt8(output_tensor->data.int8[i], out_scale, out_zero);
    if (prob > out_conf) {
      out_conf = prob;
      out_class = i;
    }
  }
}

void blinkAlertLed(int times, int on_ms = 120, int off_ms = 120) {
  for (int i = 0; i < times; ++i) {
    digitalWrite(PIN_LED, HIGH);
    delay(on_ms);
    digitalWrite(PIN_LED, LOW);
    delay(off_ms);
  }
}

void runPostWakeClassification() {
  Serial.println("[WAKE] Wybudzenie przez free-fall. Zbieram 2 s danych...");

  float capture[CAPTURE_SAMPLES][N_CHANNELS];
  uint32_t tick_ms = millis();
  for (int i = 0; i < CAPTURE_SAMPLES; ++i) {
    while ((millis() - tick_ms) < SAMPLE_PERIOD_MS) {
      delay(1);
    }
    tick_ms += SAMPLE_PERIOD_MS;
    readNormalizedSample(capture[i]);
  }

  int final_class = 0;
  float final_conf = 0.0f;

  for (int start = 0; start <= (CAPTURE_SAMPLES - WINDOW_SIZE); start += STRIDE) {
    int cls = 0;
    float conf = 0.0f;
    inferWindow(capture, start, cls, conf);
    Serial.print("Okno start=");
    Serial.print(start);
    Serial.print(" -> class=");
    Serial.print(cls);
    Serial.print(" (");
    Serial.print(CLASS_NAMES[cls]);
    Serial.print(") conf=");
    Serial.println(conf, 4);

    // Priorytet bezpieczeństwa: FALL > PRE-FALL > ADL.
    if ((cls > final_class) || (cls == final_class && conf > final_conf)) {
      final_class = cls;
      final_conf = conf;
    }
  }

  Serial.print("[WYNIK] ");
  Serial.print(CLASS_NAMES[final_class]);
  Serial.print(" (class=");
  Serial.print(final_class);
  Serial.print(", conf=");
  Serial.print(final_conf, 4);
  Serial.println(")");

  if (final_class >= 1) {
    Serial.println("[ALERT] Zdarzenie krytyczne wykryte!");
    blinkAlertLed(6);
    // TODO: tutaj podłącz realny kanał alarmu (WiFi/SMS/buzzer).
  }
}

void enterDeepSleep() {
  // Odczyt źródła usuwa flagę latched i ogranicza natychmiastowe wybudzenie.
  (void)readReg(REG_WAKE_UP_SRC);

  Serial.println("[SLEEP] Przechodzę do deep sleep. Oczekuję INT1 na GPIO4...");
  Serial.flush();

  esp_sleep_enable_ext0_wakeup(PIN_INT1_GPIO, 1); // Wakeup na stan wysoki.
  delay(50);
  esp_deep_sleep_start();
}

void setup() {
  Serial.begin(115200);
  delay(1200);
  Serial.println("\n=== 04_hybrid_lowpower ===");

  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);
  pinMode(static_cast<int>(PIN_INT1_GPIO), INPUT);

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);

  if (!detectImuAddress()) {
    Serial.println("[BLAD] Nie wykryto LSM6DSOX.");
    while (true) delay(1000);
  }

  configureFreeFallInterrupt();
  if (!beginImuDriver()) {
    Serial.println("[BLAD] Nie udało się zainicjalizować Adafruit_LSM6DSOX.");
    while (true) delay(1000);
  }
  configureImuForSampling();
  initTflm();

  const esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();
  if (cause == ESP_SLEEP_WAKEUP_EXT0) {
    runPostWakeClassification();
  } else {
    Serial.println("[INFO] Pierwsze uruchomienie: od razu przejście w deep sleep.");
  }

  enterDeepSleep();
}

void loop() {
  // Nieużywane: urządzenie po setup wraca do deep sleep.
}
