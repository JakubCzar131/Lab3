# Fall Detection na ESP32-S3 + LSM6DSOX (ADL / PRE-FALL / FALL)

Repozytorium zawiera kompletny projekt pracy inżynierskiej:

- **pipeline ML w Pythonie** (preprocessing, trening 1D-CNN, kwantyzacja INT8),
- **firmware Arduino dla ESP32-S3** (diagnostyka IMU, funkcje wbudowane LSM6DSOX, free-fall interrupt, detektor TFLM, wariant hybrydowy low-power),
- **dokumentację architektury**.

Klasy wyjściowe systemu:

- `0 = ADL` (normalna aktywność),
- `1 = PRE-FALL` (faza poprzedzająca uderzenie),
- `2 = FALL` (faktyczny upadek).

---

## 1. Wymagania sprzętowe

- ESP32-S3 (np. ESP32S3 Dev Module),
- IMU ST LSM6DSOX (moduł I2C),
- przewody połączeniowe,
- opcjonalnie LED + rezystor do sygnalizacji w `04_hybrid_lowpower`.

### Połączenie (I2C + INT1)

```text
LSM6DSOX VIN   -> ESP32-S3 3V3
LSM6DSOX GND   -> ESP32-S3 GND
LSM6DSOX SDA   -> ESP32-S3 GPIO 8
LSM6DSOX SCL   -> ESP32-S3 GPIO 9
LSM6DSOX INT1  -> ESP32-S3 GPIO 4

(opcjonalnie)
LED anoda      -> ESP32-S3 GPIO 5 (przez rezystor)
LED katoda     -> GND
```

Adres I2C czujnika: domyślnie `0x6A`, fallback `0x6B`, `WHO_AM_I = 0x6C`.

---

## 2. Wymagania programowe

### Python (PC)

- Python **3.10+**
- biblioteki z `requirements.txt`

Instalacja:

```bash
python -m venv .venv
source .venv/bin/activate  # Linux/macOS
pip install -r requirements.txt
```

### Arduino IDE (ESP32-S3)

1. Otwórz `Plik -> Preferencje`.
2. W polu „Dodatkowe adresy URL do menedżera płytek” dodaj:
   - `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
3. W `Narzędzia -> Płytka -> Menedżer płytek` zainstaluj **esp32 by Espressif Systems**.
4. Wybierz płytkę: **ESP32S3 Dev Module**.
5. Ustaw opcje (ważne dla TFLM):
   - **USB CDC On Boot / USB CDC Enabled**: Enabled,
   - **PSRAM**: OPI PSRAM,
   - **Partition Scheme**: Huge APP,
   - **Upload Speed**: wg stabilności 460800/921600.

Wymagane biblioteki Arduino:

- `Adafruit LSM6DS` (i zależności Adafruit BusIO + Unified Sensor),
- biblioteka **TensorFlow Lite for Microcontrollers** kompatybilna z Arduino,
- standardowe `Wire` (wbudowane).

---

## 3. Stałe projektu (spójne w Python i firmware)

- `WINDOW_SIZE = 51` (~500 ms przy 100 Hz)
- `N_CHANNELS = 6` (AccX, AccY, AccZ, GyrX, GyrY, GyrZ)
- `STRIDE = 25` (~50% overlap)
- `POST_IMPACT = 50`
- `ODR = 104 Hz` (LSM6DSOX)
- `ACCEL_RANGE = ±8 g`
- `GYRO_RANGE = ±1000 dps`
- `SAMPLE_RATE = 100 Hz` (co 10 ms)

---

## 4. Dataset KFall

Źródło: <https://sites.google.com/view/kfalldataset>

Wymagana struktura (skrót):

```text
kfall/
  sensor_data/
    SA01/
      SA01T01R01.csv
      ...
  label_data/
    SA01_label.xlsx
    ...
```

W etykietach używane kolumny:

- `Task Code` lub `Task ID`,
- `Trial ID`,
- `Fall_onset_frame`,
- `Fall_impact_frame`.

---

## 5. Kolejność uruchamiania (zalecana)

1. **Diagnostyka IMU**: `firmware/00_test_imu/00_test_imu.ino`
2. **Preprocessing**: `python/1_preprocess.py`
3. **Trening + kwantyzacja**: `python/2_train.py`
4. **Eksport modelu do C headera**: `python/3_export_header.py`
5. **Główny detektor**: `firmware/03_fall_detector/03_fall_detector.ino`
6. (Opcjonalnie) **tryb hybrydowy oszczędzania energii**: `firmware/04_hybrid_lowpower/04_hybrid_lowpower.ino`

---

## 6. Uruchomienie pipeline ML

Zakładamy, że jesteś w katalogu `fall-detection/`.

### 6.1 Preprocessing -> okna `.npz`

```bash
python python/1_preprocess.py \
  --dataset-root /sciezka/do/kfall \
  --output kfall_windows.npz
