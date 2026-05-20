// Placeholder identyczny jak w 03_fall_detector — bedzie nadpisany przez 2_train.py.
// Skopiuj rowniez normalization.h z 03_fall_detector tutaj po treningu
// (albo zmien sciezke --out_header w 2_train.py).
#pragma once

#define NORM_WINDOW_SIZE   51
#define NORM_N_CHANNELS    6

static const float NORM_MEAN[NORM_N_CHANNELS] = {
  0.0f, 0.0f, 0.0f,
  0.0f, 0.0f, 0.0f
};
static const float NORM_STD[NORM_N_CHANNELS] = {
  1.0f, 1.0f, 1.0f,
  1.0f, 1.0f, 1.0f
};
