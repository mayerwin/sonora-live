#!/bin/sh
# Builds src/media/aec.wasm from third_party/speexdsp (the SpeexDSP echo canceller) with clang's WebAssembly target.
# Needs clang and wasm-ld (no Emscripten, no libc). The .wasm is committed: the app build does not run this.
set -eu
cd "$(dirname "$0")/../third_party/speexdsp"
clang --target=wasm32 -O3 -ffreestanding -nostdlib -fno-builtin-memset -fno-builtin-memcpy -fno-builtin-memmove \
  -DHAVE_CONFIG_H -I. -Ilibc -msimd128 -mbulk-memory \
  -Wl,--no-entry -Wl,--allow-undefined -Wl,--strip-all -Wl,--initial-memory=10485760 \
  -Wl,--export=aec_init -Wl,--export=aec_process -Wl,--export=aec_reset \
  -Wl,--export=aec_mic -Wl,--export=aec_ref -Wl,--export=aec_out -Wl,--export=memory \
  -o ../../src/media/aec.wasm sonora_aec.c mdf.c fftwrap.c smallft.c
ls -l ../../src/media/aec.wasm
