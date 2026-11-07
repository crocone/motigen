// A clean "laptop" for a take: a fresh container with the take folder mounted at /share. Your scenario then
// installs and runs whatever the guide shows, on a machine with nothing of yours on it.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sleep } from './term.js';

/**
 * @param {object} o
 * @param {string} o.share        host folder mounted at /share (the Term's dir)
 * @param {string} [o.name]       container name, default motigen-take (an old one with that name is removed)
 * @param {string} [o.image]      default debian:bookworm-slim (has `script`); build your own with the tools the guide needs
 * @param {string[]} [o.args]     extra `docker run` arguments (--network, -v volumes, -e …)
 * @param {string} [o.setup]      a shell script path on the host, copied via /share and run inside before the take
 */
export function freshContainer({ share, name = 'motigen-take', image = 'debian:bookworm-slim', args = [], setup } = {}) {
  if (!share) throw new Error('freshContainer: share folder is required');
  const host = resolve(share).replace(/\\/g, '/');
  try { execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' }); } catch { /* none to remove */ }
  execFileSync('docker', ['run', '-d', '--name', name, '--hostname', 'laptop', '-v', `${host}:/share`, ...args, image, 'sleep', 'infinity'], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (setup) {
    const f = resolve(setup);
    if (!existsSync(f)) throw new Error(`setup script not found: ${f}`);
    execFileSync('docker', ['exec', name, 'sh', '-c', readFileSync(f, 'utf8')], { stdio: 'inherit' });
  }
  return { name, exec: (cmd) => execFileSync('docker', ['exec', name, 'sh', '-c', cmd], { encoding: 'utf8' }), remove: () => { try { execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' }); } catch { /* gone */ } } };
}

/** Wait for a file to get a non-empty last line (a CLI inside the container handing a URL to the driver, say). */
export async function waitFile(path, timeout = 30000) {
  const end = Date.now() + timeout;
  for (;;) {
    const s = existsSync(path) ? readFileSync(path, 'utf8').trim() : '';
    if (s) return s.split('\n').pop();
    if (Date.now() > end) throw new Error(`nothing in ${join(path)} after ${timeout} ms`);
    await sleep(100);
  }
}
