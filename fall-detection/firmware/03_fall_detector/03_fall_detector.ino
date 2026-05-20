#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_LSM6DSOX.h>
#include <Adafruit_Sensor.h>

#include <TensorFlowLite.h>
#include "tensorflow/lite/micro/all_ops_resolver.h"
#include "tensorflow/lite/micro/micro_error_reporter.h"
#include "tensorflow/lite/micro/micro_interpreter.h"
#include "tensorflow/lite/schema/schema_generated.h"

#include "model.h"
#include "normalization.h"

// ====== Stałe projektu ======
constexpr int WINDOW_SIZE = 51;
constexpr int N_CHANNELS = 6;
constexpr int STRIDE = 25;
constexpr int SAMPLE_PERIOD_MS = 10; // 100 Hz
constexpr float G_TO_MS2 = 9.80665f;
constexpr float RAD_TO_DPS = 57.2957795f;
constexpr int kTensorArenaSize = 80 * 1024;

// ====== Piny i IMU ======
constexpr uint8_t PIN_SDA = 8;
constexpr uint8_t PIN_SCL = 9;
constexpr uint8_t I2C_ADDR_PRIMARY = 0x6A;
constexpr uint8_t I2C_ADDR_FALLBACK = 0x6B;

Adafruit_LSM6DSOX imu;

// ====== TFLM ======
tflite::MicroErrorReporter micro_error_reporter;
tflite::ErrorReporter* error_reporter = &micro_error_reporter;
const tflite::Model* model = nullptr;
tflite::AllOpsResolver resolver;
tflite::MicroInterpreter* interpreter = nullptr;
TfLiteTensor* input_tensor = nullptr;
TfLiteTensor* output_tensor = nullptr;

alignas(16) uint8_t tensor_arena[kTensorArenaSize];

// ====== Bufor okrężny ======
float ring_buffer[WINDOW_SIZE][N_CHANNELS];
int ring_head = 0;            // Pozycja następnego zapisu.
int samples_collected = 0;    // Ile próbek mamy w buforze.
int stride_counter = 0;       // Licznik do uruchamiania inferencji co STRIDE.
uint32_t last_sample_ms = 0;

const char* CLASS_NAMES[3] = {"ADL", "PRE-FALL", "FALL"};

bool beginImuWithFallback() {
  if (imu.begin_I2C(I2C_ADDR_PRIMARY, &Wire)) {
    Serial.println("[IMU] Wykryto pod adresem 0x6A");
    return true;
  }
  if (imu.begin_I2C(I2C_ADDR_FALLBACK, &Wire)) {
    Serial.println("[IMU] Wykryto pod adresem 0x6B (fallback)");
    return true;
  }
  return false;
}

