// Guide player: composes a film from a recorded take (browser screencast clips + the terminal stream) and the edit
// list. Every frame is a pure function of t: window.__film.renderAt(t) (async), window.__film.dur.
//   film.html                       preview: ?t=12.5 shows one moment, ?play=1 runs it, ?edit=other.js another edit
//
// Edit list (edit.js, default export), shots in order:
//   { card: 'html…', dur }                                      a full-screen card
//   { browser: '<clip>', segs, zoom?, chapter?, keys?, note? }  a browser clip from <take>/<clip>/ (clip.json + frames)
//   { term: true, segs, zoom?, chapter?, keys?, note?, typing? } the terminal stream (<term>.out + <term>.tm)
// segs: [[src0, src1, dur?], …] source seconds played back to back; dur stretches or squeezes that piece.
// Terminal bounds may be text anchors: 'text' or 'text|+0.4' = the moment that text appears in the stream (searched
// forward from the previous anchor, so repeated words resolve in order); null = where the previous piece ended.
// zoom: [[t, scale, cx, cy], …] in shot time; cx/cy is the point brought to the middle of the window, in page CSS px
// for browser shots (the recorded viewport) and in window px (1520×855) for terminal shots. Only the window's content
// zooms; the frame, chapter and brand stay put.
// keys: [[t0 | 'anchor', len, 'Enter', 'label']] a key badge. chapter: ['Step 1', 'Copy the install line'].
// vo: [[lineId, seg, offset]] voice cues (seg -1 = the shot's start); they come out of events() for the mix.
// typing: [[src0, src1]] terminal ranges where a TUI echoes typed keys (counted as key presses in events()).
// Top level: cols, rows (terminal size), fps (30), take ('take'), term ('take/term'), brand (image url),
// termTitle ('you@laptop: ~'), host (default: the clip's own), maskPath [[pattern, replacement]].
const q = new URLSearchParams(location.search);
const editUrl = new URL(q.get('edit') || 'edit.js', location.href);
const edit = (await import(editUrl.href)).default;
const base = new URL((edit.take || 'take').replace(/\/?$/, '/'), location.href).href;
const termBase = new URL(edit.term || 'take/term', location.href).href;
const FPS = edit.fps || 30;

const $ = s => document.querySelector(s);
const stage = $('#stage'), bcontent = $('#bcontent'), tcontent = $('#tcontent'), shotImg = $('#shot'), cursor = $('#cursor');
const winB = $('#browser'), winT = $('#terminal'), card = $('#card'), chapter = $('#chapter'), key = $('#key'), note = $('#note');
void stage;

const ease = k => (k <= 0 ? 0 : k >= 1 ? 1 : k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Window geometry: the recorded page is shown at 1520×855 under a 46 px bar.
const VW = 1520, VH = 855;

// ---------- theme ----------
{
  const brand = $('#brandmark');
  if (brand) { if (edit.brand) brand.src = edit.brand; brand.onerror = () => { brand.style.display = 'none'; }; if (!brand.getAttribute('src')) brand.style.display = 'none'; }
  const title = $('#terminal .bar span');
  if (title && edit.termTitle) title.textContent = edit.termTitle;
  if ($('#host') && edit.host) $('#host').textContent = edit.host;
}
const masks = (edit.maskPath || []).map(([p, r]) => [p instanceof RegExp ? p : new RegExp(p), r]);

// ---------- load ----------
const fetchJson = async u => { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); };
const clips = {};
for (const s of edit.shots) if (s.browser && !clips[s.browser]) clips[s.browser] = await fetchJson(`${base}${s.browser}/clip.json`);
const kOf = clip => VW / (clip.viewport?.width || edit.pageWidth || 1600);

const hasTerm = edit.shots.some(s => s.term);
let termRaw = new Uint8Array(0), termText = '';
const chunks = [];
if (hasTerm) {
  const [out, tm] = await Promise.all([fetch(`${termBase}.out`), fetch(`${termBase}.tm`)]);
  if (!out.ok || !tm.ok) throw new Error(`terminal stream missing: ${termBase}.out / .tm (${out.status} / ${tm.status})`);
  termRaw = new Uint8Array(await out.arrayBuffer());
  const termStart = termRaw.indexOf(10) + 1; // `script` writes a header line first
  let pos = termStart, t = 0;
  for (const line of (await tm.text()).trim().split('\n')) {
    if (!line.trim()) continue;
    const [d, n] = line.trim().split(/\s+/);
    t += +d;
    chunks.push({ t, a: pos, b: pos + +n });
    pos += +n;
  }
  termText = new TextDecoder().decode(termRaw);
}

