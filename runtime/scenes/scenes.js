// The scenes player: a film is a list of scenes of a few kinds, cut with transitions, on a themed stage with a
// background that lives. film.js (default export):
//
//   { theme: 'dark' | 'light' | 'paper', fps: 30, brand: { text, logo }, background: { motion: true },
//     transition: { dur: 0.6 }, sfx: { transition: 'whoosh', reveal: null },
//     scenes: [ { type, dur, vo?, transition?, align?, ...fields }, … ] }
//
// Scene types and their fields (every scene has `dur` in seconds; `vo: 'L01'` or ['L01', offset] cues a voice line):
//   title     kicker?, title, sub?, by: 'words' | 'chars'
//   text      text, highlight? (a phrase inside the text)
//   list      title?, items: [string], icon: 'check' | 'dot' | 'number'
//   stat      title?, stats: [{ value, from?, prefix?, suffix?, decimals?, label }]
//   image     src? | mock: 'dashboard', frame: 'browser' | 'none', url?, zoom: { from, to, x, y }, callout: { x, y, label, at }
//   terminal  title?, lines: [{ cmd } | { out, ok?, dim?, delay? }], cps
//   code      title?, lang?, lines: [string], cps
//   quote     text, author?
//   split     left: { title, items }, right: { title, items }
//   end       wordmark? | logo?, url?, cta?, note?
// Transitions: cut, fade, slide-left, slide-up, wipe, wipe-up, zoom, blur; 'auto' (default) varies them.
// Every frame is a pure function of t: window.__film.renderAt(t).
import { clamp, prog, ease, stagger, typedTimes, typedAt, fmtNumber, splitWords } from './motion.js';

const q = new URLSearchParams(location.search);
const spec = (await import(new URL(q.get('film') || 'film.js', location.href).href)).default;
const FMT = q.get('fmt') === 'v' ? 'v' : 'h';
const W = +q.get('w') || (FMT === 'h' ? 1920 : 1080), H = +q.get('h') || (FMT === 'h' ? 1080 : 1920);
const FPS = spec.fps || 30;
const T = spec.transition?.dur ?? 0.6;
const $ = s => document.querySelector(s);
const stage = $('#stage');
stage.style.width = `${W}px`; stage.style.height = `${H}px`; stage.style.setProperty('--u', `${W / 100}px`);
stage.className = `theme-${spec.theme || 'dark'}${FMT === 'v' ? ' portrait' : ''}`;

// ---------- small DOM helpers ----------
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const px = v => `${Math.round(v)}px`;
/** Words (or characters) of `text` in masks, for a reveal from below. Returns { node, spans }. */
function masked(text, { by = 'words', cls = '', highlight = null } = {}) {
  const node = el('span', cls), spans = [];
  // one word (or one character of it) in a mask; `glue` joins it to the previous word without a space
  const add = (w, parent, glue = false) => {
    if (!glue) parent.appendChild(document.createTextNode(' '));
    const pieces = by === 'chars' ? [...w] : [w];
    for (const piece of pieces) { const m = el('span', 'mask'), s = el('span', null, esc(piece).replace(/ /g, '&nbsp;')); m.appendChild(s); parent.appendChild(m); spans.push(s); }
  };
  const at = highlight ? text.indexOf(highlight) : -1;
  if (at >= 0) {
    const a = text.slice(0, at), b = text.slice(at + highlight.length);
    const tail = /^\S+/.exec(b)?.[0] || '';                       // punctuation right after the phrase stays attached
    splitWords(a.trim()).filter(Boolean).forEach((w, i) => add(w, node, i === 0));
    const hl = el('span', 'hl'); node.appendChild(document.createTextNode(a.trim() ? ' ' : '')); node.appendChild(hl);
    splitWords(highlight.trim()).forEach((w, i) => add(w, hl, i === 0));
    if (tail) add(tail, node, true);
    splitWords(b.slice(tail.length).trim()).filter(Boolean).forEach(w => add(w, node));
    node.hl = hl;
  } else splitWords(text.trim()).forEach((w, i) => add(w, node, i === 0));
  return { node, spans };
}
function revealSpans(spans, lt, { start = 0, step = 0.06, dur = 0.8, from = 110 } = {}) {
  spans.forEach((s, i) => { const k = ease.outExpo(prog(lt, start + i * step, start + i * step + dur)); s.style.transform = k >= 1 ? 'none' : `translateY(${(1 - k) * from}%)`; s.style.opacity = k > 0 ? 1 : 0; });
  return start + spans.length * step + dur * 0.6; // when the last word has landed enough to continue
}
function fadeUp(node, lt, start, dur = 0.6, dy = 28) {
  const k = ease.out(prog(lt, start, start + dur));
  node.style.opacity = k; node.style.transform = k >= 1 ? 'none' : `translateY(${px((1 - k) * dy)})`;
}
function slideIn(node, lt, start, dur = 0.6, dx = -48) {
  const k = ease.outExpo(prog(lt, start, start + dur));
  node.style.opacity = clamp(k * 2); node.style.transform = k >= 1 ? 'none' : `translateX(${px((1 - k) * dx)})`;
}
function pop(node, lt, start, dur = 0.55) {
  const k = prog(lt, start, start + dur);
  node.style.opacity = clamp(k * 3); node.style.transform = k >= 1 ? 'none' : `scale(${(0.7 + 0.3 * ease.outBack(k)).toFixed(4)})`;
}
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';

