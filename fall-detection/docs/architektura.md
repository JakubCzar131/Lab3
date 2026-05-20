# Architektura systemu wykrywania upadków (ESP32-S3 + LSM6DSOX)

Dokument porównuje trzy warianty architektury dla klasyfikacji:

- `0 = ADL`
- `1 = PRE-FALL`
- `2 = FALL`

## Założenia wspólne

- IMU: LSM6DSOX, ODR = 104 Hz (najbliżej 100 Hz),
- 6 osi wejściowych: AccX, AccY, AccZ, GyrX, GyrY, GyrZ,
- model: 1D-CNN kwantyzowany do TFLite INT8,
- platforma: ESP32-S3 (Arduino + TFLM).

---

## A) Architektura czysta TFLM (24/7)

### Opis

Mikrokontroler stale próbuje dane z IMU, normalizuje i uruchamia model co `STRIDE` próbek.

### Cechy

- najwyższa dostępność detekcji (ciągła inferencja),
- pełna klasyfikacja 3-klasowa bez warunku wstępnego,
- łatwa analiza jakości modelu (każde okno ma predykcję).

### Ryzyka

- największy pobór energii (CPU + IMU aktywne non-stop),
- wymaga stabilnej konfiguracji pamięci (arena TFLM).

---

## B) Architektura czysta free-fall interrupt (bez ML)

### Opis

Detekcja oparta tylko o wbudowaną logikę LSM6DSOX i przerwanie `INT1` dla free-fall.

### Cechy

- bardzo niski pobór energii po stronie MCU (możliwy deep sleep),
- implementacja prosta i szybka do uruchomienia.

### Ryzyka

- mniejsza semantyka zdarzenia (zwykle binarna informacja „free-fall detected”),
- duża czułość na strojenie progów; możliwe false positive/false negative,
- brak jawnego rozróżniania ADL / PRE-FALL / FALL przez model.

---

## C) Architektura hybrydowa (free-fall wybudza, CNN klasyfikuje)

### Opis

Czujnik monitoruje free-fall autonomicznie i budzi ESP32-S3 z deep sleep.
Po wybudzeniu MCU zbiera krótki bufor danych i uruchamia TFLM.

### Cechy

- kompromis między poborem energii i dokładnością klasyfikacji,
- pełna 3-klasowa decyzja po zdarzeniu triggerującym,
- dobra ścieżka produkcyjna dla urządzeń bateryjnych.

### Ryzyka

- większa złożoność firmware (przerwania + sleep + TFLM),
- trzeba pilnować opóźnienia od wybudzenia do decyzji.

---

## Tabela porównawcza

> **Uwaga:** pobory prądu to **placeholder** i muszą być potwierdzone pomiarem multimetrem
> dla konkretnej płytki, zasilania, częstotliwości CPU i konfiguracji peryferiów.

| Architektura | Gdzie chodzi model | Szacowany pobór prądu | Latency decyzji | Dokładność | Zalety | Wady |
|---|---|---|---|---|---|---|
| A) Czysty TFLM 24/7 | Ciągle na ESP32-S3 | Wysoki (MCU aktywne stale) | Niska dla online (co ~250 ms) | Najwyższa potencjalnie (pełny kontekst) | Najpełniejsza klasyfikacja 3-klasowa, brak zależności od triggera | Zużycie energii, wymagania pamięciowe |
| B) Czysty free-fall interrupt | Brak modelu (logika czujnika) | Niski / bardzo niski | Bardzo niska dla triggera | Niższa semantycznie (niepełna 3-klasowość) | Bardzo prosty i energooszczędny | Ograniczona informacja, strojenie progów |
| C) Hybryda (free-fall + TFLM) | Na ESP32-S3 tylko po wybudzeniu | Średni / niski średni | Średnia (wybudzenie + bufor + inferencja) | Wysoka przy dobrym modelu i triggerze | Dobry kompromis energia/jakość, 3 klasy po triggerze | Złożoność implementacji i testów |

---

## Rekomendacja do pracy inżynierskiej

1. Pokazać wszystkie 3 warianty (A/B/C) jako porównanie inżynierskie.
2. Do części „system docelowy” wybrać **C (hybryda)**.
3. Dla jakości ML raportować:
   - metryki na hold-out i LOSO,
   - confusion matrix,
   - szczególnie **F1 dla klasy FALL**.
4. Dla energooszczędności raportować realne pomiary prądu (multimetr / analizator mocy).
