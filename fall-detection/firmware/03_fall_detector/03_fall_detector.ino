/*
 * 03_fall_detector — GLOWNY KOMPONENT: inferencja 1D-CNN na ESP32-S3 + LSM6DSOX
 *                    z uzyciem TensorFlow Lite for Microcontrollers (TFLM).
 *
 * Architektura: czysty TFLM 24/7. Czujnik probkowany 100 Hz, bufor okrezny
 * 51 probek x 6 osi. Co STRIDE (25) probek odpalamy Invoke() na modelu INT8.
 * Wynik: klasa (ADL / PRE-FALL / FALL) + pewnosc + czas inferencji w ms.
 *
 * --- INSTALACJA BIBLIOTEK ---
 * 1. "Adafruit LSM6DS"            (Library Manager)
 * 2. "Adafruit BusIO" + "Adafruit Unified Sensor"  (zaleznosci)
 * 3. "Chirale_TensorFlowLite"     (fork TFLM dzialajacy na ESP32-S3)
 *    Alternatywa: "TensorFlowLite_ESP32" (Espressif). Naglowki sa kompatybilne
 *    (tflite::Micro*). Jezeli uzywasz tej drugiej, zakomentuj #include "Chirale..."
 *    i odkomentuj #include "TensorFlowLite_ESP32.h".
 *
 * --- USTAWIENIA PLYTKI ---
 *   Board:       ESP32S3 Dev Module
 *   USB CDC:     Enabled
 *   PSRAM:       OPI PSRAM
 *   Partition:   Huge APP (3MB No OTA/1MB SPIFFS)
 *
 * --- POLACZENIA ---
 *   LSM6DSOX VIN -> 3V3
 *   LSM6DSOX GND -> GND
 *   LSM6DSOX SDA -> GPIO 8
 *   LSM6DSOX SCL -> GPIO 9
 *   (INT1 -> GPIO 4 — nieuzywane w tym szkicu, ale podlaczone)
 */

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_LSM6DSOX.h>

// ---- TFLM (Chirale fork; jezeli masz inny pakiet, zmien include) ----
// #include <TensorFlowLite_ESP32.h>
#include <Chirale_TensorFlowLite.h>
#include "tensorflow/lite/micro/all_ops_resolver.h"
#include "tensorflow/lite/micro/micro_interpreter.h"
#include "tensorflow/lite/micro/system_setup.h"
#include "tensorflow/lite/schema/schema_generated.h"

// ---- Naglowki wygenerowane z Pythona ----
#include "model.h"           // g_model[], g_model_len
#include "normalization.h"   // NORM_MEAN, NORM_STD, NORM_WINDOW_SIZE, NORM_N_CHANNELS

// ===========================================================================
// Stale projektu — MUSZA byc spojne z utils.py (Python).
// ===========================================================================
static constexpr int WINDOW_SIZE = NORM_WINDOW_SIZE;   // 51
static constexpr int N_CHANNELS  = NORM_N_CHANNELS;    // 6
static constexpr int STRIDE      = 25;                 // co ~250 ms inferencja
static constexpr int N_CLASSES   = 3;
static const char* CLASS_NAMES[N_CLASSES] = { "ADL", "PRE-FALL", "FALL" };

// Probkowanie 100 Hz = co 10 ms.
static constexpr uint32_t SAMPLE_PERIOD_US = 10000;

// I2C i pin INT (INT1 nieuzywany w tym szkicu).
static constexpr int PIN_SDA = 8;
static constexpr int PIN_SCL = 9;
static constexpr uint8_t I2C_ADDR_PRIMARY  = 0x6A;
static constexpr uint8_t I2C_ADDR_FALLBACK = 0x6B;

Adafruit_LSM6DSOX imu;

// ===========================================================================
// TFLM — arena na tensory. 80 KB to bezpieczny rozmiar dla naszej sieci
// (<50k parametrow). Jezeli AllocateTensors() padnie, zwieksz do 100*1024.
// ESP32-S3 z OPI PSRAM ma DUZO RAMu, to nie problem.
// ===========================================================================
static constexpr int kTensorArenaSize = 80 * 1024;
alignas(16) static uint8_t tensor_arena[kTensorArenaSize];

static const tflite::Model* tflModel = nullptr;
static tflite::MicroInterpreter* interpreter = nullptr;
static TfLiteTensor* tflInput = nullptr;
static TfLiteTensor* tflOutput = nullptr;

// Cechy kwantyzacji INT8 — odczytane z modelu po AllocateTensors().
static float in_scale = 1.0f;
static int   in_zero_point = 0;
static float out_scale = 1.0f;
static int   out_zero_point = 0;

