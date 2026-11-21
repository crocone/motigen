// The preview of motigen itself, made with motigen: the short silent clip at the top of the README.
//   motigen frames -C examples/motigen-preview -t 2,7,12,18,24
//   motigen render -C examples/motigen-preview
export default {
  theme: 'dark',
  fps: 30,
  brand: { text: 'motigen' },
  scenes: [
    { type: 'title', dur: 3.6, kicker: 'motigenjs', title: 'Video as code.', sub: 'For developers and their coding agents.' },
    { type: 'code', dur: 5.2, title: 'film.js', lines: ['// a web page is the film', 'window.__film = {', '  ready, dur: 30,', '  renderAt(t) { draw(t) },', '}'] },
    { type: 'text', dur: 3.2, text: 'Every frame is a pure function of t.', highlight: 'pure function of t' },
    { type: 'terminal', dur: 5.6, title: '~/my-launch', lines: [{ cmd: 'motigen init scenes my-launch' }, { cmd: 'motigen build', delay: 0.4 }, { out: 'events → mix → render 16:9 and 9:16 → srt', dim: true, delay: 0.5 }, { out: '✓ out/my-launch-16x9.mp4', ok: true, delay: 0.8 }] },
    { type: 'grid', dur: 4.8, title: 'One project, the whole film', items: [{ icon: 'code', title: 'Real takes', text: 'A real terminal and browser, recorded and replayed.' }, { icon: 'spark', title: 'Voice and mix', text: 'Narration, sounds and music from the same timeline.' }, { icon: 'bolt', title: 'Reproducible', text: 'Same MP4 on every run, frames rendered in parallel.' }] },
    { type: 'stat', dur: 4, title: 'Out of the box', stats: [{ value: 4, label: 'templates' }, { value: 14, label: 'scene kinds' }, { value: 3, label: 'themes' }] },
    { type: 'end', dur: 4, wordmark: 'motigen', url: 'github.com/crocone/motigen', cta: 'npm i -g motigenjs', note: 'MIT · Node 22+ · ffmpeg' },
  ],
};