// every face declared in player.css (and theme.css): a weight that loads on first use shows no text until it arrives
await Promise.all([...document.fonts].map(f => f.load().catch(() => null)));
await document.fonts.ready;

let term = null, written = 0, termSrc = -1;
if (hasTerm) {
  if (typeof Terminal === 'undefined') throw new Error('xterm is not loaded: film.html needs <script src="/_motigen/vendor/xterm/lib/xterm.js">');
  const css = getComputedStyle(document.documentElement);
  const v = n => css.getPropertyValue(n).trim();
  term = new Terminal({
    cols: edit.cols || 112, rows: edit.rows || 30, fontFamily: '"Geist Mono", monospace', fontSize: 21.5, lineHeight: 1.0,
    cursorBlink: false, cursorStyle: 'block', allowTransparency: true, scrollback: 0,
    theme: { background: v('--term') || '#1b1a18', foreground: v('--term-fg') || '#ebe6dc', cursor: v('--term-fg') || '#ebe6dc', cursorAccent: v('--term') || '#1b1a18', black: v('--term') || '#1b1a18', brightBlack: v('--term-dim') || '#77736b' },
  });
  term.open($('#xt'));
  term.focus();
  window.term = term;
  // Fit every row inside the window: the cell height comes from the font's metrics, not from fontSize alone.
  const box = $('#xt').getBoundingClientRect();
  const screen = () => $('#xt .xterm-screen').getBoundingClientRect();
  for (let i = 0; i < 40 && (screen().height > box.height || screen().width > box.width); i++) {
    term.options.fontSize -= 0.25;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
  $('#xt').style.paddingLeft = `${Math.max(0, (box.width - screen().width) / 2)}px`;
}
const write = data => new Promise(r => term.write(data, r));
async function termAt(src) {
  if (!term) return;
  if (src < termSrc) { term.reset(); written = 0; }
  termSrc = src;
  let end = written;
  while (end < chunks.length && chunks[end].t <= src) end++;
  if (end > written) { await write(termRaw.subarray(chunks[written].a, chunks[end - 1].b)); written = end; }
}

// Terminal anchors: a seg bound may be 'text' or 'text|+0.4' = the moment that text appears in the stream (searched
// forward from the previous anchor, so repeated words resolve in order), plus an offset.
const encoder = new TextEncoder();
const byteAt = i => encoder.encode(termText.slice(0, i)).length;
let anchorFrom = 0, lastB = 0;
function anchor(v) {
  if (v === null) return lastB;
  if (typeof v === 'number') return v;
  const [text, off] = v.split('|');
  const i = termText.indexOf(text, anchorFrom);
  if (i < 0) throw new Error(`terminal anchor not found: ${text}`);
  anchorFrom = i + text.length;
  const b = byteAt(i + text.length) - 1;
  const c = chunks.find(c => c.b > b);
  if (!c) throw new Error(`terminal anchor past the stream's timing: ${text}`);
  return c.t + (+off || 0);
}
// The same lookup without moving the search on (for key badges), starting where the shot's search started.
function peek(v, from) { const keep = anchorFrom; anchorFrom = from; const t = anchor(v); anchorFrom = keep; return t; }

// ---------- timeline ----------
let acc = 0;
const shots = edit.shots.map((s, i) => {
  s = { ...s };
  const from = anchorFrom;
  const segs = (s.segs || []).map(([a, b, d]) => { if (s.term) { a = anchor(a); b = anchor(b); lastB = b; } return { a, b, d: d ?? b - a }; });
  const dur = s.dur ?? segs.reduce((x, g) => x + g.d, 0);
  if (!(dur > 0)) throw new Error(`shot ${i + 1} has no duration (give dur, or segs)`);
  // keys given at a terminal moment ('text|off') become shot time
  const keys = (s.keys || []).map(([t0, len, ...rest]) => {
    if (typeof t0 !== 'string') return [t0, len, ...rest];
    const src = peek(t0, from);
    let acc2 = 0;
    for (const g of segs) { if (src <= g.b) { const l = acc2 + g.d * clamp((src - g.a) / Math.max(1e-6, g.b - g.a), 0, 1); return [l, l + len, ...rest]; } acc2 += g.d; }
    return [acc2, acc2 + len, ...rest];
  });
  // voice cues: [id, seg, offset] → shot time (seg -1 = the shot's start)
  const segStart = k => segs.slice(0, Math.max(0, k)).reduce((x, g) => x + g.d, 0);
  const vo = (s.vo || []).map(([id, k, off = 0]) => ({ id, lt: (k < 0 ? 0 : segStart(k)) + off }));
  s = { ...s, keys, vo };
  const o = { ...s, i, segs, dur, start: acc, kind: s.card ? 'card' : s.browser ? 'browser' : 'term' };
  if (o.kind === 'browser' && !clips[s.browser]) throw new Error(`shot ${i + 1}: no clip "${s.browser}"`);
  acc += dur;
  return o;
});
const DUR = acc;

function srcOf(shot, lt) {
  let x = lt;
  for (const g of shot.segs) {
    if (x <= g.d || g === shot.segs.at(-1)) return g.a + (g.b - g.a) * clamp(x / g.d, 0, 1);
    x -= g.d;
  }
  return 0;
}

function lastAt(list, t, key = 't') {
  let lo = 0, hi = list.length - 1, r = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m][key] <= t) { r = m; lo = m + 1; } else hi = m - 1; }
  return list[r];
}