// ---------- scene builders: each returns { el, update(lt), events?(start) } ----------
const builders = {
  title(s) {
    const sec = el('section', `scene ${s.align || 'center'}`);
    const kicker = s.kicker ? sec.appendChild(el('div', 'kicker', esc(s.kicker))) : null;
    const h = sec.appendChild(el('h1', 'h1')); const { node, spans } = masked(s.title, { by: s.by || 'words' }); h.appendChild(node);
    const sub = s.sub ? sec.appendChild(el('p', 'sub', esc(s.sub))) : null;
    return { el: sec, update(lt) { if (kicker) fadeUp(kicker, lt, 0.05, 0.5, 16); const done = revealSpans(spans, lt, { start: 0.2, step: s.by === 'chars' ? 0.035 : 0.075 }); if (sub) fadeUp(sub, lt, done); } };
  },
  text(s) {
    const sec = el('section', `scene ${s.align || 'left'}`);
    const h = sec.appendChild(el('p', 'statement')); const { node, spans } = masked(s.text, { highlight: s.highlight }); h.appendChild(node);
    return { el: sec, update(lt) { const done = revealSpans(spans, lt, { start: 0.15, step: 0.055 }); if (node.hl) node.hl.style.setProperty('--hl', ease.outExpo(prog(lt, done - 0.3, done + 0.3)).toFixed(4)); } };
  },
  list(s) {
    const sec = el('section', `scene ${s.align || 'left'}`);
    const title = s.title ? sec.appendChild(el('h2', 'h2', esc(s.title))) : null;
    const ul = sec.appendChild(el('ul', 'list'));
    const items = s.items.map((text, i) => {
      const li = ul.appendChild(el('li'));
      const ic = li.appendChild(el('span', 'ic', s.icon === 'number' ? `<span class="n">${i + 1}</span>` : s.icon === 'dot' ? '<span class="d"></span>' : CHECK));
      li.appendChild(el('span', null, esc(text)));
      return { li, path: ic.querySelector('path') };
    });
    return { el: sec, update(lt) { if (title) fadeUp(title, lt, 0.05); items.forEach(({ li, path }, i) => { const at = stagger(i, 0.2, title ? 0.4 : 0.15); slideIn(li, lt, at); if (path) { const k = ease.out(prog(lt, at + 0.25, at + 0.65)); path.style.strokeDasharray = 30; path.style.strokeDashoffset = (30 * (1 - k)).toFixed(2); } }); } };
  },
  stat(s) {
    const sec = el('section', `scene ${s.align || 'center'}`);
    const title = s.title ? sec.appendChild(el('h2', 'h2', esc(s.title))) : null;
    const row = sec.appendChild(el('div', 'stats'));
    const stats = s.stats.map(st => { const d = row.appendChild(el('div', 'stat')); const v = d.appendChild(el('div', 'v')); const l = d.appendChild(el('div', 'l', esc(st.label || ''))); return { d, v, l, st }; });
    return { el: sec, update(lt) {
      if (title) fadeUp(title, lt, 0.05);
      stats.forEach(({ d, v, st }, i) => {
        const at = stagger(i, 0.22, title ? 0.4 : 0.15); fadeUp(d, lt, at, 0.6, 36);
        const k = ease.outExpo(prog(lt, at + 0.1, at + 1.5)), from = st.from ?? 0, val = from + (st.value - from) * k;
        v.innerHTML = `${esc(st.prefix || '')}${fmtNumber(val, { decimals: st.decimals ?? 0 })}${st.suffix ? `<small>${esc(st.suffix)}</small>` : ''}`;
      });
    } };
  },
  image(s) {
    const sec = el('section', `scene ${s.align || 'center'}`);
    const win = sec.appendChild(el('div', 'win'));
    if ((s.frame || 'browser') === 'browser') win.appendChild(el('div', 'bar', `<i></i><i></i><i></i>${s.url ? `<span class="url">${esc(s.url)}</span>` : ''}`));
    const body = win.appendChild(el('div', 'body'));
    let content, bars = [], rows = [];
    if (s.src) { content = body.appendChild(el('img')); content.src = s.src; content.alt = ''; }
    else {
      content = body.appendChild(el('div', 'mock'));
      content.innerHTML = `<div class="side"><b>${esc(s.app || 'Acme')}</b><span class="on">Overview</span><span>Deploys</span><span>Domains</span><span>Logs</span><span>Settings</span></div>
        <div class="main"><h4>${esc(s.heading || 'Overview')}</h4><div class="cards"><div class="card"><small>Requests</small><b>1.2M</b></div><div class="card"><small>p95 latency</small><b>84 ms</b></div><div class="card"><small>Uptime</small><b>99.99%</b></div></div>
        <div class="chart">${[38, 52, 46, 70, 64, 88, 76, 95, 82, 100, 91, 97].map(h => `<i style="height:${h}%"></i>`).join('')}</div>
        <div class="rows"><div><b>main</b><span>deployed · 12 s</span></div><div><b>feature/billing</b><span>preview · 9 s</span></div></div></div>`;
      bars = [...content.querySelectorAll('.chart i')]; rows = [...content.querySelectorAll('.rows div')];
    }
    const z = { from: 1, to: 1.12, x: 50, y: 40, ...(s.zoom || {}) };
    content.style.transformOrigin = `${z.x}% ${z.y}%`;
    const co = s.callout ? body.appendChild(el('div', 'callout', s.callout.label ? `<span class="lbl">${esc(s.callout.label)}</span>` : '')) : null;
    if (co) { co.style.left = `${s.callout.x}%`; co.style.top = `${s.callout.y}%`; }
    return { el: sec, update(lt) {
      const k = ease.outExpo(prog(lt, 0.05, 0.9)); win.style.opacity = clamp(k * 2); win.style.transform = k >= 1 ? 'none' : `translateY(${px((1 - k) * 60)}) scale(${(0.96 + 0.04 * k).toFixed(4)})`;
      const zk = ease.inOut(prog(lt, 0.8, s.dur)); const zz = z.from + (z.to - z.from) * zk; content.style.transform = zz === 1 ? 'none' : `scale(${zz.toFixed(5)})`;
      bars.forEach((b, i) => { const g = ease.outBack(prog(lt, 0.7 + i * 0.05, 1.2 + i * 0.05)); b.style.transform = g >= 1 ? 'none' : `scaleY(${g.toFixed(4)})`; });
      rows.forEach((r, i) => fadeUp(r, lt, 1.3 + i * 0.15, 0.4, 12));
      if (co) pop(co, lt, s.callout.at ?? 1.6);
    } };
  },
  terminal(s) { return termLike(s, false); },
  code(s) { return termLike(s, true); },
  quote(s) {
    const sec = el('section', `scene ${s.align || 'left'}`);
    const mark = sec.appendChild(el('div', 'quote-mark', '“'));
    const p = sec.appendChild(el('p', 'quote')); const { node, spans } = masked(s.text); p.appendChild(node);
    const author = s.author ? sec.appendChild(el('div', 'author', esc(s.author))) : null;
    return { el: sec, update(lt) { pop(mark, lt, 0.05, 0.5); const done = revealSpans(spans, lt, { start: 0.25, step: 0.05 }); if (author) fadeUp(author, lt, done); } };
  },
  split(s) {
    const sec = el('section', 'scene left');
    const grid = sec.appendChild(el('div', 'split'));
    const panel = (p, cls) => { const d = grid.appendChild(el('div', `panel ${cls}`)); d.appendChild(el('h3', null, esc(p.title || ''))); const ul = d.appendChild(el('ul', 'list')); const lis = (p.items || []).map(t => { const li = ul.appendChild(el('li')); li.appendChild(el('span', 'ic', cls === 'after' ? CHECK : '<span class="d"></span>')); li.appendChild(el('span', null, esc(t))); return li; }); return { d, lis }; };
    const L = panel(s.left || {}, 'before'), R = panel(s.right || {}, 'after');
    return { el: sec, update(lt) {
      slideIn(L.d, lt, 0.1, 0.7, -60); L.lis.forEach((li, i) => slideIn(li, lt, 0.35 + i * 0.12, 0.5, -24));
      pop(R.d, lt, 0.6, 0.6); R.lis.forEach((li, i) => slideIn(li, lt, 0.9 + i * 0.12, 0.5, -24));
    } };
  },
  end(s) {
    const sec = el('section', 'scene center');
    const wm = sec.appendChild(el('div', 'wordmark', s.logo ? `<img src="${esc(s.logo)}" alt="">${s.wordmark ? `<span>${esc(s.wordmark)}</span>` : ''}` : esc(s.wordmark || spec.brand?.text || '')));
    const url = s.url ? sec.appendChild(el('div', 'url', esc(s.url))) : null;
    const cta = s.cta ? sec.appendChild(el('div', 'cta', `${esc(s.cta)} <span>→</span>`)) : null;
    const note = s.note ? sec.appendChild(el('div', 'note', esc(s.note))) : null;
    return { el: sec, update(lt) { pop(wm, lt, 0.1, 0.7); if (url) fadeUp(url, lt, 0.6); if (cta) pop(cta, lt, 0.95, 0.5); if (note) fadeUp(note, lt, 1.3); } };
  },
};

