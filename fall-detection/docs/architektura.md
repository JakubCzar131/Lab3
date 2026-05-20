# Architektura systemu wykrywania upadkow

System mozna uruchomic w trzech wariantach. Kazdy wariant uzywa tego samego
czujnika LSM6DSOX i tych samych klas decyzyjnych:

- `0 = ADL`,
- `1 = PRE-FALL`,
- `2 = FALL`.

Roznice dotycza tego, gdzie wykonywana jest decyzja, jaki jest pobor pradu i
ile informacji z sygnalu IMU wykorzystuje algorytm.

## A. Czysty TFLite Micro 24/7

Wariant zaimplementowany w `firmware/03_fall_detector`.

ESP32-S3 dziala caly czas, probkuje IMU co 10 ms, utrzymuje bufor okrezny
`51 x 6`, a co `STRIDE = 25` probek uruchamia model 1D-CNN. To wariant
najlatwiejszy do zrozumienia i najlepszy do walidacji modelu ML, bo klasyfikacja
jest wykonywana regularnie w czasie rzeczywistym.

Zalety:

- pelna klasyfikacja `ADL / PRE-FALL / FALL`,
- mozliwosc wykrycia fazy `PRE-FALL`,
- proste logowanie czasu inferencji i pewnosci modelu,
- najlepszy wariant do eksperymentow z modelem.

Wady:

- najwyzszy pobor pradu, bo MCU i IMU dzialaja stale,
- wymaga poprawnie skwantyzowanego modelu TFLite INT8,
- ewentualne problemy z TFLM widac dopiero po starcie firmware.

## B. Czysty free-fall interrupt

Wariant pokazany w `firmware/02_freefall_interrupt`.

LSM6DSOX ma wbudowany blok detekcji free-fall. Czujnik moze sam porownywac
przyspieszenie z progiem i wystawiac sygnal na INT1. ESP32-S3 nie musi wykonywac
modelu ML. To wariant bardzo prosty energetycznie, ale semantycznie rozpoznaje
tylko zjawisko zblizone do niewazkosci, a nie pelny upadek czlowieka.

Zalety:

- bardzo mala zlozonosc,
- niski pobor pradu,
- szybka reakcja sprzetowa,
- dziala nawet bez TensorFlow Lite Micro.

Wady:

- brak klas `ADL / PRE-FALL / FALL`,
- duze ryzyko falszywych alarmow przy potrzasaniu lub rzuceniu urzadzenia,
- nie rozpoznaje upadkow bez wyraznej fazy free-fall,
- progi trzeba stroic eksperymentalnie dla obudowy i sposobu noszenia.

## C. Hybryda free-fall + CNN

Wariant zaimplementowany w `firmware/04_hybrid_lowpower`.

LSM6DSOX pracuje jako czujnik czuwajacy. Free-fall na INT1 wybudza ESP32-S3 z
deep sleep. Po wybudzeniu MCU zbiera 2 s danych z IMU, uruchamia model CNN i
dopiero wtedy podejmuje decyzje oraz wysyla alert.

Zalety:

- znacznie nizszy pobor pradu niz TFLM 24/7,
- mniejsza liczba falszywych alarmow niz przy samym free-fall,
- nadal mozna uzyc klasyfikatora ML,
- dobra architektura docelowa dla urzadzenia bateryjnego.

Wady:

- model startuje dopiero po zdarzeniu free-fall,
- mozna przegapic upadki bez poprawnego wyzwolenia INT1,
- wieksza zlozonosc testowania: deep sleep, wake-up, model i alert,
- wymaga pomiaru realnego czasu startu i poboru pradu.

## Tabela porownawcza

Wartosci poboru pradu sa placeholderami. Nalezy je zmierzyc multimetrem albo
analizatorem energii na gotowym prototypie, bo zaleza od plytki ESP32-S3,
modulu LSM6DSOX, PSRAM, LED, regulatora napiecia i sposobu zasilania.

| Architektura | Gdzie chodzi model | Szacowany pobor pradu | Latency | Dokladnosc | Zalety | Wady |
| --- | --- | --- | --- | --- | --- | --- |
| A. TFLM 24/7 | Na ESP32-S3, co 25 probek | Do zmierzenia; najwyzszy z trzech wariantow | Ok. 250 ms plus czas inferencji `<20 ms` | Najwyzsza, bo model widzi kazde okno | Pelne klasy ADL/PRE-FALL/FALL, dobra diagnostyka | Staly pobor pradu, wymaga TFLM przez caly czas |
| B. Free-fall interrupt | Brak modelu; decyzja w LSM6DSOX | Do zmierzenia; najnizszy | Sprzetowe przerwanie, zwykle bardzo szybko | Niska dla pelnego problemu upadku | Prosty, energooszczedny, niezalezny od ML | Brak PRE-FALL/FALL jako klas ML, falszywe alarmy |
| C. Hybryda | Na ESP32-S3 dopiero po wake-up | Do zmierzenia; pomiedzy A i B, blizej B w czuwaniu | Free-fall + wake-up + 2 s akwizycji + inferencja | Srednia/wysoka, zalezy od skutecznosci wyzwolenia INT1 | Dobry kompromis bateria/jakosc | Moze przegapic zdarzenia bez free-fall, trudniejsze testy |

## Rekomendacja do pracy inzynierskiej

Do obrony najlepiej pokazac wszystkie trzy warianty:

1. `00_test_imu` potwierdza poprawnosc okablowania.
2. `01_builtin_features` pokazuje, ze LSM6DSOX ma funkcje embedded.
3. `02_freefall_interrupt` pokazuje autonomiczne przerwanie.
4. `03_fall_detector` jest glownym dowodem dzialania modelu ML.
5. `04_hybrid_lowpower` pokazuje kierunek praktycznej implementacji bateryjnej.

Najwazniejszy wynik ML nalezy raportowac dla klasy `FALL`, szczegolnie F1-score.
Dodatkowo warto pokazac walidacje LOSO, bo testuje generalizacje na osobie,
ktorej model nie widzial w treningu.