// ===========================================================================
// Bufor okrezny: WINDOW_SIZE x N_CHANNELS, znormalizowany (z-score).
// ===========================================================================
static float ring[WINDOW_SIZE][N_CHANNELS];
static int   ring_head = 0;        // indeks NASTEPNEJ probki do nadpisania
static int   samples_since_last = 0;
static uint32_t total_samples = 0;

// ===========================================================================
// Pomocnicze: znajdz IMU pod 0x6A/0x6B.
// ===========================================================================
static bool initIMU() {
  if (imu.begin_I2C(I2C_ADDR_PRIMARY, &Wire)) return true;
  Serial.printf("[INFO] Brak IMU pod 0x%02X, fallback 0x%02X...\n",
                I2C_ADDR_PRIMARY, I2C_ADDR_FALLBACK);
  return imu.begin_I2C(I2C_ADDR_FALLBACK, &Wire);
}

// ===========================================================================
// Konfiguracja IMU: ±8g, ±1000dps, ODR=104Hz (najblizsze 100 Hz).
// ===========================================================================
static void configureIMU() {
  imu.setAccelRange(LSM6DS_ACCEL_RANGE_8_G);
  imu.setGyroRange(LSM6DS_GYRO_RANGE_1000_DPS);
  imu.setAccelDataRate(LSM6DS_RATE_104_HZ);
  imu.setGyroDataRate(LSM6DS_RATE_104_HZ);
}

// ===========================================================================
// Inicjalizacja TFLM. Zwraca true tylko gdy AllocateTensors() = ok.
// ===========================================================================
static bool initTFLM() {
  if (g_model_len < 8) {
    Serial.println("[BLAD] model.h zawiera placeholder — uruchom 2_train.py + 3_export_header.py.");
    return false;
  }

  tflModel = tflite::GetModel(g_model);
  if (tflModel->version() != TFLITE_SCHEMA_VERSION) {
    Serial.printf("[BLAD] Wersja schematu TFLite (%lu) rozni sie od TFLM (%d). "
                  "Przegeneruj model w nowszym TF.\n",
                  (unsigned long)tflModel->version(), TFLITE_SCHEMA_VERSION);
    return false;
  }

  // AllOpsResolver — bezpieczny wybor na czas prototypu. Pozniej mozna zamienic
  // na MicroMutableOpResolver i dodawac tylko uzywane operacje (oszczednosc flash).
  static tflite::AllOpsResolver resolver;

  static tflite::MicroInterpreter static_interpreter(
      tflModel, resolver, tensor_arena, kTensorArenaSize);
  interpreter = &static_interpreter;

  TfLiteStatus alloc_status = interpreter->AllocateTensors();
  if (alloc_status != kTfLiteOk) {
    Serial.println("[BLAD] AllocateTensors() failed.");
    Serial.println("       Sprawdz: PSRAM=OPI PSRAM, Huge APP partition,");
    Serial.println("       lub zwieksz kTensorArenaSize (np. 100*1024).");
    return false;
  }

  tflInput  = interpreter->input(0);
  tflOutput = interpreter->output(0);

  if (tflInput->type != kTfLiteInt8 || tflOutput->type != kTfLiteInt8) {
    Serial.println("[BLAD] Model nie jest pelnym INT8. Sprawdz 2_train.py "
                   "(inference_input_type=tf.int8, inference_output_type=tf.int8).");
    return false;
  }

  in_scale       = tflInput->params.scale;
  in_zero_point  = tflInput->params.zero_point;
  out_scale      = tflOutput->params.scale;
  out_zero_point = tflOutput->params.zero_point;

  Serial.printf("[OK] TFLM gotowy. Arena uzyta: %u / %u B\n",
                (unsigned)interpreter->arena_used_bytes(),
                (unsigned)kTensorArenaSize);
  Serial.printf("     in_scale=%.6f, in_zp=%d, out_scale=%.6f, out_zp=%d\n",
                in_scale, in_zero_point, out_scale, out_zero_point);
  return true;
}

// ===========================================================================
// Pobierz jedna probke z IMU jako 6 floatow w jednostkach uzytych do treningu:
//   acc -> g (1g = 9.80665 m/s^2)
//   gyr -> deg/s (1 rad/s = 57.2958 deg/s)
// ===========================================================================
static void readImuSample(float out[N_CHANNELS]) {
  sensors_event_t a, g, t;
  imu.getEvent(&a, &g, &t);
  out[0] = a.acceleration.x / 9.80665f;
  out[1] = a.acceleration.y / 9.80665f;
  out[2] = a.acceleration.z / 9.80665f;
  out[3] = g.gyro.x * 57.2957795f;
  out[4] = g.gyro.y * 57.2957795f;
  out[5] = g.gyro.z * 57.2957795f;
}

