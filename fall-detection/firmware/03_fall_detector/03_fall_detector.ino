/*
  03_fall_detector

  Glowny komponent projektu:
  - probkowanie LSM6DSOX co 10 ms,
  - bufor okrezny WINDOW_SIZE x N_CHANNELS,
  - normalizacja z-score identyczna jak w Pythonie,
  - inferencja TFLite Micro co STRIDE probek,
  - klasy: 0 ADL, 1 PRE-FALL, 2 FALL.
*/

#include <Adafruit_LSM6DSOX.h>
#include <Wire.h>

#include "model.h"
#include "normalization.h"

#include "tensorflow/lite/micro/all_ops_resolver.h"
#include "tensorflow/lite/micro/micro_interpreter.h"
#include "tensorflow/lite/schema/schema_generated.h"

constexpr uint8_t PIN_SDA = 8;
constexpr uint8_t PIN_SCL = 9;
constexpr uint8_t LSM6DSOX_ADDR_PRIMARY = 0x6A;
constexpr uint8_t LSM6DSOX_ADDR_FALLBACK = 0x6B;

constexpr int WINDOW_SIZE = 51;
constexpr int N_CHANNELS = 6;
constexpr int STRIDE = 25;
constexpr uint32_t SAMPLE_PERIOD_MS = 10;  // 100 Hz
constexpr int kTensorArenaSize = 80 * 1024;

const char* CLASS_NAMES[] = {"ADL", "PRE-FALL", "FALL"};

Adafruit_LSM6DSOX imu;

alignas(16) uint8_t tensor_arena[kTensorArenaSize];
const tflite::Model* model = nullptr;
tflite::MicroInterpreter* interpreter = nullptr;
TfLiteTensor* input = nullptr;
TfLiteTensor* output = nullptr;

float ringBuffer[WINDOW_SIZE][N_CHANNELS];
int ringIndex = 0;          // Indeks nastepnego miejsca zapisu.
uint32_t samplesSeen = 0;
uint32_t samplesSinceInference = 0;
uint32_t nextSampleMs = 0;

bool beginImuAt(uint8_t address) {
  Serial.print("Proba LSM6DSOX 0x");
  Serial.println(address, HEX);
  return imu.begin_I2C(address, &Wire);
}

void configureImu() {
  imu.setAccelRange(LSM6DS_ACCEL_RANGE_8_G);
  imu.setGyroRange(LSM6DS_GYRO_RANGE_1000_DPS);
  imu.setAccelDataRate(LSM6DS_RATE_104_HZ);
  imu.setGyroDataRate(LSM6DS_RATE_104_HZ);
}

bool initTflm() {
  model = tflite::GetModel(g_model);
  if (model->version() != TFLITE_SCHEMA_VERSION) {
    Serial.print("BLAD: niepoprawny model.tflite. Wersja schema=");
    Serial.print(model->version());
    Serial.print(", oczekiwano=");
    Serial.println(TFLITE_SCHEMA_VERSION);
    Serial.println("Wygeneruj firmware/03_fall_detector/model.h skryptem 3_export_header.py.");
    return false;
  }

  static tflite::AllOpsResolver resolver;
  static tflite::MicroInterpreter staticInterpreter(
      model, resolver, tensor_arena, kTensorArenaSize);
  interpreter = &staticInterpreter;

  if (interpreter->AllocateTensors() != kTfLiteOk) {
    Serial.println("BLAD: AllocateTensors failed.");
    Serial.println("Sprawdz PSRAM OPI, Huge APP albo zwieksz kTensorArenaSize.");
    return false;
  }

  input = interpreter->input(0);
  output = interpreter->output(0);

  if (input->type != kTfLiteInt8 || output->type != kTfLiteInt8) {
    Serial.println("BLAD: model musi miec wejscie i wyjscie INT8.");
    return false;
  }

  Serial.print("TFLM gotowe. Arena=");
  Serial.print(kTensorArenaSize);
  Serial.println(" B");
  return true;
}

void readNormalizedSample(float sample[N_CHANNELS]) {
  sensors_event_t accel;
  sensors_event_t gyro;
  sensors_event_t temp;
  imu.getEvent(&accel, &gyro, &temp);

  // Jednostki zgodne z preprocessingiem KFall: acc w g, gyro w deg/s.
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

void pushSample(const float sample[N_CHANNELS]) {
  for (int c = 0; c < N_CHANNELS; ++c) {
    ringBuffer[ringIndex][c] = sample[c];
  }
  ringIndex = (ringIndex + 1) % WINDOW_SIZE;
  samplesSeen++;
  samplesSinceInference++;
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

void copyWindowToInputTensor() {
  int index = 0;
  for (int t = 0; t < WINDOW_SIZE; ++t) {
    // Gdy bufor jest pelny, ringIndex wskazuje najstarsza probke.
    const int src = (ringIndex + t) % WINDOW_SIZE;
    for (int c = 0; c < N_CHANNELS; ++c) {
      input->data.int8[index++] = quantizeToInt8(ringBuffer[src][c], input->params);
    }
  }
}

void runInference() {
  copyWindowToInputTensor();

  const uint32_t t0 = millis();
  const TfLiteStatus status = interpreter->Invoke();
  const uint32_t inferMs = millis() - t0;

  if (status != kTfLiteOk) {
    Serial.println("BLAD: Invoke failed.");
    return;
  }

  int bestClass = 0;
  float bestScore = -1000.0f;
  for (int i = 0; i < 3; ++i) {
    const float score = dequantizeFromInt8(output->data.int8[i], output->params);
    if (score > bestScore) {
      bestScore = score;
      bestClass = i;
    }
  }

  if (bestScore < 0.0f) {
    bestScore = 0.0f;
  }
  if (bestScore > 1.0f) {
    bestScore = 1.0f;
  }

  Serial.print(bestClass == 0 ? ".. " : "!! ");
  Serial.print(CLASS_NAMES[bestClass]);
  Serial.print(" conf=");
  Serial.print(bestScore, 3);
  Serial.print(" inferencja=");
  Serial.print(inferMs);
  Serial.println(" ms");

  if (inferMs > 20) {
    Serial.println("UWAGA: inferencja przekroczyla 20 ms.");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println();
  Serial.println("03_fall_detector: TFLM realtime");

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);

  if (!beginImuAt(LSM6DSOX_ADDR_PRIMARY) && !beginImuAt(LSM6DSOX_ADDR_FALLBACK)) {
    Serial.println("BLAD: nie znaleziono LSM6DSOX.");
    while (true) {
      delay(1000);
    }
  }
  configureImu();

  if (!initTflm()) {
    while (true) {
      delay(1000);
    }
  }

  nextSampleMs = millis();
}

void loop() {
  const uint32_t now = millis();
  if (static_cast<int32_t>(now - nextSampleMs) < 0) {
    delay(1);
    return;
  }
  nextSampleMs += SAMPLE_PERIOD_MS;

  float sample[N_CHANNELS];
  readNormalizedSample(sample);
  pushSample(sample);

  if (samplesSeen >= WINDOW_SIZE && samplesSinceInference >= STRIDE) {
    samplesSinceInference = 0;
    runInference();
  }
}

