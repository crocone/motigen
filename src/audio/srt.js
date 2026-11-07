// Subtitles from the voice cues: one cue per line, timed by events.json and the line durations in vo.json.
// `spellings` puts written forms back where the TTS text spelled things out: [["Acme Cloud dot com", "acmecloud.com"], …].
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ts = t => `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t % 3600 / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')},${String(Math.round(t % 1 * 1000) % 1000).padStart(3, '0')}`;

export function srt(events, vo, { spellings = [] } = {}) {
  const lines = Array.isArray(vo) ? vo : vo.lines;
  const meta = Object.fromEntries(lines.map(m => [m.id, m]));
  const rows = [];
  let i = 1;
  for (const v of [...(events.vo || [])].sort((a, b) => a.t - b.t)) {
    const m = meta[v.id];
    if (!m) throw new Error(`srt: no line ${v.id} in vo.json`);
    let text = m.text;
    for (const [a, b] of spellings) text = text.split(a).join(b);
    rows.push(`${i++}\n${ts(v.t)} --> ${ts(v.t + m.dur)}\n${text}\n`);
  }
  return rows.join('\n');
}

export async function writeSrt({ dir, out, spellings }) {
  const events = JSON.parse(await readFile(join(dir, 'events.json'), 'utf8'));
  const vo = JSON.parse(await readFile(join(dir, 'vo', 'vo.json'), 'utf8'));
  const s = srt(events, vo, { spellings });
  await writeFile(out, s, 'utf8');
  return { out, cues: (events.vo || []).length };
}
