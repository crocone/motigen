// The edit: shots in order over the recording in take/ (made by `motigen record take.mjs`). Format: the header of
// /_motigen/guide/player.js (cards, browser clips, terminal pieces with text anchors, zoom, chapters, key badges,
// voice cues). Voice cues name lines of audio/lines.txt (L01, L02, …) made by `motigen vo`.
const intro = `
  <img src="brand.svg" alt="">
  <h1>{{name}}</h1>
  <p>A real browser, a real terminal, one edit list.</p>
  <div class="chips"><span>browser</span><span>terminal</span><span>voice</span></div>`;
const outro = `
  <h1>That's it.</h1>
  <p>Change edit.js and render again.</p>
  <p class="mono">motigen build</p>`;

export default {
  cols: 112, rows: 30,            // the recorded terminal's size (Term's cols / rows)
  take: 'take',                   // browser clips: take/<clip>/clip.json + frames
  term: 'take/term',              // terminal stream: take/term.out + take/term.tm
  termTitle: 'you@laptop: ~',
  // host: 'example.com',         // the address bar; default: the clip's own host
  // maskPath: [[/\/connect\/\w+$/, '/connect/…']],
  shots: [
    { card: intro, dur: 4, vo: [['L01', -1, 0.5]] },

    { browser: 'site', segs: [[0, 9.5]], chapter: ['Step 1', 'Connect'], vo: [['L02', -1, 0.6]],
      zoom: [[0, 1, 800, 450], [1.4, 1.35, 700, 420], [6.0, 1.35, 700, 420], [7.2, 1, 800, 450]] },

    { term: true, segs: [[0, 'edit.js|+1.2'], [null, 'node --version|+1.6']], chapter: ['Step 2', 'The terminal'], vo: [['L03', -1, 0.4]],
      keys: [['node --version|-0.2', 1.4, 'Enter', 'run it']] },

    { card: outro, dur: 4, vo: [['L04', -1, 0.3]] },
  ],
};
