// Placeholder — ten plik zostanie nadpisany przez python/2_train.py.
// Trzymamy go w repo zeby szkic kompilowal sie nawet zanim wytrenujesz model.
// Dla treningu/testu warto zostawic mean=0, std=1.
#pragma once

#define NORM_WINDOW_SIZE   51
#define NORM_N_CHANNELS    6

static const float NORM_MEAN[NORM_N_CHANNELS] = {
  0.0f, 0.0f, 0.0f,    // AccX, AccY, AccZ
  0.0f, 0.0f, 0.0f     // GyrX, GyrY, GyrZ
};
static const float NORM_STD[NORM_N_CHANNELS] = {
  1.0f, 1.0f, 1.0f,
  1.0f, 1.0f, 1.0f
};
