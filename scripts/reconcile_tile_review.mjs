import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { reconcileShadowReview } from '../tools/tile-debugger/review-reconciliation.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true,
  options: { 'accept-reviewed-baseline': { type: 'boolean', default: false } } });
const [catalogUrl, baselinePath, artistEvidencePath, output, ...inputs] = positionals;
if (!inputs.length) throw Error('Usage: node scripts/reconcile_tile_review.mjs catalog-url baseline-study.json artist-evidence.json output.json exports.json [...] [--accept-reviewed-baseline]');
if (existsSync(output)) throw Error('Preserve earlier analysis; choose a new output.');
const load = path => {
  const bytes = readFileSync(path);
  return { value: JSON.parse(bytes), file: basename(path), sha256: createHash('sha256').update(bytes).digest('hex') };
};
const baseline = load(baselinePath), evidence = load(artistEvidencePath), exports = inputs.map(load);
const {assets} = await (await fetch(catalogUrl)).json();
const result = reconcileShadowReview(baseline.value.pages[0].shadowRules,
  exports.map(item => ({ name: item.file, scene: item.value })), assets,
  { acceptBaseline: values['accept-reviewed-baseline'] });
writeFileSync(output, JSON.stringify({ version: 1, ...result, lightAnnotations: evidence.value.lightAnnotations,
  approval: values['accept-reviewed-baseline'] ? {
    date: '2026-10-11', basis: 'Artist reported lighting almost perfect, made corrections and exported the corrected work; accept unchanged drafts as reviewed, without changing path authorship.'
  } : null,
  sources: [baseline, evidence, ...exports].map(({file,sha256}) => ({file,sha256})) }, null, 2) + '\n');
console.log(JSON.stringify({ rules: Object.keys(result.rules).length, changes: result.changes,
  recoveredDeletions: result.recoveredDeletions, pending: result.pending }, null, 2));
