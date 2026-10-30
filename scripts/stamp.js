#!/usr/bin/env node
// Rewrites the <stamp> block in app/sw.js: the list of files to cache for
// offline use, and a VERSION hashed from their contents. Run it after
// changing anything in app/ (`npm test` fails until you do).

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const SW = join(APP_DIR, 'sw.js');
const BLOCK = /\/\/ <stamp>\n[\s\S]*?\/\/ <\/stamp>/;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.')) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

/** The <stamp> block that app/sw.js should contain right now. */
export function expectedBlock() {
  const files = walk(APP_DIR)
    .map((p) => relative(APP_DIR, p).split(sep).join('/'))
    .filter((p) => p !== 'sw.js')
    .sort();
  const hash = createHash('sha256');
  for (const file of files) hash.update(file).update('\0').update(readFileSync(join(APP_DIR, file))).update('\0');
  const assets = files.map((file) => `  './${file}',`).join('\n');
  return `// <stamp>\nconst VERSION = '${hash.digest('hex').slice(0, 12)}';\nconst ASSETS = [\n${assets}\n];\n// </stamp>`;
}

export function currentBlock() {
  return readFileSync(SW, 'utf8').match(BLOCK)?.[0] ?? null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sw = readFileSync(SW, 'utf8');
  if (!BLOCK.test(sw)) throw new Error('app/sw.js has no <stamp> block');
  const block = expectedBlock();
  if (currentBlock() === block) console.log('sw.js is already up to date.');
  else {
    writeFileSync(SW, sw.replace(BLOCK, block));
    console.log(`Stamped sw.js: ${block.match(/VERSION = '(\w+)'/)[1]}`);
  }
}
