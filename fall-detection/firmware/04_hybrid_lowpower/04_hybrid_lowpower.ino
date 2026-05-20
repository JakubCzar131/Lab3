/*
  04_hybrid_lowpower

  Architektura hybrydowa:
  1. LSM6DSOX dziala autonomicznie i wykrywa free-fall.
  2. INT1 na GPIO4 budzi ESP32-S3 z deep sleep.
  3. Po wybudzeniu MCU zbiera 2 s danych @100 Hz.
  4. TFLite Micro klasyfikuje ostatnie okno 51 probek.
  5. Alert jest teraz demonstracyjny: Serial + miganie LED GPIO5.

  Miejsce na realny alert: funkcja sendAlert(). Tam mozna dodac WiFi, SMS,
  buzzer, BLE albo komunikacje z telefonem.
*/

#include <Adafruit_LSM6DSOX.h>
#include <Wire.h>
#include <esp_sleep.h>

#include "model.h"
#include "normalization.h"

#include "tensorflow/lite/micro/all_ops_resolver.h"
#include "tensorflow/lite/micro/micro_interpreter.h"
#include "tensorflow/lite/schema/schema_generated.h"

constexpr uint8_t PIN_SDA = 8;
constexpr uint8_t PIN_SCL = 9;
constexpr uint8_t PIN_INT1 = 4;
constexpr uint8_t PIN_ALERT_LED = 5;

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

constexpr int WINDOW_SIZE = 51;
constexpr int N_CHANNELS = 6;
constexpr int CAPTURE_SAMPLES = 200;  // 2 s @ 100 Hz.
constexpr uint32_t SAMPLE_PERIOD_MS = 10;
constexpr int kTensorArenaSize = 80 * 1024;

const char* CLASS_NAMES[] = {"ADL", "PRE-FALL", "FALL"};

Adafruit_LSM6DSOX imu;
uint8_t imuAddr = LSM6DSOX_ADDR_PRIMARY;

alignas(16) uint8_t tensor_arena[kTensorArenaSize];
const tflite::Model* model = nullptr;
tflite::MicroInterpreter* interpreter = nullptr;
TfLiteTensor* input = nullptr;
TfLiteTensor* output = nullptr;

float capture[CAPTURE_SAMPLES][N_CHANNELS];

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

bool detectImuAddress() {
  for (uint8_t addr : {LSM6DSOX_ADDR_PRIMARY, LSM6DSOX_ADDR_FALLBACK}) {
    imuAddr = addr;
    if (readReg(REG_WHO_AM_I) == WHO_AM_I_EXPECTED) {
      return true;
    }
  }
  return false;
}

void configureImuForSampling() {
  imu.setAccelRange(LSM6DS_ACCEL_RANGE_8_G);
  imu.setGyroRange(LSM6DS_GYRO_RANGE_1000_DPS);
  imu.setAccelDataRate(LSM6DS_RATE_104_HZ);
  imu.setGyroDataRate(LSM6DS_RATE_104_HZ);
}

void configureFreeFallInterrupt() {
  // BDU=1, IF_INC=1.
  writeReg(REG_CTRL3_C, 0x44);

  // ODR 104 Hz + zakres projektu.
  writeReg(REG_CTRL1_XL, 0x4C);
  writeReg(REG_CTRL2_G, 0x48);

  // Latch interrupt do czasu odczytu WAKE_UP_SRC.
  writeReg(REG_TAP_CFG0, 0x01);

  // Prog i czas free-fall do walidacji eksperymentalnej.
  writeReg(REG_FREE_FALL, 0x33);

  // INT1_FF -> INT1.
  writeReg(REG_MD1_CFG, 0x10);
  (void)readReg(REG_WAKE_UP_SRC);
}

bool initTflm() {
  model = tflite::GetModel(g_model);
  if (model->version() != TFLITE_SCHEMA_VERSION) {
    Serial.println("BLAD: model.h jest placeholderem albo ma zla wersje schema.");
    return false;
  }

  static tflite::AllOpsResolver resolver;
  static tflite::MicroInterpreter staticInterpreter(
      model, resolver, tensor_arena, kTensorArenaSize);
  interpreter = &staticInterpreter;

  if (interpreter->AllocateTensors() != kTfLiteOk) {
    Serial.println("BLAD: AllocateTensors failed w trybie hybrydowym.");
    return false;
  }

  input = interpreter->input(0);
  output = interpreter->output(0);
  return input->type == kTfLiteInt8 && output->type == kTfLiteInt8;
}

void readNormalizedSample(float sample[N_CHANNELS]) {
  sensors_event_t accel;
  sensors_event_t gyro;
  sensors_event_t temp;
  imu.getEvent(&accel, &gyro, &temp);

  const float raw[N_CHANNELS] = {
      accel.acceleration.x / 9.80665f,
      accel.acceleration.y / 9.80665f,
      accel.acceleration.z / 9.80665f,
      gyro.gyro.x * 57.2957795f,
      gyro.gyro.y * 57.2957795f,
      gyro.gyro.z * 57.2957795f,
  };

  for (int c = 0; c < N_CHANNELS; ++c) {
    sample[c] = (raw[c] - NORM_MEAN[c]) / NORM_STD[c];
  }
}

