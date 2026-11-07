// A real browser, recorded: headless Chromium with CDP screencast frames (jpeg + timestamp) and a log of the mouse
// path, clicks, typed keys and URLs; the player draws the cursor and the click ripples from that log.
// One clip = one folder <dir>/<name>/ of frames + clip.json.
//
// To film your own site under its real domain from a local instance, map the host: { map: { 'example.com':
// '127.0.0.1' } } resolves it to that address in this browser only, bypasses any proxy for it, and accepts the
// local certificate. `guard` can refuse to record when the host is not what you expect (a production server).
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createResolver } from '../serve.js';
import { readFile } from 'node:fs/promises';
import { sleep } from './term.js';

const now = () => Date.now() / 1000;
const ease3 = k => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);
const ease2 = k => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

export class Browser {
  /**
   * @param {string} dir  clips go to <dir>/<clip>/
   * @param {object} [o]
   * @param {number} [o.width] @param {number} [o.height] @param {number} [o.scale]  viewport 1600×900 at 1.5x by default
   * @param {'light'|'dark'} [o.theme]
   * @param {boolean} [o.headless] @param {string} [o.channel]
   * @param {Record<string,string>} [o.map]   host → address, e.g. { 'example.com': '127.0.0.1' }
   * @param {string} [o.proxy]                 proxy server for everything but the mapped hosts
   * @param {boolean} [o.blockAnalytics]       abort requests to the usual analytics hosts (default true)
   * @param {object[]} [o.cookies]             Playwright cookies to set first
   * @param {(page) => Promise<void>} [o.guard] runs on a page before any clip; throw to refuse
   * @param {string[]} [o.permissions]         e.g. ['clipboard-read', 'clipboard-write'] for `origin`
   * @param {string} [o.origin]                the origin those permissions are for
   */
  static async open(dir, { width = 1600, height = 900, scale = 1.5, theme = 'light', headless = true, channel, map = {}, proxy, blockAnalytics = true, cookies = [], guard, permissions, origin, args = [] } = {}) {
    const b = new Browser();
    b.dir = resolve(dir);
    const hosts = Object.keys(map);
    const a = ['--force-color-profile=srgb', '--hide-scrollbars', ...args];
    if (hosts.length) a.push(`--host-resolver-rules=${hosts.map(h => `MAP ${h} ${map[h]}, MAP *.${h} ${map[h]}`).join(', ')}`);
    if (proxy) a.push(`--proxy-server=${proxy}`, `--proxy-bypass-list=${hosts.flatMap(h => [h, `*.${h}`]).join(';') || '<-loopback>'}`);
    b.browser = await chromium.launch({ channel: channel || undefined, headless, args: a });
    b.ctx = await b.browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, colorScheme: theme, ignoreHTTPSErrors: hosts.length > 0 });
    if (cookies.length) await b.ctx.addCookies(cookies);
    if (blockAnalytics) await b.ctx.route(/googletagmanager|google-analytics|cloudflareinsights|plausible\.io|segment\.io|hotjar/, r => r.abort());
    if (permissions?.length) await b.ctx.grantPermissions(permissions, origin ? { origin } : {});
    if (guard) { const p = await b.ctx.newPage(); await guard(p); await p.close(); }
    b.page = await b.ctx.newPage();
    b.mouse = { x: Math.round(width / 2), y: Math.round(height / 2) };
    b.scale = scale;
    return b;
  }

  /** Serve a local folder as a site at `origin` (e.g. https://demo.local) inside this browser only. */
  async serve(origin, folder) {
    const res = createResolver(folder);
    await this.ctx.route(`${origin.replace(/\/$/, '')}/**`, async route => {
      const r = res(new URL(route.request().url()).pathname);
      if (!r) return route.fulfill({ status: 404, body: 'not found' });
      try { return route.fulfill({ status: 200, body: await readFile(r.file), headers: { 'content-type': r.type } }); }
      catch { return route.fulfill({ status: 404, body: 'missing' }); }
    });
  }

  async goto(url, opts = {}) { await this.page.goto(url, { waitUntil: 'networkidle', timeout: 90000, ...opts }); }

  /** Start a clip: frames + the log until stop(). */
  async clip(name) {
    const dir = join(this.dir, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const cdp = await this.ctx.newCDPSession(this.page);
    const c = { name, frames: [], mouse: [], clicks: [], keys: [], urls: [], t0: now(), viewport: this.page.viewportSize(), scale: this.scale };
    let n = 0;
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      const file = `${String(n++).padStart(5, '0')}.jpg`;
      writeFileSync(join(dir, file), Buffer.from(data, 'base64'));
      c.frames.push({ t: +(metadata.timestamp - c.t0).toFixed(4), file, scrollY: metadata.scrollOffsetY });
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    const logUrl = () => c.urls.push({ t: +(now() - c.t0).toFixed(4), url: this.page.url() });
    this.page.on('framenavigated', logUrl);
    logUrl();
    const vp = this.page.viewportSize();
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: Math.round(vp.width * this.scale), maxHeight: Math.round(vp.height * this.scale), everyNthFrame: 1 });
    c.mouse.push({ t: 0, x: this.mouse.x, y: this.mouse.y });
    this.cur = c;
    return {
      stop: async () => {
        await sleep(300);
        await cdp.send('Page.stopScreencast').catch(() => {});
        this.page.off('framenavigated', logUrl);
        c.dur = +(now() - c.t0).toFixed(4);
        if (!c.frames.length) throw new Error(`clip ${name}: no frames (the page never painted?)`);
        writeFileSync(join(dir, 'clip.json'), JSON.stringify(c));
        this.cur = null;
        await cdp.detach().catch(() => {});
        return c;
      },
    };
  }

  #logMouse() { if (this.cur) this.cur.mouse.push({ t: +(now() - this.cur.t0).toFixed(4), x: Math.round(this.mouse.x), y: Math.round(this.mouse.y) }); }

  /** Eased mouse path to the middle of a locator / selector (or a {x, y} point), logged every step. */
  async moveTo(target, { ms = 700, dx = 0, dy = 0 } = {}) {
    let x, y;
    if (target && typeof target === 'object' && 'x' in target) ({ x, y } = target);
    else {
      const loc = typeof target === 'string' ? this.page.locator(target).first() : target;
      await loc.scrollIntoViewIfNeeded();
      const box = await loc.boundingBox();
      if (!box) throw new Error(`moveTo: ${typeof target === 'string' ? target : 'the locator'} has no box`);
      x = box.x + box.width / 2 + dx; y = box.y + box.height / 2 + dy;
    }
    const sx = this.mouse.x, sy = this.mouse.y, steps = Math.max(8, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const k = i / steps, e = ease3(k);
      const arc = Math.sin(Math.PI * k) * Math.min(40, Math.hypot(x - sx, y - sy) * 0.08); // a slight arc, like a hand
      this.mouse = { x: sx + (x - sx) * e, y: sy + (y - sy) * e - arc };
      await this.page.mouse.move(this.mouse.x, this.mouse.y);
      this.#logMouse();
      await sleep(16);
    }
    this.mouse = { x, y };
    this.#logMouse();
  }

  async click(target, opts = {}) {
    if (target) await this.moveTo(target, opts);
    await sleep(120);
    if (this.cur) this.cur.clicks.push({ t: +(now() - this.cur.t0).toFixed(4), x: Math.round(this.mouse.x), y: Math.round(this.mouse.y) });
    await this.page.mouse.down();
    await sleep(90);
    await this.page.mouse.up();
  }

  /** Smooth wheel scroll by dy CSS px over ms. */
  async scroll(dy, ms = 900) {
    const steps = Math.round(ms / 16);
    let done = 0;
    for (let i = 1; i <= steps; i++) {
      const target = Math.round(dy * ease2(i / steps));
      await this.page.mouse.wheel(0, target - done);
      done = target;
      await sleep(16);
    }
  }

  async scrollTo(locator, offset = 120, ms = 900) {
    const y = await this.page.locator(locator).first().evaluate((el, off) => el.getBoundingClientRect().top - off, offset);
    await this.scroll(y, ms);
    await sleep(250);
  }

  /** Click into a field and type like a person (each key logged for the mix's key clicks). */
  async typeInto(target, text, { delay = 45 } = {}) {
    await this.click(target);
    await sleep(250);
    for (const ch of text) {
      if (this.cur) this.cur.keys.push(+(now() - this.cur.t0).toFixed(4));
      await this.page.keyboard.type(ch);
      await sleep(delay);
    }
  }

  async close() { await this.browser.close(); }
}
