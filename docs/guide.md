# The guide template: recording and the edit

A guide is a screencast of the real thing: a browser window and a terminal window on a 1920×1080 stage, cut by one
edit list, with chapters, key badges, notes and full-screen cards. `motigen init guide <dir>` sets one up.

## Recording a take

`take.mjs` is a Node script run by `motigen record take.mjs`. It imports the recorder:

```js
import { Term, Browser, sleep, freshContainer, waitFile } from 'motigenjs/record';
```

### Browser

```js
const b = await Browser.open('take', {
  width: 1600, height: 900, scale: 1.5,     // the viewport the player assumes (zoom coordinates are in these CSS px)
  theme: 'light', headless: true, channel: undefined,
  map: { 'example.com': '127.0.0.1' },      // film a local instance under its real domain (local certificate accepted)
  proxy: 'http://127.0.0.1:2081',           // everything but the mapped hosts goes through it
  blockAnalytics: true,                     // the usual analytics hosts are aborted
  cookies: [{ name: 'consent', value: 'none', domain: 'example.com', path: '/', secure: true }],
  guard: async page => { /* throw if example.com is not the local stack */ },
  permissions: ['clipboard-read', 'clipboard-write'], origin: 'https://example.com',
});
await b.serve('https://demo.local', 'site');   // a folder as a site, inside this browser only
await b.goto('https://demo.local/');
const clip = await b.clip('site');             // frames + clip.json → take/site/
await b.moveTo('#start', { ms: 900 });         // eased mouse path with a slight arc, logged
await b.click('#start');                       // moveTo + a logged click
await b.typeInto('#name', 'maya');             // each key logged for the mix
await b.scroll(500, 1400);  await b.scrollTo('#more', 120, 1000);
await clip.stop();
await b.close();
```

A clip is a folder of JPEG screencast frames and `clip.json`: `frames: [{t, file, scrollY}]`, `mouse: [{t, x, y}]`,
`clicks`, `keys`, `urls: [{t, url}]`, `viewport`, `scale`, `dur`. Times are seconds from the clip's start.

### Terminal

```js
const t = new Term('take', { cols: 112, rows: 30, cwd: '/path', ps1: '\\w $ ' });
await t.start();              // bash through node-pty (or $SHELL; PowerShell on Windows without bash)
await t.waitFor('$');         // until the text appears after the previous match
t.mark('install');            // a named moment, saved to term.marks.json
await t.type('ls', { cps: 13 });   // like a person, with jitter
await t.enter();  await t.paste('curl -fsSL https://example.com/install.sh | sh');
await t.waitIdle(3000);       // until the stream is quiet (a TUI keeps redrawing while it works)
t.send('\x03');               // raw bytes
await t.stop();
```

Output: `take/term.out` (the raw stream after one header line) and `take/term.tm` (`script -T` timing: seconds
since the previous chunk and its byte count, one line per chunk). The player replays this through xterm.js, so the
screen is the real one at every moment.

For a clean machine, record in a container: `freshContainer({ share: 'take', image: 'debian:bookworm-slim',
setup: 'laptop/setup.sh' })` starts one with `take/` mounted at `/share`, and `new Term('take', { backend: 'docker',
container: 'motigen-take' })` records through `script -T` inside it. Build your own image with the tools the guide
shows.

## The edit

`edit.js` exports one object. Top level: `cols`, `rows` (the recorded terminal's size), `fps` (30), `take`
('take'), `term` ('take/term'), `brand` (image url for the top-right mark), `termTitle`, `host` (the address bar;
default: the clip's own), `maskPath` (`[[pattern, replacement]]` for the shown path), `shots`.

Shots, in order:

| Shot | Fields |
|---|---|
| `{ card: '<html>', dur }` | a full-screen card (fades in and out) |
| `{ browser: '<clip>', segs, zoom?, chapter?, keys?, note?, vo?, typed? }` | a browser clip |
| `{ term: true, segs, zoom?, chapter?, keys?, note?, vo?, typing? }` | the terminal stream |

- `segs: [[src0, src1, dur?], …]` — source seconds played back to back; `dur` stretches or squeezes that piece.
  For terminal shots a bound may be a text anchor: `'Installed acme|-0.3'` is the moment that text appears
  in the stream (searched forward from the previous anchor, so repeated words resolve in order) plus an offset;
  `null` is where the previous piece ended.
- `zoom: [[t, scale, cx, cy], …]` — in shot time; `cx`, `cy` is the point brought to the middle of the window, in
  page CSS px for browser shots (the recorded viewport) and in window px (1520×855) for terminal shots. Only the
  window's content zooms.
- `chapter: ['Step 1', 'Install']` — the pill and title top-left; it stays until the next chapter.
- `keys: [[t0 | 'anchor|off', len, 'Enter', 'label']]` — a key badge for `len` seconds.
- `note: 'text'` — a line at the bottom of the stage for the shot.
- `vo: [[lineId, seg, offset]]` — voice cues: line `L03` starts `offset` seconds after segment `seg` begins
  (`-1` = the shot's start). They become `events.vo` for the mix and the subtitles.
- `typing: [[src0, src1]]` — terminal ranges where a TUI echoes typed keys (counted as key presses).
- `typed: [[src0, src1, n]]` — browser shots: n key presses spread over that range, when the recorder did not log them.

The sound events (`motigen events`) come out of the edit: voice cues, clicks (from the clip's log), key presses
(from the terminal's one-byte echoes, the logged keys, or `typed`), and Enter badges.

## Look

`/_motigen/guide/player.css` holds the geometry and the defaults; `theme.css` in the project overrides the colours
and fonts (`--paper`, `--ink`, `--accent`, `--term`, `--font-sans`, …). The stage is 1920×1080; the window is
1520×901 at (200, 128) with a 46 px bar. Keep the geometry: the zoom coordinates refer to it.
