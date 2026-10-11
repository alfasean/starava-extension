// Renders public/icons/icon.svg into the PNG sizes Chrome expects.
// Usage: npm run icons
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const here = path.dirname(fileURLToPath(import.meta.url));
const iconDir = path.join(here, '..', 'public', 'icons');

const svg = await readFile(path.join(iconDir, 'icon.svg'), 'utf8');
await mkdir(iconDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  await writeFile(path.join(iconDir, `icon${size}.png`), png);
  console.log(`wrote public/icons/icon${size}.png (${png.length} bytes)`);
}