function zoomAt(shot, lt) {
  const z = shot.zoom;
  if (!z || !z.length) return [1, 0, 0];
  if (lt <= z[0][0]) return z[0].slice(1);
  for (let i = 1; i < z.length; i++) {
    if (lt <= z[i][0]) {
      const [t0, ...a] = z[i - 1], [t1, ...b] = z[i];
      const k = ease((lt - t0) / (t1 - t0));
      return a.map((v, j) => v + (b[j] - v) * k);
    }
  }
  return z.at(-1).slice(1);
}

// ---------- images ----------
const imgCache = new Map();
function frameImg(url) {
  if (imgCache.has(url)) return imgCache.get(url);
  const p = new Promise((res, rej) => { const im = new Image(); im.onload = () => im.decode().then(() => res(im), () => res(im)); im.onerror = () => rej(new Error('frame missing: ' + url)); im.src = url; });
  imgCache.set(url, p);
  if (imgCache.size > 40) imgCache.delete(imgCache.keys().next().value);
  return p;
}

// ---------- render ----------
let lastChapter = null, chapterSince = 0;
async function renderAt(t) {
  t = clamp(t, 0, DUR - 1e-6);
  const shot = shots.find(s => t < s.start + s.dur) || shots.at(-1);
  const lt = t - shot.start;
  const prev = shots[shot.i - 1];

  // card
  if (shot.kind === 'card') {
    card.style.display = 'flex';
    if (card.dataset.shot !== String(shot.i)) { card.innerHTML = shot.card; card.dataset.shot = String(shot.i); }
    const fin = shot.i === 0 ? 1 : ease(lt / 0.35), fout = shot.i === shots.length - 1 ? 1 : 1 - ease((lt - (shot.dur - 0.35)) / 0.35);
    card.style.opacity = Math.min(fin, fout);
  } else card.style.display = 'none';

  // which window is in front, and the switch
  const active = shot.kind === 'card' ? (prev?.kind === 'term' ? 'term' : 'browser') : shot.kind;
  const switching = prev && prev.kind !== 'card' && shot.kind !== 'card' && prev.kind !== shot.kind && lt < 0.45;
  const k = switching ? ease(lt / 0.45) : 1;
  const front = active === 'browser' ? winB : winT, back = active === 'browser' ? winT : winB;
  front.style.zIndex = 2; back.style.zIndex = 1;
  front.style.opacity = k; front.style.transform = k === 1 ? 'none' : `translateY(${Math.round((1 - k) * 36)}px) scale(${0.985 + 0.015 * k})`;
  back.style.opacity = switching ? 1 - k * 0.999 : 0; back.style.transform = k === 1 ? 'none' : `scale(${1 - 0.02 * k})`;

  // browser content
  const bShot = shot.kind === 'browser' ? shot : switching && prev.kind === 'browser' ? prev : null;
  const showB = shot.kind === 'browser' ? shot : bShot;
  let K = VW / 1600;
  if (showB || active === 'browser') {
    const s = showB || [...shots.slice(0, shot.i)].reverse().find(x => x.kind === 'browser') || shots.find(x => x.kind === 'browser');
    if (s) {
      const src = s === shot ? srcOf(s, lt) : s.segs.length ? (s === prev ? srcOf(s, s.dur) : srcOf(s, 0)) : 0;
      const clip = clips[s.browser];
      K = kOf(clip);
      const f = lastAt(clip.frames, src);
      const url = `${base}${s.browser}/${f.file}`;
      const im = await frameImg(url);
      if (shotImg.dataset.src !== url) { shotImg.src = im.src; shotImg.dataset.src = url; }
      const u = new URL(lastAt(clip.urls, src).url);
      if (!edit.host && $('#host')) $('#host').textContent = u.hostname;
      let path = u.pathname === '/' ? '' : u.pathname;
      for (const [re, r] of masks) path = path.replace(re, r);
      $('#path').textContent = path;
      // cursor and clicks (browser shots only)
      if (shot.kind === 'browser') {
        const m = interpMouse(clip.mouse, src);
        cursor.style.display = 'block';
        cursor.style.left = `${m.x * K - 5}px`; cursor.style.top = `${m.y * K - 3}px`;
        cursor.style.opacity = switching ? k : 1;
        document.querySelectorAll('.ripple').forEach(r => r.remove());
        for (const c of clip.clicks) {
          const d = src - c.t;
          if (d >= 0 && d < 0.5) {
            const r = document.createElement('div'); r.className = 'ripple';
            const rad = 10 + 34 * ease(d / 0.5);
            Object.assign(r.style, { left: `${c.x * K - rad}px`, top: `${c.y * K - rad}px`, width: `${rad * 2}px`, height: `${rad * 2}px`, opacity: 1 - d / 0.5 });
            bcontent.appendChild(r);
          }
        }
      } else cursor.style.display = 'none';
    } else cursor.style.display = 'none';
  } else cursor.style.display = 'none';
  if (shot.kind !== 'browser') document.querySelectorAll('.ripple').forEach(r => r.remove());

  // terminal content: the newest terminal moment up to here
  const tShot = shot.kind === 'term' ? shot : [...shots.slice(0, shot.i)].reverse().find(x => x.kind === 'term');
  if (tShot) await termAt(tShot === shot ? srcOf(shot, lt) : srcOf(tShot, tShot.dur));
  else await termAt(0);

  // camera. The translation is snapped to whole pixels and the scale to 1/10000: a slow drift then moves in
  // clean one-pixel steps and a hold repeats the exact same transform every frame, so text is never re-rasterised
  // at a slightly different sub-pixel offset from one frame to the next (that reads as jitter on video).
  const place = (el, z, unit) => {
    const [s0, x, y] = z; const s = Math.round(s0 * 1e4) / 1e4, cx = x * unit, cy = y * unit;
    // keep the zoomed content inside the window: no empty edges
    const tx = Math.round(clamp(VW / 2 - cx * s, VW - VW * s, 0)), ty = Math.round(clamp(VH / 2 - cy * s, VH - VH * s, 0));
    el.style.transform = s === 1 ? 'none' : `translate(${tx}px, ${ty}px) scale(${s})`;
  };
  const zb = shot.kind === 'browser' ? zoomAt(shot, lt) : switching && prev.kind === 'browser' ? zoomAt(prev, prev.dur) : [1, 800, 450];
  const zt = shot.kind === 'term' ? zoomAt(shot, lt) : switching && prev.kind === 'term' ? zoomAt(prev, prev.dur) : [1, 760, 427];
  place(bcontent, zb, K);
  place(tcontent, zt, 1);

  // chapter, key badge, note
  const ch = shot.chapter || [...shots.slice(0, shot.i)].reverse().find(x => x.chapter)?.chapter;
  const chKey = ch ? ch.join('|') : '';
  if (chKey !== lastChapter) { lastChapter = chKey; chapterSince = shots.find(x => (x.chapter || []).join('|') === chKey)?.start ?? 0; }
  chapter.style.display = ch && shot.kind !== 'card' ? 'flex' : 'none';
  if (ch) {
    chapter.querySelector('.n').textContent = ch[0]; chapter.querySelector('.t').textContent = ch[1];
    const kc = ease((t - chapterSince) / 0.4);
    chapter.style.opacity = kc; chapter.style.transform = `translateX(${Math.round((1 - kc) * -24)}px)`;
  }
  const kb = (shot.keys || []).find(([a, b]) => lt >= a && lt < b);
  key.style.display = kb ? 'flex' : 'none';
  if (kb) {
    key.querySelector('kbd').textContent = kb[2]; key.querySelector('span').textContent = kb[3] || '';
    const kk = Math.min(ease((lt - kb[0]) / 0.25), 1 - ease((lt - (kb[1] - 0.25)) / 0.25));
    key.style.opacity = kk; key.style.transform = `translateX(-50%) translateY(${Math.round((1 - kk) * -14)}px)`;
  }
  const nt = shot.note;
  note.textContent = nt || ''; note.style.opacity = nt && shot.kind !== 'card' ? Math.min(ease(lt / 0.4), 1 - ease((lt - shot.dur + 0.4) / 0.4)) : 0;
}

