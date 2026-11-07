#!/usr/bin/env node
import { main } from '../src/cli.js';

main(process.argv.slice(2)).catch(e => {
  console.error(process.env.MOTIGEN_DEBUG ? e?.stack || e : `motigen: ${e?.message || e}`);
  process.exit(1);
});
