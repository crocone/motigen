// `motigen init <template> <dir>`: copies templates/<template> into dir and fills {{name}} from the folder name.
import { cp, readdir, readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve, basename, relative } from 'node:path';

export const TEMPLATES_ROOT = resolve(fileURLToPath(new URL('../templates/', import.meta.url)));
const TEXT = /\.(html|js|css|json|txt|md|svg)$/i;

export async function listTemplates() {
  return (await readdir(TEMPLATES_ROOT, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name);
}

export async function init(template, dir, { force = false } = {}) {
  const src = join(TEMPLATES_ROOT, template);
  if (!existsSync(src)) throw new Error(`no template "${template}" (have: ${(await listTemplates()).join(', ')})`);
  const dest = resolve(dir);
  if (existsSync(dest) && (await readdir(dest)).length && !force) throw new Error(`${dest} is not empty (use --force to write into it)`);
  await mkdir(dest, { recursive: true });
  await cp(src, dest, { recursive: true, force: true });
  // npm drops .gitignore files from packages, so templates carry it as "gitignore"
  if (existsSync(join(dest, 'gitignore'))) await rename(join(dest, 'gitignore'), join(dest, '.gitignore'));
  const name = basename(dest);
  const files = [];
  async function walk(d) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) { await walk(f); continue; }
      files.push(relative(dest, f).replace(/\\/g, '/'));
      if (TEXT.test(e.name)) {
        const s = await readFile(f, 'utf8');
        if (s.includes('{{name}}')) await writeFile(f, s.replaceAll('{{name}}', name));
      }
    }
  }
  await walk(dest);
  return files.sort();
}
