# System wykrywania upadkow ESP32-S3 + LSM6DSOX

Projekt zawiera kompletny, edukacyjny pipeline do wykrywania trzech stanow
ruchu czlowieka:

- `0 = ADL` - zwykla aktywnosc dnia codziennego,
- `1 = PRE-FALL` - faza przed uderzeniem,
- `2 = FALL` - faktyczny upadek.

System sklada sie z dwoch czesci:

1. **Pipeline ML w Pythonie** - przygotowanie okien z datasetu KFall, trening
   malego modelu 1D-CNN, kwantyzacja INT8 i eksport do naglowka C.
2. **Firmware Arduino dla ESP32-S3** - test IMU, funkcje wbudowane LSM6DSOX,
   przerwanie free-fall, inferencja TFLite Micro i wariant hybrydowy low-power.

Kod jest napisany tak, aby byl czytelny podczas obrony pracy inzynierskiej:
stale projektu sa jawne, pliki sa modularne, a komentarze wyjasniaja decyzje
techniczne.

## 1. Sprzet

### Wymagane elementy

- ESP32-S3 Dev Module,
- modul IMU STMicroelectronics LSM6DSOX,
- przewody polaczeniowe,
- kabel USB z transmisja danych.

### Polaczenia

Adres I2C czujnika to zwykle `0x6A`; firmware probuje tez fallback `0x6B`.

```text
              ESP32-S3                         LSM6DSOX
          +--------------+                  +-------------+
  3V3  ---| 3V3          |------------------| VIN         |
  GND  ---| GND          |------------------| GND         |
 GPIO8 ---| SDA          |------------------| SDA         |
 GPIO9 ---| SCL          |------------------| SCL         |
 GPIO4 ---| INT1         |------------------| INT1        |
          +--------------+                  +-------------+
```

> Uwaga: nie zasilaj modulu z 5 V, jezeli dana plytka LSM6DSOX nie ma
> stabilizatora i konwerterow poziomow. Bezpiecznym wyborem jest 3V3.

## 2. Konfiguracja Arduino IDE

1. Zainstaluj Arduino IDE.
2. Wejdz w **File -> Preferences** i dodaj URL menedzera plytek ESP32:

   ```text
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```

3. W **Boards Manager** zainstaluj pakiet `esp32` firmy Espressif.
4. Wybierz plytke i opcje:

   | Opcja | Wartosc |
   | --- | --- |
   | Board | ESP32S3 Dev Module |
   | USB CDC On Boot | Enabled |
   | Partition Scheme | Huge APP |
   | PSRAM | OPI PSRAM |
   | Upload Speed | 921600 lub 460800 |
   | Serial Monitor | 115200 baud |

5. Zainstaluj biblioteki Arduino:
   - `Adafruit LSM6DS`,
   - `Adafruit BusIO`,
   - `Adafruit Unified Sensor`,
   - `TensorFlowLite_ESP32` albo inna kompatybilna dystrybucja TFLite Micro.

## 3. Przygotowanie srodowiska Python

Z katalogu `fall-detection/`:

```bash
python3.10 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

## 4. Pobranie datasetu KFall

Pobierz KFall ze strony:

```text
https://sites.google.com/view/kfalldataset
```

Po rozpakowaniu struktura powinna wygladac tak:

```text
kfall/
├── sensor_data/
│   ├── SA01/
│   │   ├── SA01T01R01.csv
│   │   └── ...
│   └── ...
└── label_data/
    ├── SA01_label.xlsx
    └── ...
