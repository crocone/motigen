# motigen

Video as code, for developers and their coding agents.

A web page is the film: it draws frame `t` on demand, in plain HTML, Canvas or anything else a browser runs.
motigen opens it headless, renders every frame in order and pipes them into ffmpeg, so one project gives the same
MP4 on every run. Real terminals and real browsers are recorded and replayed inside the same page; the narration,
the sound effects and the music are mixed from the timeline the page exports; the subtitles come from the same
cues. Everything is a file in git and every step is one command, which is exactly what a coding agent needs to
make a product video on its own.

```bash
npm i -g motigenjs && npx playwright install chromium   # Node 22+, ffmpeg in PATH; the command is `motigen`
motigen init guide my-guide && cd my-guide
motigen record take.mjs      # a real browser and a real terminal, recorded into take/
motigen vo                   # narration from audio/lines.txt (ElevenLabs), one file per line
motigen build                # events → mix → render → subtitles: out/my-guide.mp4 + .srt
motigen preview              # scrub it, play it with sound, render from a button
```

## What you get

- **Three kinds of film, one contract.** A page registers `window.__film = { ready, dur, renderAt(t) }`. The
  `dom` template is that contract in 80 lines; the `guide` template is a screencast player (browser window,
  terminal window, chapters, key badges, cards) driven by one edit list; the `canvas` template is a hand-drawn
  2D engine (paper, letterpress type, ink strokes, a thread, cards, a pencil) with its own offline mix.
- **A recorder for the real thing.** `Term` records a shell through a pty with `script`-style timing, so the
  player replays the actual bytes through xterm.js; `Browser` records a CDP screencast with the mouse path, the
  clicks, the keys and the URLs, and can serve a local folder or a local instance of your site under its real
  domain.
- **Sound from the timeline.** `motigen events` asks the page where the voice lines, clicks and key presses fall;
  `motigen vo` makes the narration (one ElevenLabs call with timestamps, split per line, or your own recordings);
  `motigen mix` lays everything out, ducks the music under the voice and masters to −14 LUFS / −1 dBTP;
  `motigen srt` writes the subtitles.
- **Deterministic, parallel rendering.** Every frame depends on `t` alone, so `-j 4` renders four slices at once
  and joins them losslessly, and the preview scrubs to any moment instantly.
- **Made for agents.** `skill/SKILL.md` tells a coding agent how to take a script to a finished video with these
  commands; the whole project is text it can read and change.

## Install

Node 22 or newer and ffmpeg in your PATH. Playwright downloads its Chromium once; `--channel chrome` uses an
installed Chrome instead.

```bash
npm i -g motigenjs
npx playwright install chromium
```

The npm package is `motigenjs`; the command it installs is `motigen`. As a project dependency, `npx motigen …`
works the same way.

The terminal recorder uses `node-pty` (an optional dependency with prebuilt binaries for Windows, macOS and
Linux). Without it, record in a container: `backend: 'docker'`.

## Commands

| Command | What it does |
|---|---|
| `motigen init <guide\|dom\|canvas> <dir>` | A new project from a template. |
| `motigen preview [--port 4310] [--open]` | A player over the project: scrub, play with `audio/mix.wav`, switch formats, render and export events from buttons. |
| `motigen frames -t 1,2.5,10` | Stills into `shots/` (`--png`, `--every 5`, `--element '#terminal'` with a transparent background, `--scale 2`). |
| `motigen render` | The video to `out/<name>.mp4`: `-j N` pages in parallel (default: half the cores, at most 4), `--range 10-20`, `--audio file.wav` or the project's `audio/mix.wav`, `--crf`, `--preset`. |
| `motigen stability -t 3,10` | Renders consecutive frames at those moments and reports what changed between them (`--every 2`, `--frames 3`, `--still` to fail on any change). |
| `motigen events` | The page's `events()` into `audio/events.json`: voice cues, clicks, keys, Enter presses, effects. |
| `motigen record [take.mjs]` | Runs a take script; it imports `{ Term, Browser, sleep }` from `motigenjs/record`. |
| `motigen vo [lines.txt]` | Narration: one ElevenLabs call for the whole script, split per line into `audio/vo/` with `vo.json`. `vo split` uses a saved response, `vo import` your own recordings, `vo check` flags breathy or garbled lines. |
| `motigen mix` | `audio/mix.wav` from `events.json`, `vo/`, `sfx/` and `bed.*`; or the canvas kit's own mix when `"mix": {"engine": "page"}`. |
| `motigen srt` | Subtitles from the voice cues, with the written forms from `"spellings"`. |
| `motigen build` | `events` → `mix` → `render` (every format) → `srt`. |
| `motigen skill [dir]` | Installs `skill/SKILL.md` into `.claude/skills/motigen/`, so a coding agent in that folder knows the workflow. |

Common options: `-C dir` (the project), `-p page`, `--fmt name`, `--size WxH`, `--query "fmt=v"`, `--channel chrome`,
`--no-gpu`, `--ffmpeg path`, `--timeout s`. `motigen help` lists everything.

## The contract

```js
window.__film = {
  ready: true,         // fonts and assets are loaded
  dur: 38,             // seconds
  fps: 30,             // optional
  renderAt(t) {},      // draw the frame at t seconds; sync or async; a pure function of t
  events() {},         // optional: { dur, vo: [{id, t}], clicks: [t], keys: [t], enters: [t], sfx: [{id, t, db}] }
  canvas,              // optional: an HTMLCanvasElement to read frames from, at its own size
};
```

A frame must depend on `t` alone: no `Date.now()`, no CSS animations or transitions, no random numbers without a
seed, nothing that keeps running between calls. Then any frame can be rendered at any time in any order, which is
what parallel rendering and scrubbing rely on.