function interpMouse(list, t) {
  if (!list.length) return { x: 800, y: 450 };
  if (t <= list[0].t) return list[0];
  for (let i = 1; i < list.length; i++) {
    if (list[i].t >= t) {
      const a = list[i - 1], b = list[i], k = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  return list.at(-1);
}

// A TUI's echo of one typed key: a small redraw whose visible text is one printable character (Codex repeats it
// across its cells: "eeee"). Cursor and timer redraws carry no text and stay quiet.
function echoed(c) {
  if (c.b - c.a > 200) return false;
  const vis = new TextDecoder().decode(termRaw.subarray(c.a, c.b))
    .replace(/\x1b\[[0-9;?>]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-B]/g, '').replace(/\s+/g, '');
  return vis.length > 0 && new Set(vis).size === 1 && /[\x21-\x7e]/.test(vis);
}

function outOf(shot, src) {
  let acc = 0;
  for (const g of shot.segs) {
    if (src >= g.a && src <= g.b) return shot.start + acc + g.d * (src - g.a) / Math.max(1e-6, g.b - g.a);
    acc += g.d;
  }
  return null;
}

// Sound events on the output clock, for the mix: voice cues, clicks, key presses, Enter badges.
function events() {
  const ev = { dur: DUR, vo: [], clicks: [], keys: [], enters: [] };
  for (const s of shots) {
    for (const v of s.vo) ev.vo.push({ id: v.id, t: +(s.start + v.lt).toFixed(3) });
    for (const k of s.keys) ev.enters.push(+(s.start + k[0]).toFixed(3));
    if (s.kind === 'browser') {
      const clip = clips[s.browser];
      for (const c of clip.clicks) { const t = outOf(s, c.t); if (t !== null) ev.clicks.push(+t.toFixed(3)); }
      // typing in the page: the recorder's logged key presses, or `typed: [[src0, src1, chars]]` spread evenly
      const typed = clip.keys || (s.typed || []).flatMap(([a, b, n]) => Array.from({ length: n }, (_, i) => a + (b - a) * i / n));
      for (const k of typed) { const t = outOf(s, k); if (t !== null) ev.keys.push(+t.toFixed(3)); }
    }
    if (s.kind === 'term') {
      for (const g of s.segs) {
        const speed = (g.b - g.a) / g.d;
        if (speed > 1.3) continue; // squeezed pieces stay quiet
        for (const c of chunks) {
          if (c.t < g.a || c.t > g.b) continue;
          const n = c.b - c.a, byte = termRaw[c.a];
          const typed = (n === 1 && byte >= 32 && byte < 127) || ((s.typing || []).some(([a, b]) => c.t >= a && c.t <= b) && echoed(c));
          if (typed) ev.keys.push(+outOf(s, c.t).toFixed(3));
        }
      }
    }
  }
  return ev;
}

window.__film = { renderAt, dur: DUR, fps: FPS, shots, events, ready: true };
window.dispatchEvent(new Event('film-ready'));

if (q.has('t')) await renderAt(+q.get('t'));
else if (q.has('play')) {
  const t0 = performance.now();
  const loop = async () => { const t = (performance.now() - t0) / 1000; if (t < DUR) { await renderAt(t); requestAnimationFrame(loop); } };
  loop();
} else await renderAt(0);
