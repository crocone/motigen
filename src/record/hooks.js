// Module hook for `motigen record`: a take script imports 'motigen/record' (or 'motigen', 'motigen/audio'…) and
// gets this installation of the package, whether it is a project dependency or a global install.
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

export async function resolve(specifier, context, next) {
  if (specifier === pkg.name || specifier.startsWith(pkg.name + '/')) {
    const sub = specifier === pkg.name ? '.' : './' + specifier.slice(pkg.name.length + 1);
    const target = pkg.exports[sub];
    if (!target) throw new Error(`${specifier}: no such export (have ${Object.keys(pkg.exports).join(', ')})`);
    return { url: new URL(target, root).href, shortCircuit: true };
  }
  return next(specifier, context);
}
