// Module hook for `motigen record`: a take script imports 'motigenjs/record' (or 'motigenjs', 'motigenjs/audio'…)
// and gets this installation of the package, whether it is a project dependency or a global install. The short
// name 'motigen/record' is accepted too, for scripts written with the command's name.
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const NAMES = [pkg.name, 'motigen'];

export async function resolve(specifier, context, next) {
  const name = NAMES.find(n => specifier === n || specifier.startsWith(n + '/'));
  if (name) {
    const sub = specifier === name ? '.' : './' + specifier.slice(name.length + 1);
    const target = pkg.exports[sub];
    if (!target) throw new Error(`${specifier}: no such export (have ${Object.keys(pkg.exports).join(', ')})`);
    return { url: new URL(target, root).href, shortCircuit: true };
  }
  return next(specifier, context);
}
