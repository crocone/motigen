// `.env` in the project folder (and in the current folder): KEY=value lines into process.env, without overriding
// what the shell already set. The ElevenLabs key lives there in a project: ELEVENLABS_API_KEY=…
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1).replace(/\\n/g, '\n');
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

/** Load <dir>/.env (first) and ./.env (second) into process.env; existing variables win. Returns what was loaded. */
export function loadEnv(...dirs) {
  const loaded = {};
  for (const dir of [...dirs, process.cwd()]) {
    const f = join(dir, '.env');
    if (!existsSync(f)) continue;
    for (const [k, v] of Object.entries(parseEnv(readFileSync(f, 'utf8')))) if (process.env[k] == null) { process.env[k] = v; loaded[k] = f; }
  }
  return loaded;
}
