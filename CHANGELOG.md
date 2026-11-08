# Changelog

## 0.2.0 — 2026-11-08

Films that are not boring, and a key that has a place.

- The `scenes` template: a film from a list of scenes — kinetic titles, statements with a marker sweep, counting
  numbers, a product window with a push-in and a callout (a mock dashboard when you have no screenshot yet), a
  typed terminal, a coloured code block, a before/after split, a quote, an end card — with eight transitions that
  vary on their own, three themes (dark, light, paper), a background that lives, both formats from one list,
  and the voice, the transition whoosh and the typed keys in the mix. `docs/scenes.md` has the fields and the
  rules of rhythm.
- `.env` in the project folder is read (`ELEVENLABS_API_KEY=…`), every template ships `.env.example`, `motigen vo
  voices` lists the account's voices with their ids, and the errors say where the key and the voice go.
- Synthesised `whoosh`, `pop` and `tick` effects next to click / key / enter.
- The motion helpers (`/_motigen/scenes/motion.js`: easings, staggers, a typewriter, number formatting) for any
  dom film.

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
