// Every scene type of the scenes template once, with its main options: a reference to copy from, and the film the
// theme previews are rendered from (?theme=light, ?theme=paper). No voice: the scenes carry their own timing.
// Render a look at it:   motigen frames -C . -t 2,8,14 --query "theme=paper"
export default {
  theme: 'dark',
  fps: 30,
  brand: { text: 'Acme Cloud' },
  scenes: [
    { type: 'title', dur: 3.8, kicker: 'title', title: 'Ship faster. Sleep better.', sub: 'The headline rises word by word; the kicker and the subtitle follow.' },
    { type: 'text', dur: 3.4, text: 'A statement in big type, with one phrase marked.', highlight: 'one phrase marked' },
    { type: 'list', dur: 4, title: 'A list', items: ['Items slide in one after another', 'The checks draw themselves', 'Three to four items read best'] },
    { type: 'stat', dur: 4, title: 'Numbers count up', stats: [{ value: 12, suffix: 's', label: 'from push to live' }, { value: 4800, label: 'deploys a day' }, { value: 99.99, decimals: 2, suffix: '%', label: 'uptime' }] },
    { type: 'chart', dur: 4.4, kind: 'bars', title: 'Bars grow', highlight: 5, data: [{ label: 'Jan', value: 12 }, { label: 'Feb', value: 18 }, { label: 'Mar', value: 26 }, { label: 'Apr', value: 31 }, { label: 'May', value: 44 }, { label: 'Jun', value: 62 }], suffix: 'k' },
    { type: 'chart', dur: 4.6, kind: 'line', title: 'A line draws', prefix: '$', suffix: 'k', data: [{ label: 'W1', value: 8 }, { label: 'W2', value: 11 }, { label: 'W3', value: 10 }, { label: 'W4', value: 17 }, { label: 'W5', value: 21 }, { label: 'W6', value: 19 }, { label: 'W7', value: 28 }, { label: 'W8', value: 36 }] },
    { type: 'table', dur: 5, title: 'A comparison', columns: ['Acme', 'DIY', 'Legacy'], highlight: 0, rows: [{ label: 'Deploy time', values: ['12 s', '40 min', '2 h'] }, { label: 'Preview per branch', values: [true, false, false] }, { label: 'Rollback', values: [true, true, false] }, { label: 'On-call needed', values: [false, true, true] }] },
    { type: 'phone', dur: 5, kicker: 'mobile', title: 'Deploys in your pocket.', sub: 'A phone with an app screen and a notification that drops in.', app: 'Acme', cta: 'Deploy now', notification: { title: 'shop is live', body: 'production · 12 s', at: 2.6 } },
    { type: 'grid', dur: 4.6, title: 'Feature cards', items: [{ icon: 'branch', title: 'Preview URLs', text: 'A live link for every branch.' }, { icon: 'shield', title: 'Safe rollbacks', text: 'Back to the last good deploy in one click.' }, { icon: 'lock', title: 'Managed secrets', text: 'Encrypted, scoped, never in the repo.' }] },
    { type: 'image', dur: 5, mock: 'dashboard', app: 'Acme Cloud', heading: 'shop · production', url: 'app.acme.dev', zoom: { to: 1.06, x: 55, y: 45 }, callout: { x: 71, y: 34, label: 'Live traffic', at: 2 } },
    { type: 'terminal', dur: 5.4, title: '~/shop', lines: [{ cmd: 'acme deploy' }, { out: 'Building shop@1.4.2 …', dim: true, delay: 0.5 }, { out: '✓ Live at https://shop.acme.dev', ok: true, delay: 1 }] },
    { type: 'code', dur: 5.6, title: 'acme.config.js', lines: ['// one file, if you want one', 'export default {', '  name: "shop",', '  regions: ["eu", "us"],', '  replicas: 3,', '}'] },
    { type: 'quote', dur: 3.8, text: 'We deleted our deploy runbook the first week.', author: 'Maya Chen, CTO at Northwind' },
    { type: 'split', dur: 4.4, left: { title: 'Before', items: ['A 40-line runbook', 'Two people on call', 'Friday freezes'] }, right: { title: 'With Acme', items: ['One command', 'Nobody waits', 'Ship on Fridays'] } },
    { type: 'end', dur: 4, wordmark: 'Acme Cloud', url: 'acme.dev', cta: 'Start free', note: 'Free for personal projects' },
  ],
};
