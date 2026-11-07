// The preview UI: the film page in an iframe (same origin, so window.__film is reachable), a scrub bar, play with
// audio/mix.wav when it exists, format switching, and events / render buttons that call the preview server's API.
const $ = s => document.querySelector(s);
const api = async (p, init) => { const r = await fetch('/_motigen/api/' + p, init); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j; };
const post = (p, body) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });

let P = await api('project');
let fmtName = '', film = null, fps = 30, size = P.size, cur = 0;
document.title = `${P.name} · motigen preview`;
$('#name').textContent = P.name;

function fmtList() {
  const sel = $('#fmt'); sel.innerHTML = '';
  const opts = [['', `default · ${P.size[0]}×${P.size[1]}`], ...Object.entries(P.formats || {}).map(([k, f]) => [k, `${k} · ${f.size[0]}×${f.size[1]}`])];
  for (const [v, l] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.appendChild(o); }
  sel.style.display = P.formats ? '' : 'none';
}
function current() { return fmtName && P.formats?.[fmtName] ? P.formats[fmtName] : { page: P.page, query: P.query, size: P.size, fps: P.fps }; }

function fit() {
  const box = $('main').getBoundingClientRect(), k = Math.min((box.width - 32) / size[0], (box.height - 32) / size[1], 1);
  const fr = $('#frame'); fr.style.width = `${size[0] * k}px`; fr.style.height = `${size[1] * k}px`;
  const f = $('#film'); f.style.width = `${size[0]}px`; f.style.height = `${size[1]}px`; f.style.transform = `scale(${k})`;
}
window.addEventListener('resize', fit);

async function load() {
  stop();
  const f = current();
  size = f.size; fps = f.fps || P.fps;
  $('#dims').textContent = `${size[0]}×${size[1]} · ${fps} fps`;
  fit();
  film = null; $('#loading').style.display = 'flex'; $('#loading').textContent = 'loading…';
  const fr = $('#film');
  fr.src = `/${f.page}${f.query ? '?' + f.query : ''}`;
  const t0 = Date.now();
  for (;;) {
    await new Promise(r => setTimeout(r, 100));
    const w = fr.contentWindow;
    const o = w && (w.__film || w.__ad);
    if (o?.ready === true) { film = o; break; }
    if (Date.now() - t0 > 60000) { $('#loading').textContent = 'the page did not set window.__film.ready within 60 s (see its console)'; return; }
  }
  $('#loading').style.display = 'none';
  $('#scrub').max = film.dur; $('#dur').textContent = `/ ${film.dur.toFixed(2)} s`;
  await show(Math.min(cur, film.dur - 1 / fps));
}

async function show(t) {
  if (!film) return;
  cur = Math.max(0, Math.min(t, film.dur - 1e-6));
  await film.renderAt(cur);
  $('#tc').textContent = cur.toFixed(2) + ' s'; $('#scrub').value = cur;
}
const snap = t => Math.round(t * fps) / fps;

// ---------- play ----------
let playing = false, actx = null, abuf = null, src = null, t0 = 0, raf = 0;
$('#audio').textContent = P.mix ? P.mix.replace(/^\//, '') : 'no audio (audio/mix.wav)';
async function play() {
  if (playing) return stop();
  if (!film) return;
  if (P.mix && !abuf) {
    $('#audio').textContent = 'decoding…';
    actx ||= new AudioContext({ sampleRate: 48000 });
    try { abuf = await actx.decodeAudioData(await (await fetch(P.mix)).arrayBuffer()); $('#audio').textContent = P.mix.replace(/^\//, ''); }
    catch (e) { $('#audio').textContent = 'audio failed: ' + e.message; }
  }
  const off = cur >= film.dur - 0.05 ? 0 : cur;
  playing = true; $('#play').textContent = '❚❚';
  if (abuf) { if (actx.state === 'suspended') await actx.resume(); src = actx.createBufferSource(); src.buffer = abuf; src.connect(actx.destination); src.start(0, off); t0 = actx.currentTime - off; }
  else t0 = performance.now() / 1000 - off;
  let busy = false;
  const loop = async () => {
    if (!playing) return;
    const t = abuf ? actx.currentTime - t0 : performance.now() / 1000 - t0;
    if (t >= film.dur) { stop(); await show(film.dur - 1 / fps); return; }
    if (!busy) { busy = true; try { await show(snap(t)); } finally { busy = false; } }
    raf = requestAnimationFrame(loop);
  };
  loop();
}
function stop() {
  playing = false; $('#play').textContent = '▶';
  if (src) { try { src.stop(); } catch { /* already stopped */ } src = null; }
  cancelAnimationFrame(raf);
}

// ---------- controls ----------
$('#play').onclick = play;
$('#scrub').oninput = () => { stop(); show(snap(+$('#scrub').value)); };
$('#fmt').onchange = () => { fmtName = $('#fmt').value; load(); };
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') e.target.blur();
  const step = e.shiftKey ? 1 : 1 / fps;
  if (e.code === 'Space') { e.preventDefault(); play(); }
  else if (e.code === 'ArrowLeft') { e.preventDefault(); stop(); show(snap(cur - step)); }
  else if (e.code === 'ArrowRight') { e.preventDefault(); stop(); show(snap(cur + step)); }
  else if (e.code === 'Home') { stop(); show(0); }
  else if (e.code === 'End') { stop(); show(film.dur - 1 / fps); }
});

const status = (html) => { $('#status').innerHTML = html; };
$('#events').onclick = async () => {
  $('#events').disabled = true; status('events…');
  try { const r = await post('events', { fmt: fmtName }); status(`${r.out} · ${r.dur.toFixed(2)} s · vo ${r.vo} · clicks ${r.clicks} · keys ${r.keys}`); }
  catch (e) { status('events failed: ' + e.message); }
  $('#events').disabled = false;
};
$('#render').onclick = async () => {
  $('#render').disabled = true; status('starting…');
  try {
    const { id } = await post('render', { fmt: fmtName, workers: 2 });
    for (;;) {
      await new Promise(r => setTimeout(r, 500));
      const j = await api('jobs/' + id);
      if (j.done) { status(j.error ? 'render failed: ' + j.error.split('\n')[0] : `<a href="/${j.out}" target="_blank">${j.out}</a> · ${j.audio ? 'with audio' : 'silent'} · ${j.seconds.toFixed(0)} s`); break; }
      const s = (Date.now() - j.started) / 1000, rate = j.i / Math.max(0.1, s);
      status(`rendering ${j.i}/${j.n} · ${rate.toFixed(1)} fps${j.n ? ` · eta ${Math.round((j.n - j.i) / Math.max(0.1, rate))} s` : ''}`);
    }
  } catch (e) { status('render failed: ' + e.message); }
  $('#render').disabled = false;
};

fmtList();
await load();
