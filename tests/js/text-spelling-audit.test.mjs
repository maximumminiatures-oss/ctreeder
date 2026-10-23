import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractHtml, extractJson, extractJavaScript, auditScope, suspiciousGlyphs } from '../../tools/text-spelling-audit.mjs';

test('HTML inventory includes text and accessibility copy, but not CSS, scripts, paths or Jinja expressions', () => {
  const source = '<title>ShadowSpawner</title>\n<button title="Light torch">Cast {{ spell.name }}</button>' +
    '<img alt="Dungeon map" src="assets/map.png"><style>.badclas { color:red }</style><script>const x="message";</script>';
  const { records, scripts } = extractHtml(source, 'page.html');
  assert.deepEqual(records.map(record => record.text), ['ShadowSpawner', 'Light torch', 'Cast', 'Dungeon map']);
  assert.ok(records.every(record => record.file === 'page.html'));
  assert.equal(records[1].line, 2); assert.equal(scripts.length, 1);
  assert.equal(scripts[0].source, 'const x="message";');
});

test('JSON inventory retains pointers and line locations without treating generated asset filenames as prose', () => {
  const source = '{\n  "name": "Kragol",\n  "description": "A strange creature.",\n  "asset": "org-free-NWx.png",\n  "paragraphs": ["A strange creature."]\n}';
  const records = extractJson(source, 'creatures.json');
  assert.equal(records.length, 4);
  assert.deepEqual(records.map(record => record.pointer), ['name', 'description', 'asset', 'paragraphs/0']);
  assert.deepEqual(records.map(record => record.line), [2, 3, 4, 5]);
  assert.equal(records[2].technical, true); assert.equal(records[1].technical, false);
});

test('JavaScript AST inventory preserves static template fragments and omits module paths and object keys', () => {
  const literal = (value, line) => ({ type: 'Literal', value, loc: { start: { line } } });
  const ast = { type: 'Program', body: [
    { type: 'ImportDeclaration', source: literal('./module.js', 1) },
    { type: 'Property', key: literal('internalKey', 2), value: literal('Spell failed.', 2) },
    { type: 'TemplateLiteral', quasis: [{ type: 'TemplateElement', value: { cooked: ' attacks the monster.' }, loc: { start: { line: 3 } } }], expressions: [] }
  ] };
  const records = extractJavaScript('', (_, settings) => { assert.equal(settings.ecmaVersion, 'latest'); return ast; }, 'game.js', 4);
  assert.deepEqual(records.map(record => record.text), ['Spell failed.', ' attacks the monster.']);
  assert.deepEqual(records.map(record => record.line), [6, 7]);
});

test('scope classification excludes portfolio, retired pages and supplemental language records from gameplay fixes', () => {
  assert.equal(auditScope('portfolio/index.html'), 'portfolio-excluded');
  assert.equal(auditScope('S3_content/portfolio/index.html'), 'portfolio-excluded');
  assert.equal(auditScope('S3_content/about.html'), 'retired-page-excluded');
  assert.equal(auditScope('S3_content/data/shadowdark-content.json', { sources: ['srd5e'] }), 'supplemental-language-review');
  assert.equal(auditScope('S3_content/src/rest.js'), 'active-gameplay-candidate');
});

test('damaged glyph checks inspect decoded JSON even if the dictionary or PDF would attest the damaged word', () => {
  const [record] = extractJson('{"description":"seven \\u02f9anges, \\u02f7 and \\ufffd; \\ufb02owing"}');
  assert.deepEqual(suspiciousGlyphs(record.text).map(item => item.codePoint), ['U+02F9', 'U+02F7', 'U+FFFD', 'U+FB02']);
  assert.deepEqual(suspiciousGlyphs('Rüstung, spell’s effect, 1–4'), []);
  assert.equal(suspiciousGlyphs('\u00e2\u20ac\u0153')[0].codePoint, 'U+00E2 U+20AC U+0153');
});

test('active treasure prose keeps corrected PDF spellings without changing rule values', async () => {
  const contentText = await readFile(new URL('../../S3_content/data/shadowdark-content.json', import.meta.url), 'utf8');
  const content = JSON.parse(contentText);
  const values = [];
  function visit(value) {
    if (typeof value === 'string') values.push(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  }
  visit(content);
  assert.ok(values.includes('Desiccated. Can be damaged by fire. Takes x2 damage from it.'));
  assert.ok(values.some(text => text.includes('flowing mane') && text.includes('morale check')));
  assert.ok(values.some(text => text.includes('seven flanges') && text.includes('double damage against creatures with lycanthropy')));
  assert.deepEqual(suspiciousGlyphs(contentText), []);
  const treasure = await readFile(new URL('../../S3_content/src/treasure.js', import.meta.url), 'utf8');
  assert.match(treasure, /DIVINE_SUFFIXES = Object\.freeze\(\["Saint Terragnis"/);
  const monsters = JSON.parse(await readFile(new URL('../../S3_content/monsters-2.json', import.meta.url), 'utf8'));
  const zombie = monsters.find(monster => monster['Monster Name'] === 'Zombie');
  assert.ok(zombie.abilities['**Relentless**'].startsWith('If zombie reduced to 0 HP by a non-magical source, DC 15 CON to go to 1 HP instead.'));
  assert.deepEqual(suspiciousGlyphs(JSON.stringify(zombie)), []);
});

test('American cancellation copy preserves multiplayer protocol identifiers', async () => {
  const load = name => readFile(new URL(`../../S3_content/src/${name}.js`, import.meta.url), 'utf8');
  const rest = await load('rest'), multiplayer = await load('multiplayer'), saves = await load('save-menus');
  assert.ok(rest.includes('Rest canceled. No recovery was granted.'));
  assert.ok(multiplayer.includes('Dungeon request canceled.'));
  assert.ok(multiplayer.includes("cancelled.code = 'request_cancelled'"));
  assert.ok(saves.includes("proposal.status === 'cancelled'"));
  assert.ok(saves.includes('Group confirmation canceled. Please start it again.'));
});
