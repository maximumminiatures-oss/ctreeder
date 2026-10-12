import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildTileStudy } from '../tools/tile-debugger/study.mjs';
import { LEARNED_TILE_RULES } from '../tools/tile-debugger/learned-rules.mjs';

const [catalogUrl, output] = process.argv.slice(2);
if (!catalogUrl || !output) throw new Error('Usage: node scripts/build_tile_study.mjs catalog-url output.json');
const response = await fetch(catalogUrl);
if (!response.ok) throw new Error('Cannot read the local catalog.');
const { assets } = await response.json();
const id = resolve(output).split(/[\\/]/).pop().replace(/\.json$/, '');
const study = buildTileStudy(assets, LEARNED_TILE_RULES, id);
mkdirSync(dirname(resolve(output)), { recursive: true });
writeFileSync(output, JSON.stringify(study, null, 2) + '\n');
console.log(JSON.stringify({ output: resolve(output), assets: study.unknownAssets.length,
  pages: study.pages.length, placements: study.pages.reduce((n, page) => n + page.placements.length, 0) }, null, 2));
