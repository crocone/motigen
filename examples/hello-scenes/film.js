// A launch film as a list of scenes. Each scene is one idea, 3–5 seconds, and no two scenes in a row are of the
// same kind: a headline, a statement, a terminal, numbers, the product, a list, a quote, the end card. The
// transitions vary on their own ('auto'); set `transition` on a scene to choose one. Voice lines come from
// audio/lines.txt (L01, L02, …). The kinds and their fields: the header of /_motigen/scenes/scenes.js.
export default {
  theme: 'dark',                       // 'dark' | 'light' | 'paper' (colours in theme.css)
  fps: 30,
  brand: { text: 'Acme Cloud' },       // small mark top-left on every scene but the last ({ logo: 'assets/logo.svg' } too)
  background: { motion: true },        // the glow drifts slowly; false for a perfectly still background
  sfx: { transition: 'whoosh' },       // a sound on every transition (synthesised when audio/sfx has none)
  scenes: [
    { type: 'title', dur: 4.5, vo: 'L01', kicker: 'Introducing', title: 'Ship faster. Sleep better.', sub: 'Acme Cloud deploys your app with one command, and keeps it up.' },
    { type: 'text', dur: 3.6, vo: 'L02', text: 'Every deploy today: 14 steps, 3 tools, and 1 prayer.', highlight: '1 prayer' },
    { type: 'terminal', dur: 6, vo: 'L03', title: '~/shop', cps: 24,
      lines: [{ cmd: 'acme deploy' }, { out: 'Building shop@1.4.2 …', dim: true, delay: 0.5 }, { out: '✓ Built in 6.1 s', ok: true, delay: 1.1 }, { out: '✓ Live at https://shop.acme.dev', ok: true, delay: 0.9 }] },
    { type: 'stat', dur: 4.2, vo: 'L04', stats: [{ value: 12, suffix: 's', label: 'from push to live' }, { value: 0, label: 'config files' }, { value: 99.99, decimals: 2, suffix: '%', label: 'uptime, measured' }] },
    { type: 'image', dur: 5.2, vo: 'L05', mock: 'dashboard', app: 'Acme Cloud', heading: 'shop · production', url: 'app.acme.dev', zoom: { to: 1.06, x: 55, y: 45 }, callout: { x: 71, y: 34, label: 'Live traffic', at: 2.2 } },
    { type: 'grid', dur: 4.6, vo: 'L06', title: 'Everything a deploy needs',
      items: [{ icon: 'branch', title: 'Preview URLs', text: 'A live link for every branch.' }, { icon: 'shield', title: 'One-click rollback', text: 'Back to the last good deploy.' }, { icon: 'lock', title: 'Managed secrets', text: 'Encrypted, scoped, never in git.' }] },
    { type: 'split', dur: 4.6, vo: 'L07', left: { title: 'Before', items: ['A 40-line runbook', 'Two people on call', 'Friday freezes'] }, right: { title: 'With Acme', items: ['One command', 'Nobody waits', 'Ship on Fridays'] } },
    { type: 'quote', dur: 4, vo: 'L08', text: 'We deleted our deploy runbook the first week.', author: 'Maya Chen, CTO at Northwind' },
    { type: 'end', dur: 4.5, vo: 'L09', wordmark: 'Acme Cloud', url: 'acme.dev', cta: 'Start free', note: 'Free for personal projects · No card needed' },
  ],
};
