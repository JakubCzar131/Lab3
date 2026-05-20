# Architektura systemu wykrywania upadkow — 3 warianty

Dokument porownuje trzy mozliwe architektury wykrywania upadkow na ESP32-S3
z czujnikiem LSM6DSOX. Wszystkie operuja na tym samym sprzecie. Roznica jest
w tym, **gdzie i kiedy chodzi model 1D-CNN**.

Wartosci poboru pradu sa **placeholderami** — do uzupelnienia po pomiarach
multimetrem (najlepiej z rezystorem 1 omowym + oscyloskopem na zasilaniu USB
albo modulem INA219 na linii 3V3).

---

## A) Czysty TFLM 24/7  (firmware/03_fall_detector)

CPU caly czas pracuje na 240 MHz, czujnik probkowany 100 Hz, co STRIDE
probek (~250 ms) odpalamy `Invoke()` na modelu INT8.

```
+--------+    100Hz   +--------+   co 250 ms  +-------+
|LSM6DSOX|----------->| ESP32  |-------------->| TFLM  | -> klasa
+--------+   6-axis   +--------+              +-------+
```

| Aspekt                | Wartosc / komentarz                            |
|-----------------------|------------------------------------------------|
| Gdzie chodzi model    | ESP32 cala dobe                                 |
| Pobor pradu (placeh.) | ~ 50-80 mA (radio off, CPU 240 MHz aktywny)     |
| Latency wykrycia      | <= 250 ms (STRIDE) + ~5-15 ms inferencji        |
| Dokladnosc            | Najwyzsza (model widzi caly sygnal, brak utraty kontekstu) |
| Zalety                | Najprostszy w implementacji; pelne dane do diagnostyki; brak slepych okien |
| Wady                  | Nie nadaje sie do urzadzen bateryjnych; nagrzewa MCU |
| Najlepsze do          | Demo, wersji "wallpowered" (gniazdko), oceny modelu |

---

## B) Czysty free-fall interrupt  (firmware/02_freefall_interrupt)

CPU spi gleboko. Czujnik LSM6DSOX ma WLASNY uklad detekcji free-fall
(rejestr `FREE_FALL`, ~3 uA w trybie low-power). Gdy moduly detekcji w czujniku
wykryja spadek swobodny -> INT1 -> ESP32 budzi sie i np. wysyla alarm.

```
+--------+ free-fall +--------+   INT1     +--------+
|LSM6DSOX|---------->|HW logic|----------->| ESP32  | (wakeup)
+--------+           +--------+            +--------+
```

| Aspekt                | Wartosc / komentarz                            |
|-----------------------|------------------------------------------------|
| Gdzie chodzi model    | NIE MA modelu — wylacznie progowy detektor HW   |
| Pobor pradu (placeh.) | ~ 10-15 uA (deep sleep + LP IMU)                |
| Latency wykrycia      | ~ 30-50 ms (detekcja HW) + czas wybudzenia ESP32 ~ 250 ms |
| Dokladnosc            | Niska — false-positive przy upuszczonym przedmiocie, false-negative przy "miekkim" upadku |
| Zalety                | Ekstremalnie maly pobor pradu; mozna miesiacami chodzic na CR2032 |
| Wady                  | Brak rozroznienia ADL/PRE-FALL; tylko FALL i to z duzym FP rate |
| Najlepsze do          | "ultra niski budzet energii", logger zdarzen, alarm na dziadkow z gniazdkiem do alertu |

---

## C) Hybryda free-fall + TFLM  (firmware/04_hybrid_lowpower) — **REKOMENDOWANA**

ESP32 spi gleboko. LSM6DSOX detektor HW free-fall budzi MCU. Po wybudzeniu
ESP32 zbiera 2 s okna, odpala model 1D-CNN i POTWIERDZA upadek (lub odrzuca
false-positive). Jezeli klasa = FALL, wysyla alarm. Wraca do deep sleep.

```
+--------+ free-fall +--------+ wakeup  +--------+ 2s data +--------+ alert
|LSM6DSOX|---------->| INT1   |-------->| ESP32  |---->| TFLM | -> Alarm/log/SMS
+--------+           +--------+         +--------+     +--------+
                                            ^
                                            +---------- z powrotem do deep sleep
```

| Aspekt                | Wartosc / komentarz                            |
|-----------------------|------------------------------------------------|
| Gdzie chodzi model    | Tylko po wybudzeniu (rzadkie zdarzenia)          |
| Pobor pradu (placeh.) | ~ 15-30 uA usredniony (deep sleep ~ 99% czasu) + krotkie szczyty 50-80 mA na ~ 250 ms |
| Latency wykrycia      | ~ 50 ms (HW FF) + ~ 250 ms (wybudzenie) + 2 s (zbior okna) + 5-15 ms (CNN) ~= ~ 2.3 s |
| Dokladnosc            | Wysoka — HW odrzuca wieksz. ADL, CNN odrzuca FP free-fall |
| Zalety                | Najlepszy kompromis pradu/dokladnosci; bateryjnie dziala dni-tygodnie |
| Wady                  | 2 s latency na alarm; bardziej skomplikowany kod (deep sleep, RTC GPIO) |
| Najlepsze do          | Prototyp produkcyjny, urzadzenie noszone na pasku  |

---

## Tabela porownawcza (kluczowe wartosci)

| Architektura | Model dziala | Pobor (placeholder) | Latency | F1 (FALL) | Bateria 200 mAh |
|--------------|--------------|---------------------|---------|-----------|-----------------|
| A: TFLM 24/7            | non-stop  | ~ 50-80 mA       | < 270 ms  | wysoki      | ~ 3-4 h         |
| B: Free-fall only       | brak      | ~ 10-15 uA       | ~ 280 ms  | niski (false-pos) | ~ tygodnie |
| C: Hybryda              | po IRQ    | ~ 15-30 uA srednio | ~ 2.3 s | wysoki    | ~ tygodnie |

(F1 zostanie zweryfikowane po treningu modelu — patrz `2_train.py` raport.)

---

## Dlaczego hybryda jest rekomendowana

1. **Energia**. CPU spi 99% czasu. Tylko free-fall — bardzo rzadkie zdarzenie —
   uruchamia kosztowna inferencje.
2. **Dokladnosc**. Sama detekcja HW free-fall ma duzo false-positive
   (np. upuszczenie przedmiotu, mocne podskoki). CNN potwierdza, ze profil
   ruchu 2 s odpowiada upadkowi — eliminuje FP.
3. **Modularnosc**. Mozna oddzielnie tunowac:
   - prog FF_THS w czujniku (ile FP "wpuscic"),
   - prog softmax dla klasy FALL po stronie CNN (ile FP odrzucic).

---

## Co zmierzyc do pracy inzynierskiej

- Sredni pobor pradu w kazdej z 3 architektur (multimetr na linii zasilania).
- F1/precision/recall dla klasy FALL na podzbiorze testowym KFall
  (raport z `2_train.py`).
- Latency end-to-end: czas od symulowanego upadku do alertu (oscyloskop +
  GPIO 5 LED jako trigger).
- Liczbe false-positive na 24 h normalnej aktywnosci (test z noszeniem).