```

W plikach CSV skrypty szukaja szesciu osi:
`AccX, AccY, AccZ, GyrX, GyrY, GyrZ`. Obslugiwane sa tez czeste warianty
nazw z datasetu, np. `AccX(g)` albo `GyrX(deg/s)`.

## 5. Kolejnosc uruchamiania

### Krok 1: test okablowania

Wgraj szkic:

```text
firmware/00_test_imu/00_test_imu.ino
```

Na Serial Monitor powinny pojawiac sie surowe odczyty 6 osi co 100 ms.
Jezeli nie widzisz danych, sprawdz SDA/SCL, zasilanie, predkosc 115200 baud i
adres I2C.

### Krok 2: preprocessing KFall

```bash
cd fall-detection
python python/1_preprocess.py --kfall-root /sciezka/do/kfall --output kfall_windows.npz
```

Skrypt:

- czyta wszystkie `sensor_data/SA*/SAxxTyyRzz.csv`,
- dla prob upadkow korzysta z `label_data/SAxx_label.xlsx`,
- oznacza `PRE-FALL` od `Fall_onset_frame` do `Fall_impact_frame`,
- oznacza `FALL` od impact przez `POST_IMPACT = 50` probek,
- tnie sygnal na okna `51 x 6` ze skokiem `25`,
- zapisuje `X`, `y`, `mean`, `std`, `subjects` do pliku `.npz`.

### Krok 3: trening i kwantyzacja INT8

Losowy split stratified 80/20:

```bash
python python/2_train.py --input kfall_windows.npz --out-dir build
```

Uczciwsza walidacja leave-one-subject-out:

```bash
python python/2_train.py --input kfall_windows.npz --out-dir build --loso SA01
```

Wynikiem sa:

- `build/model.keras`,
- `build/model.tflite`,
- `build/normalization.h`,
- kopia `normalization.h` w `firmware/03_fall_detector/` i
  `firmware/04_hybrid_lowpower/`.

W raporcie zwroc szczegolna uwage na `F1 dla klasy FALL`. Wymaganiem projektu
jest wynik powyzej `0.85` na sensownym podziale danych.

### Krok 4: eksport modelu do C

```bash
python python/3_export_header.py --input build/model.tflite
```

Skrypt tworzy:

```text
firmware/03_fall_detector/model.h
firmware/04_hybrid_lowpower/model.h
```

### Krok 5: inferencja na ESP32-S3

Wgraj szkic:

```text
firmware/03_fall_detector/03_fall_detector.ino
```

Program probkuje IMU co 10 ms, utrzymuje bufor `51 x 6`, uruchamia model co
`STRIDE = 25` probek i wypisuje:

```text
.. ADL conf=0.97 inferencja=8 ms
!! PRE-FALL conf=0.88 inferencja=9 ms
!! FALL conf=0.93 inferencja=9 ms
```

## 6. Szkice firmware

| Katalog | Cel |
| --- | --- |
| `00_test_imu` | Diagnostyka okablowania i zakresow IMU przez biblioteke Adafruit |
| `01_builtin_features` | Pedometer, tap, 6D i wake-up przez surowe rejestry I2C |
| `02_freefall_interrupt` | Autonomiczna detekcja free-fall na pinie INT1 |
| `03_fall_detector` | Glowny detektor CNN/TFLM w czasie rzeczywistym |
| `04_hybrid_lowpower` | Free-fall budzi ESP32-S3 z deep sleep, potem dziala CNN |

## 7. Najczestsze problemy

| Problem | Objaw | Rozwiazanie |
| --- | --- | --- |
| Brak TFLite Micro | Blad kompilacji `tensorflow/lite/micro/...` | Zainstaluj biblioteke TFLM dla Arduino/ESP32 lub skopiuj kompatybilna dystrybucje do folderu bibliotek Arduino. |
| `AllocateTensors failed` | Firmware zatrzymuje sie po starcie | Wlacz PSRAM OPI, wybierz `Huge APP`, zwieksz `kTensorArenaSize` lub zmniejsz model. |
| Milczacy Serial Monitor | Brak logow po resecie | Ustaw 115200 baud, wlacz `USB CDC On Boot`, wybierz poprawny port i nacisnij reset. |
| Zly adres I2C | `Nie znaleziono LSM6DSOX` | Sprawdz lutowanie pinu SA0/SDO; kod probuje `0x6A` i `0x6B`. |
| Model zawsze zwraca ADL | Bardzo wysoka dokladnosc, niskie F1 FALL | Sprawdz rozklad klas, wagi klas, etykiety onset/impact i czy trening uzywa `compute_class_weight`. |
| Slabe wyniki LOSO | Dobry random split, slaby test na nowej osobie | To typowe dla IMU noszonego przez ludzi. Dodaj wiecej osob w treningu i raportuj LOSO jako uczciwsza metryke. |
| Dane wygladaja losowo | Odczyty zmieniaja osie lub jednostki | Upewnij sie, ze firmware i preprocessing uzywaja kolejnosci `AccX, AccY, AccZ, GyrX, GyrY, GyrZ`. |

## 8. Stale projektu

| Stala | Wartosc |
| --- | --- |
| `WINDOW_SIZE` | 51 probek |
| `N_CHANNELS` | 6 |
| `STRIDE` | 25 probek |
| `POST_IMPACT` | 50 probek |
| ODR IMU | 104 Hz |
| Sampling firmware | 100 Hz, co 10 ms |
| Akcelerometr | +/- 8 g |
| Zyroskop | +/- 1000 dps |

## 9. Jak testowac kazdy duzy etap

1. **README + struktura** - sprawdz, czy istnieja katalogi `python/`,
   `firmware/` i `docs/`.
2. **Preprocessing** - uruchom `1_preprocess.py` na pelnym KFall i potwierdz
   rozklad klas w terminalu.
3. **Trening** - uruchom `2_train.py`; sprawdz rozmiar `model.tflite` i typy
   INT8 wypisane po konwersji.
4. **Eksport** - uruchom `3_export_header.py`; sprawdz, czy `model.h` zawiera
   `alignas(8) const unsigned char g_model[]`.
5. **Firmware** - kompiluj szkice po kolei od `00` do `04`; gdy `00` dziala,
   reszta ma sens diagnostyczny i projektowy.

