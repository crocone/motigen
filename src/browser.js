// Headless Chromium set up for deterministic frames: sRGB colours, no scrollbars, no background throttling.
// GPU flags are on by default on Windows (the source pipeline rendered its canvas films through D3D11); on other
// platforms Playwright's defaults are kept unless `gpu` is set.
import { chromium } from 'playwright';

export const DEFAULT_ARGS = [
  '--force-color-profile=srgb',
  '--hide-scrollbars',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
];

export function gpuArgs(platform = process.platform) {
  const a = ['--enable-gpu', '--ignore-gpu-blocklist'];
  if (platform === 'win32') a.push('--use-angle=d3d11');
  return a;
}

/**
 * @param {object} [o]
 * @param {string} [o.channel]  'chrome' | 'msedge' | 'chromium' (default: Playwright's own Chromium)
 * @param {boolean} [o.gpu]     default: true on Windows
 * @param {boolean} [o.headless]
 * @param {string[]} [o.args]
 */
export async function launch({ channel, gpu = process.platform === 'win32', headless = true, args = [] } = {}) {
  return chromium.launch({ channel: channel || undefined, headless, args: [...DEFAULT_ARGS, ...(gpu ? gpuArgs() : []), ...args] });
}

/** A context with the film's viewport. `scale` 2 gives 2x stills (the video stays at 1). */
export async function newContext(browser, { width = 1920, height = 1080, scale = 1, colorScheme = 'light' } = {}) {
  return browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, colorScheme, reducedMotion: 'no-preference' });
}
