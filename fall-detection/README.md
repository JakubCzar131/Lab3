# System wykrywania upadkow — ESP32-S3 + LSM6DSOX + TFLite Micro

Praca inzynierska: lekka siec 1D-CNN klasyfikujaca w czasie rzeczywistym
trzy klasy stanu osoby noszacej czujnik IMU na dolnej czesci plecow:

| Klasa | Nazwa     | Znaczenie                                          |
|-------|-----------|----------------------------------------------------|
| 0     | ADL       | Activities of Daily Living — codzienna aktywnosc   |
| 1     | PRE-FALL  | Faza poprzedzajaca uderzenie (od onset do impact)  |
| 2     | FALL      | Wlasciwy upadek + chwila po uderzeniu              |

Pipeline:

1. Pobranie zbioru **KFall** (100 Hz, dolne plecy).
2. `python/1_preprocess.py` — okna 51 probek x 6 osi, z-score, `kfall_windows.npz`.
3. `python/2_train.py` — trening 1D-CNN, kwantyzacja INT8, eksport `model.tflite`
   oraz `normalization.h` (mean/std).
4. `python/3_export_header.py` — konwersja `model.tflite` -> `model.h`
   (tablica C dla TFLM).
5. Wgranie szkicow `firmware/00…04` na **ESP32-S3 Dev Module**.

---

## 1. Sprzet i okablowanie

Plytka: **ESP32-S3 Dev Module** (np. ESP32-S3-DevKitC-1).
Czujnik: **Adafruit LSM6DSOX** (lub modul kompatybilny, adres I2C 0x6A).

Diagram polaczen (ASCII):

```
            ESP32-S3                  LSM6DSOX
        +------------+              +------------+
   3V3  | 3V3        |------------->| VIN        |
   GND  | GND        |------------->| GND        |
   I2C  | GPIO 8 SDA |<------------>| SDA        |
        | GPIO 9 SCL |------------->| SCL        |
   IRQ  | GPIO 4     |<-------------| INT1       |
        | GPIO 5     |---[R220]-->|>LED (opcj.) |
        +------------+              +------------+
```

- Adres I2C: 0x6A (pin SA0 = GND) lub 0x6B (SA0 = VCC).
- WHO_AM_I (0x0F) powinno zwrocic 0x6C.
- LED alarmowy na GPIO 5 jest opcjonalny — przyda sie w szkicach 02 i 04.

---

## 2. Setup srodowiska Pythona

```bash
cd fall-detection
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/Mac: source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

Sprawdzenie:

```bash
python -c "import tensorflow as tf; print(tf.__version__)"
```

---

## 3. Setup Arduino IDE 2.x dla ESP32-S3

1. **File -> Preferences -> Additional Board Manager URLs**:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
2. **Tools -> Board -> Boards Manager** -> wyszukaj `esp32` (by Espressif Systems)
   i zainstaluj wersje 2.0.14 lub nowsza.
3. **Tools -> Board** -> `ESP32S3 Dev Module`.
4. Ustawienia plytki (kluczowe — bez tego TFLM nie zmiesci sie/nie wystartuje):
   - **USB CDC On Boot**: `Enabled` (zeby `Serial` dzialal po USB)
   - **CPU Frequency**: `240 MHz`
   - **Flash Size**: `8MB` (lub zgodnie z plytka)
   - **Partition Scheme**: `Huge APP (3MB No OTA/1MB SPIFFS)`
   - **PSRAM**: `OPI PSRAM`
   - **Upload Mode**: `UART0 / Hardware CDC`
   - **Upload Speed**: 921600
5. Wybierz wlasciwy port COM/ttyUSB/ttyACM (urzadzenie pojawi sie po
   wcisnieciu BOOT + RESET, gdy plytka jest w trybie programowania).

### Wymagane biblioteki Arduino

W **Library Manager** zainstaluj:

| Biblioteka                       | Uzycie               | Wymagana w szkicu |
|----------------------------------|----------------------|-------------------|
| `Adafruit LSM6DS`                | Tryb wysokopoziomowy | 00, 03, 04        |
| `Adafruit BusIO`                 | Zaleznosc Adafruit   | 00, 03, 04        |
| `Adafruit Unified Sensor`        | Zaleznosc Adafruit   | 00, 03, 04        |
| `TensorFlowLite_ESP32` lub<br>`Chirale_TensorFlowLite` (fork TFLM) | Inferencja sieci na MCU | 03, 04 |

Dla TFLM polecam fork **Chirale_TensorFlowLite** (utrzymywany, dziala out-of-the-box
na ESP32-S3, kompatybilny API z `tflite::Micro*`).

---

## 4. Pobranie zbioru KFall

1. Zarejestruj sie i pobierz z: <https://sites.google.com/view/kfalldataset>.
2. Rozpakuj tak, zeby uzyskac dwa katalogi:

```
fall-detection/kfall/sensor_data/SA06/SA06T01R01.csv  ...
fall-detection/kfall/label_data/SA06_label.xlsx     ...
```

Sciezke mozna zmienic flaga `--data` w `1_preprocess.py`.

---

## 5. Kolejnosc uruchamiania

```
[1] firmware/00_test_imu        -> sprawdz wiring, IMU, Serial.
[2] python/1_preprocess.py      -> wygeneruj kfall_windows.npz.
[3] python/2_train.py           -> wytrenuj model -> model.tflite + normalization.h.
[4] python/3_export_header.py   -> wygeneruj model.h (tablica C).
[5] firmware/03_fall_detector   -> wgraj i sprawdz inferencje on-device.
```

Szkice 01, 02, 04 sa opcjonalne i pokazuja funkcje wbudowane czujnika
(kroki, tap, 6D, free-fall) oraz hybryde TFLM + deep sleep.

Komendy:

```bash
cd python
python 1_preprocess.py --data ../kfall --out ../kfall_windows.npz
python 2_train.py --in ../kfall_windows.npz --out_model ../model.tflite \
                  --out_header ../firmware/03_fall_detector/normalization.h
