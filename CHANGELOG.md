# Changelog

## 0.1.1 — 2026-11-07

Stillness, built in and measured.

- `motigen stability -t …`: renders consecutive frames at chosen moments and reports the share of pixels that
  changed, with a bounding box and a brightened `-diff.png`; `--still` fails on any change. The examples' holds
  are checked in CI.
- The guide player snaps its camera translation to whole pixels and its scale to a fixed grid; its transient
  transforms settle to `none`.
- The dom template no longer keeps a "breathing" element; its animated values settle exactly.
- x264 keyframes only on the regular interval (`--gop`, default 2 s), no scene-cut keyframes: no texture pulse.

## 0.1.0 — 2026-11-07

First release. The npm package is `motigenjs` (npm keeps the bare name as too close to an existing package); the
command is `motigen`.

- The contract (`window.__film`), the headless renderer with parallel workers, stills, the events export, the
  preview server with its player.
- Templates: `guide` (screencast player with xterm replay, browser clips, chapters, cards, text anchors), `dom`,
  `canvas` (the ink / kit drawing engine with its own offline mix and in-browser export).
- Recorder: `Term` (node-pty, or `script -T` in a container), `Browser` (CDP screencast, mouse, clicks, keys,
  URLs, host mapping, a local folder as a site).
- Sound: ElevenLabs narration with timestamps split per line, import of own recordings, a quality check, the mix
  (voice, effects, looped bed, ducking, two-pass loudnorm), subtitles.
- Verified against the pipeline it was extracted from: identical events, frames within codec noise, identical
  loudness and subtitle files.
