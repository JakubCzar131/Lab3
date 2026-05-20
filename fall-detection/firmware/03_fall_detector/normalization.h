#pragma once

// Placeholder. Ten plik nadpisuje python/2_train.py.
// Kolejnosc kanalow: AccX, AccY, AccZ, GyrX, GyrY, GyrZ.

constexpr int NORM_CHANNELS = 6;
const float NORM_MEAN[NORM_CHANNELS] = {0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f};
const float NORM_STD[NORM_CHANNELS] = {1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f};