python 3_export_header.py --in ../model.tflite \
                  --out ../firmware/03_fall_detector/model.h
```

Po treningu skopiuj `normalization.h` rowniez do `firmware/04_hybrid_lowpower/`.

---

## 6. Najczestsze problemy

| Objaw                                      | Najprawdopodobniejsza przyczyna                                                   | Rozwiazanie                                                                                          |
|--------------------------------------------|------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| `Serial` milczy po wgraniu                 | `USB CDC On Boot` = Disabled                                                       | Wlacz `USB CDC On Boot = Enabled` i przesnij plytke (BOOT+RESET).                                   |
| `Failed to find LSM6DSOX chip`             | Zly adres I2C / odwrocone SDA-SCL / brak zasilania                                 | Sprawdz fallback adresu 0x6B, zmierz 3V3, sprawdz `WHO_AM_I` w szkicu 00.                            |
| `AllocateTensors() failed`                 | Za maly tensor arena albo brak `OPI PSRAM`                                         | Zwieksz `kTensorArenaSize` (np. 100*1024), wlacz `PSRAM = OPI PSRAM`, `Huge APP` partition.         |
| Linker error o `tflite::...`               | Brak biblioteki TFLM                                                               | Zainstaluj `Chirale_TensorFlowLite` (Library Manager).                                              |
| Model zawsze zwraca ADL                    | Brak `class_weight` w treningu albo zla normalizacja w firmware                    | Upewnij sie, ze `compute_class_weight` zostalo zastosowane i `NORM_MEAN/NORM_STD` w firmware == te z treningu. |
| FALL F1 < 0.85                             | Za malo danych po impact / etykietowanie tylko na onset                            | Zwieksz `POST_IMPACT`, sprawdz strategy oversamplingu, uruchom z `--loso`.                          |
| `model.tflite` jest float, nie INT8        | Nie zwrocony `representative_dataset` lub brak `tf.int8` w `inference_*_type`      | Zobacz `2_train.py` — wszystkie 3 wiersze: `representative_dataset`, `inference_input_type`, `inference_output_type`. |

---

## 7. Struktura repozytorium

```
fall-detection/
├── README.md                  <- ten plik
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
│   ├── 03_fall_detector/      <- glowny komponent (TFLM 24/7)
│   └── 04_hybrid_lowpower/    <- free-fall budzi MCU -> CNN
└── docs/
    └── architektura.md        <- porownanie 3 architektur
```

---

## 8. Stale projektu (uzywane wszedzie spojnie)

| Stala         | Wartosc | Znaczenie                                                |
|---------------|---------|----------------------------------------------------------|
| `WINDOW_SIZE` | 51      | ~500 ms przy 100 Hz                                      |
| `N_CHANNELS`  | 6       | AccX/Y/Z + GyrX/Y/Z                                      |
| `STRIDE`      | 25      | ~50% overlap na treningu, co 250 ms inferencja w firmware|
| `POST_IMPACT` | 50      | Ile probek po impact zalicza sie do FALL                 |
| `ODR`         | 104 Hz  | Najblizsze 100 Hz dla LSM6DSOX                           |
| `ACCEL_RANGE` | +/- 8 g | Zakres akcelerometru                                     |
| `GYRO_RANGE`  | +/- 1000 dps | Zakres zyroskopu                                     |

Wiecej w `docs/architektura.md`.

---

## 9. Jak zweryfikowac (kryteria akceptacji)

| Kryterium                                              | Jak sprawdzic                                                                  |
|--------------------------------------------------------|--------------------------------------------------------------------------------|
| `1_preprocess.py` generuje `.npz` bez bledow           | Uruchom `python 1_preprocess.py --data ../kfall`, oczekuj `[OK] Zapisano: ...kfall_windows.npz` |
| F1 dla FALL > 0.85                                     | Po `python 2_train.py` zobacz linie `[KLUCZOWA METRYKA] F1 dla klasy FALL = ...` |
| `model.tflite` < 100 KB                                | Komunikat `[OK] Zapisano model TFLite INT8: ... (N B)`, N < 102400.            |
| Wejscie/wyjscie INT8                                   | `[OK] TFLM gotowy. ... in_scale=..., out_scale=...` na ESP32 (niefloat).       |
| Szkice kompiluja sie na ESP32S3 Dev Module             | Otworz `.ino` w Arduino IDE, ustaw plytke, **Verify** dla kazdego z 00..04.    |
| 03_fall_detector raportuje inferencje < 20 ms          | Sledz `inf=X.XX ms` w Serial Monitor.                                          |

---

## 10. Sciagawka komend (cala sciezka treningu)

```bash
cd fall-detection
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 1) preprocessing -> okna
python python/1_preprocess.py \
    --data ./kfall \
    --out  ./kfall_windows.npz

# 2) trening (random split). Dodaj --loso aby walidacja byla LOSO.
python python/2_train.py \
    --in  ./kfall_windows.npz \
    --out_model  ./model.tflite \
    --out_header ./firmware/03_fall_detector/normalization.h

# 3) tflite -> tablica C
python python/3_export_header.py \
    --in  ./model.tflite \
    --out ./firmware/03_fall_detector/model.h

# 4) (opcjonalnie) hybryda — skopiuj te same naglowki:
cp firmware/03_fall_detector/model.h         firmware/04_hybrid_lowpower/
cp firmware/03_fall_detector/normalization.h firmware/04_hybrid_lowpower/
```

