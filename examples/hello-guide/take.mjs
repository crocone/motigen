// One live take for this guide: a real browser on the demo site in ./site and a real terminal on this machine,
// both recorded into take/ for the player.      motigen record take.mjs
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Term, Browser, sleep } from 'motigenjs/record';

const here = dirname(fileURLToPath(import.meta.url));
const take = join(here, 'take');
mkdirSync(take, { recursive: true });

// 1. The browser. The folder ./site is served inside this browser as https://demo.local; for your own product,
//    goto its URL instead (and see Browser.open's `map` to film a local instance under its real domain).
const b = await Browser.open(take);
await b.serve('https://demo.local', join(here, 'site'));
await b.goto('https://demo.local/');
let c = await b.clip('site');
await sleep(1200);
await b.click('#start', { ms: 900 });
await sleep(900);
await b.typeInto('#name', 'maya');
await sleep(500);
await b.click('#go', { ms: 700 });
await sleep(1600);
await b.scrollTo('#more', 120, 1000);
await sleep(1500);
await c.stop();
await b.close();

// 2. The terminal: a shell on this machine through node-pty (bash where there is one). For a clean box, use
//    { backend: 'docker', container } with freshContainer() from 'motigenjs/record'.
const t = new Term(take, { cwd: here });
await t.start();
await t.waitFor('$');
await sleep(900);
t.mark('ls');
await t.type('ls');
await t.enter();
await t.waitFor('edit.js');
await sleep(1500);
t.mark('version');
await t.type('node --version');
await t.enter();
await sleep(1800);
await t.stop();
console.log('take done:', take);
