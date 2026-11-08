---
name: motigen
description: Make a product video, a screencast guide or a short promo film as code with motigen — record a real terminal and browser, cut them with an edit list, narrate with TTS, mix, render to MP4 with subtitles. Use when asked for a demo video, a tutorial video, a launch or promo clip, or to change an existing motigen project.
---

# motigen: video as code

A motigen project is a folder with `motigen.json`, a page that registers `window.__film = { ready, dur,
renderAt(t) }`, and an `audio/` folder. Every frame is a pure function of `t`; the CLI renders it headless.
Commands: `init`, `record`, `preview`, `frames`, `events`, `vo`, `mix`, `srt`, `render`, `build` (`motigen help`).

## Workflow

1. **Pick the template.** `motigen init scenes <dir>` for a launch video, a feature announcement or an explainer
   (a list of scenes: title, statement, terminal, numbers, product window, list, split, quote, end);
   `motigen init guide <dir>` for a screencast of a real product (browser + terminal); `motigen init canvas <dir>`
   for a drawn promo film; `motigen init dom <dir>` for plain HTML/CSS motion.
2. **Write the script first.** `audio/lines.txt`: one line per voice cue, ≤ 55 words per line for a promo,
   plain second person for a guide. Spell for the ear ("Acme Cloud dot dev"); add `"spellings"` to
   `motigen.json` for the subtitles. The ElevenLabs key goes into `.env` (`ELEVENLABS_API_KEY=…`), the voice id
   into `motigen.json` (`motigen vo voices` lists them).
3. **Scenes:** edit `film.js`: one idea per scene, 3–5 s each, never two of the same kind in a row, the real
   command in a `terminal` scene, the real screenshot in an `image` scene with a callout, one metric in a `stat`
   scene, a `quote`, an `end` card with the address; `vo` per scene. See docs/scenes.md.
   **Guide:** edit `take.mjs` so it drives the real product (`Browser.open` with `map` for a local instance under
   its real domain; `Term` for the shell), run `motigen record take.mjs`, then write `edit.js`: one shot per step,
   terminal bounds as text anchors, `chapter` per step, `keys` for Enter moments, `vo` cues per shot.
   **Canvas:** write `film.js` (`load`, `LAYOUTS` for both formats, `render(ctx, f)`, `mixSpec`); `VO_CUES` put the
   first word of each line on a frame. **Dom:** edit `film.html`.
4. **Look before rendering.** `motigen frames -t 1,5,12` and open the JPEGs; `motigen preview` for scrubbing.
   Check both formats when the project has them (`--fmt v`). Then `motigen stability -t <a few hold moments>
   --still`: every hold must report `still`; a `small` change on text that should not move is jitter — find the
   value that still changes (a transform that never settles, a position computed from the clock, line boil).
5. **Sound.** `motigen vo` (needs `ELEVENLABS_API_KEY` and the voice id) or `motigen vo import` for recordings;
   `motigen vo check`; `motigen events`; `motigen mix`. Listen: `audio/mix.wav` should sit at −14 LUFS.
6. **Build.** `motigen build` renders every format and writes the `.srt`. Report the output paths and lengths.

## Rules that keep the output right

- Nothing on screen may depend on wall-clock time, CSS animations or unseeded randomness.
- Keep the stage geometry of the guide player; change colours in `theme.css`, not in the player.
- Voice cues name lines of `lines.txt` (`L01`…); when the script changes, run `motigen vo` again before `mix`.
- Terminal anchors must be text that appears once at that point in the stream; prefer output text over the typed
  command (the command's echo appears first).
- A take is a real run: if it fails, fix the scenario and record again rather than editing the recording.
- Renders go to `out/`; never commit `out/`, `take/` frames or `audio/mix.wav` unless the user wants them.
