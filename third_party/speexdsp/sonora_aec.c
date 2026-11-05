/* Sonora Live: the SpeexDSP MDF echo canceller (linear, full band) for an AudioWorklet.
 *
 * One state for C microphone channels against one reference (what the speakers play), frames of `frame` samples.
 * Samples are floats in -1..1 at the API (scaled to Speex's ±32767 inside).
 *
 * Linear only: the filter subtracts its estimate of the echo and never touches the rest, so the piano played here
 * keeps every note, however loud the others are. No residual echo suppressor: that is what ducks the near-end
 * piano in speech-oriented echo cancelling (measured on piano, Speex's own removed only 1.5 dB more echo while
 * altering the near end, and delayed it by a frame: tools/aec-eval.mjs).
 */
#include "config.h"
#include "speex/speex_echo.h"
#include <string.h>

#define ARENA_BYTES (8 << 20)
static unsigned char arena[ARENA_BYTES] __attribute__((aligned(16)));
static unsigned long used = 0;

void *sonora_calloc(unsigned long size) {
  unsigned long at = (used + 15) & ~15UL;
  if (at + size > ARENA_BYTES) __builtin_trap();
  used = at + size;
  memset(arena + at, 0, size);
  return arena + at;
}

void *memcpy(void *d, const void *s, size_t n) {
  unsigned char *a = d;
  const unsigned char *b = s;
  while (n--) *a++ = *b++;
  return d;
}
void *memmove(void *d, const void *s, size_t n) {
  unsigned char *a = d;
  const unsigned char *b = s;
  if (a < b)
    while (n--) *a++ = *b++;
  else {
    a += n;
    b += n;
    while (n--) *--a = *--b;
  }
  return d;
}
void *memset(void *d, int c, size_t n) {
  unsigned char *a = d;
  while (n--) *a++ = (unsigned char)c;
  return d;
}

static SpeexEchoState *st = 0;
static int frame = 0, channels = 1;
/* interleaved, in Speex's scale */
static float mic[2 * 1024], ref[1024], out[2 * 1024];
/* the caller's buffers, planar (channel after channel), in -1..1 */
static float io_mic[2 * 1024], io_ref[1024], io_out[2 * 1024];

/* New state (drops the previous one). frame_size: samples per frame (≤1024); tail: filter length in samples. */
int aec_init(int frame_size, int tail, int nmic, int rate) {
  if (frame_size <= 0 || frame_size > 1024 || nmic < 1 || nmic > 2) return 0;
  used = 0;
  frame = frame_size;
  channels = nmic;
  st = speex_echo_state_init_mc(frame_size, tail, nmic, 1);
  speex_echo_ctl(st, SPEEX_ECHO_SET_SAMPLING_RATE, &rate);
  return 1;
}

float *aec_mic(void) { return io_mic; }
float *aec_ref(void) { return io_ref; }
float *aec_out(void) { return io_out; }

/* One frame: io_mic and io_ref in, io_out out. */
void aec_process(void) {
  int i, c;
  for (i = 0; i < frame; i++) {
    ref[i] = io_ref[i] * 32767.f;
    for (c = 0; c < channels; c++) mic[i * channels + c] = io_mic[c * frame + i] * 32767.f;
  }
  speex_echo_cancellation(st, mic, ref, out);
  for (i = 0; i < frame; i++)
    for (c = 0; c < channels; c++) io_out[c * frame + i] = out[i * channels + c] * (1.f / 32767.f);
}

/* Forget what was learned (the echo path changed completely: another output or microphone). */
void aec_reset(void) {
  if (st) speex_echo_state_reset(st);
}