```

Skrypt:

- wczyta CSV + XLSX,
- utworzy etykiety ADL / PRE-FALL / FALL,
- potnie sygnał na okna 51x6 ze stride 25,
- znormalizuje z-score (per kanał),
- zapisze `X`, `y`, `mean`, `std` do `kfall_windows.npz`.

### 6.2 Trening + INT8 TFLite

```bash
python python/2_train.py \
  --data kfall_windows.npz \
  --output-model model.tflite \
  --normalization-header firmware/03_fall_detector/normalization.h
```

Wariant LOSO (uczciwszy dla pracy inżynierskiej):

```bash
python python/2_train.py \
  --data kfall_windows.npz \
  --loso \
  --loso-subject SA01
```

### 6.3 Eksport modelu do `model.h`

```bash
python python/3_export_header.py \
  --input model.tflite \
  --output firmware/03_fall_detector/model.h
```

---

## 7. Firmware – co wgrywać i po co

- `00_test_imu` – sprawdzenie okablowania i odczytu 6 osi.
- `01_builtin_features` – test funkcji wbudowanych LSM6DSOX (kroki, tap, 6D, wake-up) przez rejestry.
- `02_freefall_interrupt` – sprzętowe przerwanie free-fall na INT1.
- `03_fall_detector` – główny detektor online (TFLM, okno 51 próbek, inferencja co 25 próbek).
- `04_hybrid_lowpower` – deep sleep + wybudzenie free-fall + klasyfikacja 2-sekundowego bufora.

---

## 8. Kryteria akceptacji i szybka weryfikacja

1. `1_preprocess.py` tworzy `kfall_windows.npz` bez błędów.
2. `2_train.py` raportuje F1 dla klasy FALL > 0.85.
3. `model.tflite` jest INT8 (wejście/wyjście) i ma rozmiar < 100 KB.
4. Szkice kompilują się dla ESP32S3 Dev Module.
5. `03_fall_detector` raportuje inferencję < 20 ms.

---

## 9. Najczęstsze problemy

| Problem | Objaw | Przyczyna | Rozwiązanie |
|---|---|---|---|
| `AllocateTensors failed` | Start TFLM kończy się błędem | Za mała arena lub zła biblioteka TFLM | Zwiększ `kTensorArenaSize`, sprawdź bibliotekę TFLM i ustawienia partition/PSRAM |
| Brak TFLM w Arduino | Błędy `tensorflow/lite/...` | Biblioteka nie zainstalowana lub konflikt wersji | Zainstaluj kompatybilną bibliotekę TFLM, usuń duplikaty z katalogu bibliotek |
| Milczący Serial | Brak logów mimo uruchomienia | Zły baudrate / USB CDC disabled | Ustaw 115200 i włącz USB CDC w opcjach płytki |
| Model zawsze daje ADL | `argmax=0` prawie zawsze | Niezbalansowane klasy / brak wag klas / zła normalizacja | Sprawdź `compute_class_weight`, etykietowanie PRE-FALL/FALL i identyczną normalizację w firmware |
| Brak IMU na I2C | `Nie wykryto LSM6DSOX` | Zły adres, przewody, zasilanie | Sprawdź 0x6A/0x6B, połączenia SDA/SCL, VIN=3V3, GND |

---

## 10. Struktura repozytorium

```text
fall-detection/
├── README.md
├── requirements.txt
├── python/
│   ├── 1_preprocess.py
│   ├── 2_train.py
│   ├── 3_export_header.py
│   └── utils.py
├── firmware/
│   ├── 00_test_imu/
│   ├── 01_builtin_features/
│   ├── 02_freefall_interrupt/
│   ├── 03_fall_detector/
│   └── 04_hybrid_lowpower/
└── docs/
    └── architektura.md
```

---

## 11. Uwaga inżynierska

Wyniki zależą od jakości etykiet, podziału danych i zgodności jednostek (szczególnie acc/gyro) między treningiem a firmware.  
Przed obroną pracy wykonaj końcową walidację na danych osoby niewidzianej w treningu (LOSO) oraz testy terenowe na docelowym mocowaniu IMU (dolna część pleców).
