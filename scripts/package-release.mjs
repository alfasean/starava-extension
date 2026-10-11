// Zips dist/ into release/strava-run-analyzer-v<version>.zip for GitHub Releases.
// Run via: npm run package (builds first).
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const outDir = path.join(root, 'release');

const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'));
const name = `strava-run-analyzer-v${manifest.version}`;

const files = {};
async function walk(dir, prefix) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = `${prefix}${entry.name}`;
    if (entry.isDirectory()) await walk(abs, `${rel}/`);
    else files[rel] = await readFile(abs);
  }
}
// Everything lives under one top-level folder so "Extract here" yields a
// ready-to-load-unpacked directory instead of loose files.
await walk(dist, `${name}/`);

await mkdir(outDir, { recursive: true });
const out = path.join(outDir, `${name}.zip`);
await writeFile(out, zipSync(files, { level: 9 }));
console.log(`wrote ${path.relative(root, out)} (${Object.keys(files).length} files)`);