void configureImu() {
  imu.setAccelRange(LSM6DS_ACCEL_RANGE_8_G);
  imu.setGyroRange(LSM6DS_GYRO_RANGE_1000_DPS);
  imu.setAccelDataRate(LSM6DS_RATE_104_HZ);
  imu.setGyroDataRate(LSM6DS_RATE_104_HZ);
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

void readAndNormalizeSample(float out_sample[N_CHANNELS]) {
  sensors_event_t accel, gyro, temp;
  imu.getEvent(&accel, &gyro, &temp);

  // Konwersja jednostek pod typowy zapis datasetu: acc[g], gyro[dps].
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

void pushSampleToRing(const float sample[N_CHANNELS]) {
  for (int ch = 0; ch < N_CHANNELS; ++ch) {
    ring_buffer[ring_head][ch] = sample[ch];
  }

  ring_head = (ring_head + 1) % WINDOW_SIZE;
  if (samples_collected < WINDOW_SIZE) {
    samples_collected++;
  }
  stride_counter++;
}

void copyWindowToModelInput() {
  const float in_scale = input_tensor->params.scale;
  const int32_t in_zero = input_tensor->params.zero_point;

  // Ring buffer jest układany od najstarszej do najnowszej próbki.
  for (int t = 0; t < WINDOW_SIZE; ++t) {
    const int src_idx = (ring_head + t) % WINDOW_SIZE;
    for (int ch = 0; ch < N_CHANNELS; ++ch) {
      const int flat_idx = t * N_CHANNELS + ch;
      input_tensor->data.int8[flat_idx] =
          quantizeToInt8(ring_buffer[src_idx][ch], in_scale, in_zero);
    }
  }
}

void runInference() {
  copyWindowToModelInput();

  const uint32_t t0_us = micros();
  const TfLiteStatus status = interpreter->Invoke();
  const uint32_t infer_us = micros() - t0_us;

  if (status != kTfLiteOk) {
    Serial.println("[BLAD] Invoke() nie powiodło się.");
    return;
  }

  const float out_scale = output_tensor->params.scale;
  const int32_t out_zero = output_tensor->params.zero_point;

  float probs[3];
  int best_idx = 0;
  float best_prob = -1.0f;

  for (int i = 0; i < 3; ++i) {
    probs[i] = dequantizeFromInt8(output_tensor->data.int8[i], out_scale, out_zero);
    if (probs[i] > best_prob) {
      best_prob = probs[i];
      best_idx = i;
    }
  }

  const char* prefix = (best_idx == 0) ? ".." : "!!";
  Serial.print(prefix);
  Serial.print(" class=");
  Serial.print(best_idx);
  Serial.print(" (");
  Serial.print(CLASS_NAMES[best_idx]);
  Serial.print(") conf=");
  Serial.print(best_prob, 4);
  Serial.print(" infer_ms=");
  Serial.print(infer_us / 1000.0f, 3);
  Serial.print(" probs=[");
  Serial.print(probs[0], 4);
  Serial.print(", ");
  Serial.print(probs[1], 4);
  Serial.print(", ");
  Serial.print(probs[2], 4);
  Serial.println("]");
}

void initTflm() {
  model = tflite::GetModel(g_model);
  if (model->version() != TFLITE_SCHEMA_VERSION) {
    Serial.println("[BLAD] Niezgodna wersja schematu modelu TFLite.");
    while (true) delay(1000);
  }

  static tflite::MicroInterpreter static_interpreter(
      model, resolver, tensor_arena, kTensorArenaSize, error_reporter);
  interpreter = &static_interpreter;

  if (interpreter->AllocateTensors() != kTfLiteOk) {
    Serial.println("[BLAD] AllocateTensors() nie powiodło się.");
    Serial.println("Sprawdź model, rozmiar tensor_arena i konfigurację pamięci.");
    while (true) delay(1000);
  }

  input_tensor = interpreter->input(0);
  output_tensor = interpreter->output(0);

  if (input_tensor->type != kTfLiteInt8 || output_tensor->type != kTfLiteInt8) {
    Serial.println("[BLAD] Model nie ma wejścia/wyjścia INT8.");
    while (true) delay(1000);
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=== 03_fall_detector: TFLM online ===");

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);

  if (!beginImuWithFallback()) {
    Serial.println("[BLAD] Nie wykryto LSM6DSOX.");
    while (true) delay(1000);
  }
  configureImu();
  Serial.println("[OK] IMU skonfigurowane (104Hz, +/-8g, +/-1000dps).");

  initTflm();
  Serial.println("[OK] TFLM gotowe.");
  Serial.println("Inferencja co 25 próbek (~250 ms), okno 51 próbek.");

  last_sample_ms = millis();
}

void loop() {
  const uint32_t now = millis();
  if ((now - last_sample_ms) < SAMPLE_PERIOD_MS) {
    return;
  }
  last_sample_ms += SAMPLE_PERIOD_MS;

  float sample[N_CHANNELS];
  readAndNormalizeSample(sample);
  pushSampleToRing(sample);

  if (samples_collected >= WINDOW_SIZE && stride_counter >= STRIDE) {
    stride_counter = 0;
    runInference();
  }
}