// ===========================================================================
// Dodaj jedna probke do bufora okreznego (od razu znormalizowana z-score).
// ===========================================================================
static void pushSample(const float raw[N_CHANNELS]) {
  for (int c = 0; c < N_CHANNELS; ++c) {
    ring[ring_head][c] = (raw[c] - NORM_MEAN[c]) / NORM_STD[c];
  }
  ring_head = (ring_head + 1) % WINDOW_SIZE;
  total_samples++;
  samples_since_last++;
}

// ===========================================================================
// Skopiuj bufor okrezny do tensora wejsciowego, kwantyzujac do INT8.
// Kolejnosc czasu: najstarsza probka najpierw, najnowsza ostatnia.
// ===========================================================================
static void fillInputTensor() {
  int8_t* in_data = tflInput->data.int8;
  int idx = 0;
  for (int t = 0; t < WINDOW_SIZE; ++t) {
    const int src = (ring_head + t) % WINDOW_SIZE;  // najstarsza pozycja
    for (int c = 0; c < N_CHANNELS; ++c) {
      const float v = ring[src][c];
      // q = round(v / scale) + zero_point, ograniczone do [-128, 127].
      int32_t q = (int32_t)lroundf(v / in_scale) + in_zero_point;
      if (q < -128) q = -128;
      if (q >  127) q =  127;
      in_data[idx++] = (int8_t)q;
    }
  }
}

// ===========================================================================
// Odpal model i wypisz wynik. Zwraca klase (0/1/2).
// ===========================================================================
static int runInferenceAndReport() {
  const uint32_t t0 = micros();
  fillInputTensor();
  TfLiteStatus inv = interpreter->Invoke();
  const uint32_t t1 = micros();

  if (inv != kTfLiteOk) {
    Serial.println("[BLAD] interpreter->Invoke() failed");
    return 0;
  }

  // Dekwantyzacja: prob = (q - zero_point) * scale.
  float probs[N_CLASSES];
  int best = 0;
  float best_p = -1.0f;
  for (int i = 0; i < N_CLASSES; ++i) {
    const int8_t q = tflOutput->data.int8[i];
    probs[i] = (q - out_zero_point) * out_scale;
    if (probs[i] > best_p) { best_p = probs[i]; best = i; }
  }

  const char* prefix = (best == 0) ? ".." : "!!";
  const float inf_ms = (t1 - t0) / 1000.0f;
  Serial.printf("%s [%s] p=%.2f  (P[ADL]=%.2f P[PRE]=%.2f P[FALL]=%.2f)  "
                "inf=%.2f ms\n",
                prefix, CLASS_NAMES[best], best_p,
                probs[0], probs[1], probs[2], inf_ms);
  return best;
}

// ===========================================================================
// SETUP
// ===========================================================================
void setup() {
  Serial.begin(115200);
  delay(200);

  Serial.println();
  Serial.println("=== 03_fall_detector — TFLM @ ESP32-S3 + LSM6DSOX ===");

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);

  if (!initIMU()) {
    Serial.println("[BLAD] Nie znaleziono LSM6DSOX. Sprawdz okablowanie / adres I2C.");
    while (true) delay(1000);
  }
  configureIMU();
  Serial.println("[OK] IMU: ±8 g, ±1000 dps, 104 Hz.");

  if (!initTFLM()) {
    Serial.println("[BLAD] TFLM nie wystartowal. Sprawdz model.h / PSRAM / partycje.");
    while (true) delay(1000);
  }

  // Wstepnie wypelniamy bufor okrezny — bez tego pierwsze okno bylo by zerami.
  for (int i = 0; i < WINDOW_SIZE; ++i) {
    float sample[N_CHANNELS];
    readImuSample(sample);
    pushSample(sample);
    delayMicroseconds(SAMPLE_PERIOD_US);
  }
  samples_since_last = 0;
  Serial.println("[OK] Bufor okrezny zapelniony. Inferencja co STRIDE probek.");
}

// ===========================================================================
// LOOP — probkowanie co 10 ms, inferencja co STRIDE probek.
// ===========================================================================
void loop() {
  static uint32_t nextSampleUs = micros();
  const uint32_t now = micros();
  if ((int32_t)(now - nextSampleUs) < 0) {
    // jeszcze nie czas
    return;
  }
  nextSampleUs += SAMPLE_PERIOD_US;
  // Gdy zostalismy "w tyle" (np. po Invoke), nie probujemy gonic naraz.
  if ((int32_t)(micros() - nextSampleUs) > (int32_t)SAMPLE_PERIOD_US) {
    nextSampleUs = micros() + SAMPLE_PERIOD_US;
  }

  float sample[N_CHANNELS];
  readImuSample(sample);
  pushSample(sample);

  if (samples_since_last >= STRIDE) {
    samples_since_last = 0;
    runInferenceAndReport();
  }
}