## A project

```
my-guide/
  motigen.json      page, fps, size, formats, audio folder, out, vo / mix / spellings settings
  film.html         the page; the guide template adds edit.js, theme.css, brand.svg, take.mjs, site/
  take/             recordings: take/<clip>/ (frames + clip.json), take/term.out + term.tm
  audio/            lines.txt → vo/ (L01.wav… + vo.json); bed.wav; sfx/; events.json, mix.wav (generated)
  out/              renders and subtitles
```

```json
{ "page": "film.html", "fps": 30, "size": [1920, 1080], "out": "out/my-film.mp4",
  "formats": { "h": { "query": "fmt=h" }, "v": { "size": [1080, 1920], "query": "fmt=v" } },
  "vo": { "voice": "<elevenlabs voice id>", "model": "eleven_v4", "seed": 7042 },
  "mix": { "voiceDb": -3, "duckDb": -9, "target": { "lufs": -14, "dbtp": -1 } },
  "spellings": [["Acme Cloud dot com", "acmecloud.com"], ["Pie", "Pi"]] }
```

## The three templates

**guide** — a screencast. `take.mjs` records the demo site in `site/` (served inside the recorder as
`https://demo.local`) and a shell on your machine; `edit.js` cuts them:

```js
export default {
  cols: 112, rows: 30, take: 'take', term: 'take/term',
  shots: [
    { card: intro, dur: 4, vo: [['L01', -1, 0.5]] },
    { browser: 'site', segs: [[0, 9.5]], chapter: ['Step 1', 'Connect'], zoom: [[0, 1, 800, 450], [1.4, 1.35, 700, 420]] },
    { term: true, segs: [[0, 'edit.js|+1.2'], [null, 'node --version|+1.6']], keys: [['node --version|-0.2', 1.4, 'Enter', 'run it']] },
    { card: outro, dur: 4 },
  ],
};
```

Segments play source seconds back to back and can be stretched or squeezed; terminal bounds can be text anchors
(`'Installed|+0.8'` = the moment that text appears, plus 0.8 s); the window zooms along keyframes; cards, chapters,
key badges and notes are overlays. [docs/guide.md](docs/guide.md) has the whole format and the recorder API.

**dom** — the contract and nothing else: a title, a bar and three typed lines in one HTML file. Start here for a
film in plain HTML and CSS.

**canvas** — a 12-second film on the hand-drawn engine from a real promo series: paper, a letterpress title, an
ink thread with a needle, a rule card with a highlighter, tally marks, a pencil that underlines, a stamped name.
Both formats come from one `LAYOUTS` table. [docs/canvas.md](docs/canvas.md) lists the kit.

## Sound

`audio/lines.txt` is the script, one line per cue. `motigen vo` sends it to ElevenLabs in one call with character
timestamps (`ELEVENLABS_API_KEY`, the voice id in `motigen.json`) and cuts the take at the quietest point between
lines, so pauses sound natural and every line is its own file. Recorded your own? `motigen vo import` writes
`vo.json` for the files in `audio/vo/`. Then `motigen mix` places each line where the edit put its cue, adds the
click / key / Enter sounds for what the recorder logged (synthesised when `audio/sfx/` is empty), loops the music
bed with a crossfade, ducks it under the voice and masters with ffmpeg's two-pass loudnorm. The levels, the
ducking and the target live under `"mix"` in `motigen.json`. [docs/audio.md](docs/audio.md).

## Stillness

A still shot has to repeat the same pixels frame after frame; the smallest shimmer on text reads as jitter once
it is encoded. motigen is built so that it does not happen, and ships the check:

- Every frame is a pure function of `t`: nothing on screen may depend on the clock, on CSS animations or on
  unseeded randomness.
- The guide player snaps its camera to whole pixels and a fixed scale grid, so a slow pan moves in clean steps
  and a hold repeats one transform; the canvas kit keeps hand-drawn strokes on one seed (no "line boil"); the
  templates settle every animated value to an exact number.
- The encoder puts keyframes every 2 s and nowhere else (`--gop`), so fine texture does not pulse on holds.
- `motigen stability -t 3,10,20` renders consecutive frames at those moments and reports the share of pixels
  that changed, with a box around the change and a `-diff.png` that shows it brightened; `--still` fails when a
  moment is not perfectly still. A cursor, a caret or a spinner show up as small boxes; jitter shows up as a
  small change spread across text that should not move.

## Why not …

- **Remotion**: React, a bundler and a licence with limits for companies. motigen takes any page, needs no build
  step, and is MIT.
- **Motion Canvas**: its own editor and generator syntax. motigen is a CLI over an ordinary HTML page.
- **VHS, asciinema**: the terminal only. motigen puts a real terminal next to a real browser, cuts them with one
  edit list, and adds narration, sound and subtitles from the same timeline.
- **Screen recorders**: a GUI and one take. A motigen project is text in git; change one line and render again.

## Where it comes from

The format and the tools were extracted from a pipeline that produced a real series of product guides and promo
films. Every port was checked against that pipeline's own output: the guide player gives the same events and the
same frames (SSIM 0.99 against the earlier render), the mix the same loudness and the same waveform within the
random jitter of the key clicks, the subtitles the same file byte for byte, the canvas films the same frames.

## Development

```bash
git clone https://github.com/crocone/motigen && cd motigen
npm i && npx playwright install chromium
npm test
node bin/motigen.js build -C examples/hello-dom
cd examples/hello-guide && node ../../bin/motigen.js record take.mjs && node ../../bin/motigen.js build
```

MIT.
