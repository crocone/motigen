# Changelog

## 0.1.0 — 2026-11-07

First release.

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