// A terminal (prompt, typed commands, output lines) or a code block (typed lines, coloured).
const KW = /\b(const|let|var|function|return|import|export|from|await|async|if|else|for|while|new|class|extends|true|false|null|undefined|def|fn|pub|use|struct|impl|match|package|func|go|type|interface)\b/g;
function colour(line) {
  const out = []; let rest = esc(line);
  const re = /(\/\/.*$|#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)/g; let m, last = 0;
  while ((m = re.exec(rest))) { out.push(rest.slice(last, m.index).replace(KW, '<span class="k">$1</span>')); out.push(m[1] ? `<span class="c">${m[1]}</span>` : m[2] ? `<span class="s">${m[2]}</span>` : `<span class="n">${m[3]}</span>`); last = m.index + m[0].length; }
  out.push(rest.slice(last).replace(KW, '<span class="k">$1</span>'));
  return out.join('');
}
function termLike(s, isCode) {
  const sec = el('section', `scene ${s.align || 'center'}`);
  const win = sec.appendChild(el('div', 'win'));
  win.appendChild(el('div', 'bar', `<i></i><i></i><i></i><span class="url">${esc(s.title || (isCode ? '' : '~'))}</span>`));
  const term = win.appendChild(el('div', `term${isCode ? ' code' : ''}`));
  const cps = s.cps || (isCode ? 40 : 26);
  // the schedule: when each line starts, when each character lands, when Enter is pressed
  let t = 0.6; const lines = [], keys = [], enters = [];
  (s.lines || []).forEach((raw, i) => {
    const L = isCode ? { cmd: typeof raw === 'string' ? raw : raw.cmd ?? raw.out ?? '' } : typeof raw === 'string' ? { cmd: raw } : raw;
    if (L.cmd != null) {
      const times = typedTimes(L.cmd, cps, 11 + i); const start = t + (L.delay ?? 0.35);
      lines.push({ ...L, kind: 'cmd', start, times, end: start + (times.at(-1) || 0) + 0.18 });
      for (const k of times) keys.push(+(start + k).toFixed(3));
      enters.push(+(start + (times.at(-1) || 0) + 0.15).toFixed(3));
      t = start + (times.at(-1) || 0) + 0.18;
    } else { const start = t + (L.delay ?? 0.25); lines.push({ ...L, kind: 'out', start, end: start }); t = start; }
  });
  const prompt = isCode ? '' : `<span class="p">${esc(s.prompt || '$')}</span> `;
  return {
    el: sec,
    update(lt) {
      const k = ease.outExpo(prog(lt, 0.05, 0.8)); win.style.opacity = clamp(k * 2); win.style.transform = k >= 1 ? 'none' : `translateY(${px((1 - k) * 50)}) scale(${(0.97 + 0.03 * k).toFixed(4)})`;
      let html = '', typing = false;
      for (const L of lines) {
        if (lt < L.start) break;
        if (L.kind === 'cmd') { const txt = typedAt(L.cmd, L.times, lt - L.start); const cur = lt < L.end; typing ||= cur; html += `<span class="ln">${prompt}${isCode ? colour(txt) : esc(txt)}${cur ? '<span class="cur"></span>' : ''}</span>`; }
        else html += `<span class="ln${L.ok ? ' ok' : ''}${L.dim ? ' dim' : ''}">${isCode ? colour(L.out) : esc(L.out)}</span>`;
      }
      if (!typing && !isCode && lines.length && lt >= (lines.at(-1).end)) html += `<span class="ln">${prompt}<span class="cur"></span></span>`;
      if (term.innerHTML !== html) term.innerHTML = html;
    },
    events: start => ({ keys: keys.map(k => +(start + k).toFixed(3)), enters: enters.map(k => +(start + k).toFixed(3)) }),
  };
}

// ---------- the stage: background, brand, scenes, transitions ----------
const bg = $('#bg');
const glow = bg.appendChild(el('div', 'glow'));
Object.assign(glow.style, { position: 'absolute', inset: '0', opacity: spec.theme === 'dark' || !spec.theme ? '0.42' : '0.22', filter: 'saturate(1.15)' });
bg.appendChild(el('div', 'grid'));
const noise = bg.appendChild(el('div', 'noise'));
noise.style.backgroundImage = `url("data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0.35 0"/></filter><rect width="300" height="300" filter="url(#n)"/></svg>')}")`;
const BLOBS = [[0.22, 0.28, 'var(--accent)', 0.21, 2.1], [0.78, 0.22, 'var(--accent2)', 0.17, 0.4], [0.58, 0.88, 'var(--accent3)', 0.13, 4.2]];
const bgMotion = spec.background?.motion !== false;
function updateBg(t) {
  const tt = bgMotion ? t : 0;
  glow.style.background = BLOBS.map(([cx, cy, c, w, ph]) => `radial-gradient(circle at ${(100 * (cx + 0.07 * Math.sin(tt * w + ph))).toFixed(2)}% ${(100 * (cy + 0.05 * Math.cos(tt * w * 0.8 + ph))).toFixed(2)}%, ${c} 0%, transparent 42%)`).join(',');
}
const brand = $('#brand');
if (spec.brand) brand.innerHTML = `${spec.brand.logo ? `<img src="${esc(spec.brand.logo)}" alt="">` : '<span class="dot"></span>'}<span>${esc(spec.brand.text || '')}</span>`; else brand.style.display = 'none';

const AUTO = ['slide-up', 'wipe', 'zoom', 'fade', 'slide-left', 'blur', 'wipe-up'];
let acc = 0;
const scenes = spec.scenes.map((s, i) => {
  const b = builders[s.type]; if (!b) throw new Error(`scene ${i + 1}: unknown type "${s.type}" (have ${Object.keys(builders).join(', ')})`);
  if (!(s.dur > 0)) throw new Error(`scene ${i + 1} (${s.type}): dur is required`);
  const built = b(s); built.el.style.display = 'none'; $('#scenes').appendChild(built.el);
  const tr = i === 0 ? 'cut' : s.transition || (spec.transition?.name && spec.transition.name !== 'auto' ? spec.transition.name : AUTO[(i - 1) % AUTO.length]);
  const o = { ...s, i, start: acc, built, tr }; acc += s.dur; return o;
});
const DUR = acc;

function resetTransition(e) { e.style.opacity = ''; e.style.transform = ''; e.style.clipPath = ''; e.style.filter = ''; }
function transition(name, p, out, inn) {
  const e = ease.outExpo(p), f = ease.inOut(p);
  const set = (n, o) => { if (n) Object.assign(n.style, o); };
  switch (name) {
    case 'fade': set(out, { opacity: 1 - f }); set(inn, { opacity: f }); break;
    case 'slide-left': set(out, { transform: `translateX(${px(-e * W * 0.25)})`, opacity: 1 - f }); set(inn, { transform: `translateX(${px((1 - e) * W)})` }); break;
    case 'slide-up': set(out, { transform: `translateY(${px(-e * H * 0.2)})`, opacity: 1 - f }); set(inn, { transform: `translateY(${px((1 - e) * H)})` }); break;
    // scenes have no background of their own, so the outgoing one goes quickly under a wipe
    case 'wipe': set(out, { opacity: 1 - e }); set(inn, { clipPath: `inset(0 ${((1 - e) * 100).toFixed(3)}% 0 0)` }); break;
    case 'wipe-up': set(out, { opacity: 1 - e }); set(inn, { clipPath: `inset(${((1 - e) * 100).toFixed(3)}% 0 0 0)` }); break;
    case 'zoom': set(out, { transform: `scale(${(1 - 0.1 * e).toFixed(4)})`, opacity: 1 - f }); set(inn, { transform: `scale(${(1.15 - 0.15 * e).toFixed(4)})`, opacity: f }); break;
    case 'blur': set(out, { filter: `blur(${px(e * 16)})`, opacity: 1 - f }); set(inn, { filter: `blur(${px((1 - e) * 24)})`, opacity: f }); break;
    default: break;
  }
}

function renderAt(t) {
  t = clamp(t, 0, DUR - 1e-6);
  const i = Math.max(0, scenes.findIndex(s => t < s.start + s.dur));
  const cur = scenes[i === -1 ? scenes.length - 1 : i], prev = scenes[cur.i - 1];
  const lt = t - cur.start;
  const p = prev && cur.tr !== 'cut' && lt < T ? lt / T : 1;
  for (const s of scenes) s.built.el.style.display = s === cur || (s === prev && p < 1) ? '' : 'none';
  resetTransition(cur.built.el); if (prev) resetTransition(prev.built.el);
  if (p < 1) transition(cur.tr, p, prev.built.el, cur.built.el);
  // under a transition that moves the whole scene, its own reveals start once it has mostly landed; under a wipe
  // or a fade the content is there from the first frame, so there is something to reveal
  const lead = prev && ['slide-up', 'slide-left', 'zoom', 'blur'].includes(cur.tr) ? T * 0.45 : 0;
  cur.built.update(Math.max(0, lt - lead));
  if (prev && p < 1) prev.built.update(prev.dur);
  updateBg(t);
  if (spec.brand) { const hide = cur.type === 'end' ? ease.inOut(prog(lt, 0, 0.5)) : prev?.type === 'end' ? 0 : 0; brand.style.opacity = 1 - hide; }
}

// Sound events on the output clock: voice cues per scene, a transition sound, typed keys and Enter in terminals.
function events() {
  const ev = { dur: DUR, vo: [], sfx: [], keys: [], enters: [] };
  const trId = spec.sfx?.transition === undefined ? 'whoosh' : spec.sfx.transition;
  for (const s of scenes) {
    if (s.vo) { const [id, off = 0.3] = Array.isArray(s.vo) ? s.vo : [s.vo]; ev.vo.push({ id, t: +(s.start + off).toFixed(3) }); }
    if (s.i > 0 && s.tr !== 'cut' && trId) ev.sfx.push({ id: trId, t: +s.start.toFixed(3), db: spec.sfx?.transitionDb ?? -16 });
    if (s.built.events) { const e = s.built.events(s.start); ev.keys.push(...e.keys); ev.enters.push(...e.enters); }
  }
  ev.vo.sort((a, b) => a.t - b.t);
  return ev;
}

await Promise.all(['800 60px Geist', '700 40px Geist', '600 30px Geist', '500 30px Geist', '400 30px Geist', '900 60px Geist', '500 20px "Geist Mono"', '600 20px "Geist Mono"', 'italic 40px Georgia'].map(f => document.fonts.load(f)));
await document.fonts.ready;
window.__film = { ready: true, dur: DUR, fps: FPS, renderAt, events, scenes: scenes.map(s => ({ i: s.i, type: s.type, start: s.start, dur: s.dur, transition: s.tr })) };
renderAt(+(q.get('t') || 0));
window.dispatchEvent(new Event('film-ready'));
if (q.has('play')) { const t0 = performance.now(); const loop = () => { const t = (performance.now() - t0) / 1000; if (t < DUR) { renderAt(t); requestAnimationFrame(loop); } }; loop(); }
