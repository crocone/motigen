# The scenes template: a film from a list of scenes

`motigen init scenes <dir>` makes a film out of scenes: each one is one idea on screen for a few seconds, cut to
the next with a transition, on a themed stage whose glow drifts slowly. This is the template for launch videos,
feature announcements and explainers: no drawing, no timeline arithmetic, just the list.

```js
export default {
  theme: 'dark',                               // 'dark' | 'light' | 'paper'; colours in theme.css
  fps: 30,
  brand: { text: 'Acme Cloud' },               // or { logo: 'assets/logo.svg', text: '…' }; top-left, except on the end card
  background: { motion: true },                // false: a perfectly still background
  transition: { dur: 0.6, name: 'auto' },      // 'auto' varies them; or one name for all
  sfx: { transition: 'whoosh' },               // synthesised unless audio/sfx/whoosh.wav exists; null for none
  scenes: [ … ],
};
```

Every scene has `type`, `dur` (seconds), optional `vo: 'L03'` or `['L03', offset]` (the voice line from
`audio/lines.txt` starts `offset` seconds after the scene, default 0.3), optional `transition` (the way *into*
this scene) and `align: 'left' | 'center'`.

| type | fields | what happens |
|---|---|---|
| `title` | `kicker?`, `title`, `sub?`, `by: 'words' \| 'chars'` | the headline rises word by word out of a mask, the subtitle follows |
| `text` | `text`, `highlight?` | a statement in big type; the highlighted phrase gets a marker sweep |
| `list` | `title?`, `items[]`, `icon: 'check' \| 'dot' \| 'number'` | items slide in one after another; checks draw themselves |
| `stat` | `title?`, `stats: [{ value, from?, prefix?, suffix?, decimals?, label }]` | big numbers count up |
| `image` | `src` or `mock: 'dashboard'`, `frame: 'browser' \| 'none'`, `url?`, `zoom: { from, to, x, y }`, `callout: { x, y, label, at }` | a screenshot in a browser frame with a slow push-in and a callout ring |
| `terminal` | `title?`, `prompt?`, `cps?`, `lines: [{ cmd } \| { out, ok?, dim?, delay? }]` | commands typed with a human rhythm, output appears; keys and Enter go into the mix |
| `code` | `title?`, `lines[]`, `cps?` | a code block typed line by line, keywords, strings and numbers coloured |
| `quote` | `text`, `author?` | serif italic, word by word |
| `split` | `left: { title, items }`, `right: { title, items }` | before / after panels; the right one is the accented answer |
| `end` | `wordmark?` or `logo?`, `url?`, `cta?`, `note?` | the end card: name, address, a call to action |

Transitions: `cut`, `fade`, `slide-left`, `slide-up`, `wipe`, `wipe-up`, `zoom`, `blur`.

## Making it interesting

- **One idea per scene, 3–5 seconds.** Longer holds are where attention dies; if a scene needs more, split it.
- **Never two scenes of the same type in a row.** Headline → statement → terminal → numbers → product →
  list → quote → end is a rhythm; five lists in a row is a slideshow.
- **Show the product doing the thing.** A `terminal` or `code` scene with the real command, an `image` scene
  with a real screenshot (`src: 'assets/app.png'`) and a callout on the detail that matters.
- **Numbers count, text claims.** Put the one metric that matters in a `stat` scene by itself.
- **Write the voice first.** The lines set the pace; a scene lasts about as long as its line plus a beat.
- **Let the transitions vary.** `auto` already does; set one by hand only where the cut should mean something
  (a `cut` into the product, a `blur` into a quote).
- **Both formats from the same list.** `motigen build` renders 16:9 and 9:16; the layout adapts, you only check
  the frames (`motigen frames --fmt v`).

## Your own screens

Put screenshots in `assets/` and reference them from `image` scenes. Record them with the browser recorder
(`Browser.open` + `clip`) when you want the real thing at the exact state; a frame of such a clip is a PNG you
can crop.