int8_t quantizeToInt8(float value, const TfLiteQuantizationParams& params) {
  const int32_t q = static_cast<int32_t>(roundf(value / params.scale) + params.zero_point);
  if (q < -128) {
    return -128;
  }
  if (q > 127) {
    return 127;
  }
  return static_cast<int8_t>(q);
}

float dequantizeFromInt8(int8_t value, const TfLiteQuantizationParams& params) {
  return (static_cast<int32_t>(value) - params.zero_point) * params.scale;
}

void collectTwoSeconds() {
  Serial.println("Zbieram 2 s danych po free-fall...");
  uint32_t nextSampleMs = millis();
  for (int i = 0; i < CAPTURE_SAMPLES; ++i) {
    while (static_cast<int32_t>(millis() - nextSampleMs) < 0) {
      delay(1);
    }
    nextSampleMs += SAMPLE_PERIOD_MS;
    readNormalizedSample(capture[i]);
  }
}

int classifyLastWindow(float* confidence, uint32_t* inferenceMs) {
  int tensorIndex = 0;
  const int start = CAPTURE_SAMPLES - WINDOW_SIZE;
  for (int t = 0; t < WINDOW_SIZE; ++t) {
    for (int c = 0; c < N_CHANNELS; ++c) {
      input->data.int8[tensorIndex++] =
          quantizeToInt8(capture[start + t][c], input->params);
    }
  }

  const uint32_t t0 = millis();
  if (interpreter->Invoke() != kTfLiteOk) {
    Serial.println("BLAD: Invoke failed.");
    *confidence = 0.0f;
    *inferenceMs = 0;
    return 0;
  }
  *inferenceMs = millis() - t0;

  int bestClass = 0;
  float bestScore = -1000.0f;
  for (int i = 0; i < 3; ++i) {
    const float score = dequantizeFromInt8(output->data.int8[i], output->params);
    if (score > bestScore) {
      bestScore = score;
      bestClass = i;
    }
  }
  *confidence = constrain(bestScore, 0.0f, 1.0f);
  return bestClass;
}

void sendAlert(int cls, float confidence, uint32_t inferenceMs) {
  Serial.print(cls == 0 ? ".. " : "!! ");
  Serial.print(CLASS_NAMES[cls]);
  Serial.print(" conf=");
  Serial.print(confidence, 3);
  Serial.print(" inferencja=");
  Serial.print(inferenceMs);
  Serial.println(" ms");

  if (cls > 0) {
    // Tu wstaw realny alert: WiFi/SMS/buzzer/BLE.
    for (int i = 0; i < 8; ++i) {
      digitalWrite(PIN_ALERT_LED, !digitalRead(PIN_ALERT_LED));
      delay(150);
    }
    digitalWrite(PIN_ALERT_LED, LOW);
  }
}

void goToDeepSleep() {
  Serial.println("Konfiguracja free-fall i wejscie w deep sleep...");
  configureFreeFallInterrupt();
  pinMode(PIN_INT1, INPUT);
  esp_sleep_enable_ext0_wakeup(static_cast<gpio_num_t>(PIN_INT1), 1);
  Serial.flush();
  esp_deep_sleep_start();
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  pinMode(PIN_ALERT_LED, OUTPUT);
  digitalWrite(PIN_ALERT_LED, LOW);

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);

  Serial.println();
  Serial.println("04_hybrid_lowpower: free-fall wakeup + CNN");

  if (!detectImuAddress()) {
    Serial.println("BLAD: nie znaleziono LSM6DSOX.");
    while (true) {
      delay(1000);
    }
  }

  if (!imu.begin_I2C(imuAddr, &Wire)) {
    Serial.println("BLAD: Adafruit begin_I2C nie powiodl sie.");
    while (true) {
      delay(1000);
    }
  }
  configureImuForSampling();

  if (esp_sleep_get_wakeup_cause() != ESP_SLEEP_WAKEUP_EXT0) {
    Serial.println("Start zimny: jeszcze nie klasyfikuje, uzbrajam czujnik.");
    goToDeepSleep();
  }

  Serial.println("Wybudzenie przez INT1/free-fall.");
  (void)readReg(REG_WAKE_UP_SRC);

  if (!initTflm()) {
    Serial.println("TFLM niegotowe; wracam do deep sleep po komunikacie.");
    delay(2000);
    goToDeepSleep();
  }

  collectTwoSeconds();
  float confidence = 0.0f;
  uint32_t inferenceMs = 0;
  const int cls = classifyLastWindow(&confidence, &inferenceMs);
  sendAlert(cls, confidence, inferenceMs);

  goToDeepSleep();
}

void loop() {
  // Nie powinno sie wykonac, bo setup konczy sie esp_deep_sleep_start().
}

