#!/usr/bin/env node
/** Read-only copy inventory. Full source/PDF-derived inventories stay outside Git. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { JSDOM } from 'jsdom';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const words = text => [...String(text).normalize('NFKC').replace(/\u2019/g, "'").matchAll(/[\p{L}]+(?:'[\p{L}]+)*/gu)].map(match => match[0]);
const normalize = word => word.toLowerCase().replace(/'s$/, '');
const sha = text => createHash('sha256').update(text).digest('hex');
const protectedFile = file => /(?:^|\/)(?:main|characters|sheet-field-lore|[^/]*(?:background|noble)[^/]*)\.(?:js|json)$/.test(file);
const textAttributes = new Set(['title', 'alt', 'aria-label', 'placeholder']);

export function auditScope(file, sourceRecord) {
  if (/^(?:portfolio\/|S3_content\/portfolio\/)/.test(file)) return 'portfolio-excluded';
  if (file === 'S3_content/about.html') return 'retired-page-excluded';
  if (file.startsWith('tools/tile-debugger/')) return 'workbench-inventory-only';
  if (sourceRecord?.sources?.includes('srd5e')) return 'supplemental-language-review';
  if (file === 'S3_content/index.html' || /^S3_content\/(?:src|data|spells)\//.test(file) ||
    /^S3_content\/monsters-\d+\.json$/.test(file) || file === 'S3_content/styles.css') return 'active-gameplay-candidate';
  return 'supporting-code-or-page-inventory';
}

// Check decoded values before normalization: PDF text can contain the same OCR damage.
export function suspiciousGlyphs(text) {
  return [...String(text).matchAll(/[\u02f7\u02f9\ufffd\ufb00-\ufb06\ue000-\uf8ff]|\u00e2\u20ac[\u0153\u009d\u201c\u201d\u2122\u02dc]|\u00ef\u00bf\u00bd/gu)].map(match => ({
    glyph: match[0], codePoint: [...match[0]].map(character => `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(' '),
    offset: match.index,
  }));
}
const technicalString = text => !/[A-Za-z]/.test(text) ||
  /^[a-f0-9-]{20,}$/i.test(text) || /^sha(?:256|512)-/.test(text) ||
  /^[A-Z_][A-Z0-9_]{2,}$/.test(text) ||
  /^[A-Za-z0-9_-]{30,}$/.test(text) ||
  /^[^\s]*\\[bdsw][^\s]*$/.test(text) ||
  /^(?:https?:|data:|\.{0,2}\/|[A-Za-z]:[\\/]|#[\w-]+$)/.test(text) ||
  /^[\w./@-]+\.(?:png|jpg|jpeg|webp|svg|gif|json|js|css|html|pdf|txt|py|mp3|woff2?)$/i.test(text) ||
  /^[a-z][\w]*(?:_[\w]+|[A-Z][\w]+)$/.test(text) ||
  /^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/.test(text) ||
  /^[a-z]+\.[\w.]+$/.test(text) || /^(?:(?:NW|NE|SE|SW|N|E|S|W)[oxwb])+\d*$/i.test(text) ||
  /^(?:org|canal|plr|door|stairs|room|hall|pit|water)-[^\s]+$/.test(text) ||
  /^(?:rgba?|calc)\(/.test(text) ||
  /^(?:[.#][\w-]+|[a-z]+\[[^\]]+\])(?:[ .#>:[\]="'\w-]*)$/.test(text) ||
  /^[a-z]+(?:-[a-z0-9]+){2,}$/.test(text);

async function filesUnder(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || ['node_modules', '.git', 'assets', 'images', 'Source-Art', 'vendor', 'package.json', 'package-lock.json'].includes(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(full));
    else if (/\.(?:html|js|json|css)$/.test(entry.name)) result.push(full);
  }
  return result;
}

export function extractJavaScript(source, parse, file = '', offset = 0) {
  const result = [], ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true });
  function visit(node, parent, key) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Literal' && typeof node.value === 'string' &&
      !((parent?.type === 'Property' || parent?.type === 'MethodDefinition') && key === 'key') &&
      !/^(?:ImportDeclaration|ExportAllDeclaration|ExportNamedDeclaration)$/.test(parent?.type || ''))
      result.push({ file, line: node.loc.start.line + offset, kind: 'js-string', text: node.value,
        context: parent?.type || '', technical: technicalString(node.value) ||
          parent?.type === 'AssignmentExpression' && parent.left?.property?.name === 'className' ||
          parent?.type === 'CallExpression' && parent.arguments?.[0] === node &&
          ['getElementById', 'querySelector', 'querySelectorAll', 'addEventListener', 'removeEventListener',
            'createElement', 'getAttribute', 'removeAttribute', 'getItem', 'setItem'].includes(parent.callee?.property?.name) });
    if (node.type === 'TemplateElement' && node.value.cooked)
      result.push({ file, line: node.loc.start.line + offset, kind: 'js-template-fragment', text: node.value.cooked,
        context: parent?.type || '', technical: technicalString(node.value.cooked) });
    for (const [childKey, value] of Object.entries(node)) {
      if (['loc', 'start', 'end'].includes(childKey)) continue;
      if (Array.isArray(value)) for (const child of value) visit(child, node, childKey);
      else if (value && typeof value === 'object') visit(value, node, childKey);
    }
  }
  visit(ast);
  return result;
}

export function extractHtml(source, file = '') {
  const dom = new JSDOM(source, { includeNodeLocations: true }), result = [];
  const clean = text => text.replace(/{{[\s\S]*?}}|{%[\s\S]*?%}|{#[\s\S]*?#}/g, ' ');
  function visit(node) {
    if (node.nodeType === 3 && !/^(?:SCRIPT|STYLE)$/.test(node.parentElement?.tagName || '')) {
      const text = clean(node.textContent).replace(/\s+/g, ' ').trim();
      if (text) result.push({ file, line: dom.nodeLocation(node)?.startLine || 1, kind: 'html-text', text,
        technical: technicalString(text) || Boolean(node.parentElement?.closest('code, pre')) });
    }
    if (node.nodeType === 1) for (const attribute of node.attributes) {
      if (textAttributes.has(attribute.name) || attribute.name === 'value' && /^(?:submit|button)$/i.test(node.type || '')) {
        const text = clean(attribute.value).trim();
        if (text) result.push({ file, line: dom.nodeLocation(node)?.attrs?.[attribute.name]?.startLine || 1,
          kind: `html-${attribute.name}`, text });
      }
    }
    for (const child of node.childNodes || []) visit(child);
  }
  visit(dom.window.document);
  const scripts = [...dom.window.document.querySelectorAll('script:not([src])')].filter(script =>
    !script.type || /(?:java|ecma)script|module/.test(script.type)).map(script => ({ source: script.textContent,
    offset: dom.nodeLocation(script)?.startTag?.endLine - 1 || 0 }));
  dom.window.close();
  return { records: result, scripts };
}

export function extractJson(source, file = '') {
  const data = JSON.parse(source), result = [];
  const locations = new Map();
  for (const match of source.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
    const value = JSON.parse(match[0]);
    const rest = source.slice(match.index + match[0].length).trimStart();
    if (rest.startsWith(':')) {
      if (/\s|\*\*/.test(value)) result.push({ file, line: source.slice(0, match.index).split('\n').length,
        kind: 'json-display-key', text: value, technical: technicalString(value) });
      continue;
    }
    if (!locations.has(value)) locations.set(value, []);
    locations.get(value).push(match.index);
  }
  function visit(value, trail = [], sourceRecord = null) {
    if (typeof value === 'string') {
      const index = locations.get(value)?.shift() || 0;
      result.push({ file, line: source.slice(0, index).split('\n').length, kind: 'json-value', pointer: trail.join('/'), sourceRecord,
        text: value, technical: technicalString(value) || /(?:^|\/)(?:id|slug|asset|assetKey|generatedFrom|schema|type|kind|key|sourcePath)$/i.test(trail.join('/')) ||
          /(?:^|\/)source\/\d+$/.test(trail.join('/')) });
    } else if (Array.isArray(value)) value.forEach((item, index) => visit(item, [...trail, index], sourceRecord));
    else if (value && typeof value === 'object') {
      if (value.slug && value.name) sourceRecord = { slug: value.slug, name: value.name, sources: value.source || [] };
      for (const [key, item] of Object.entries(value)) visit(item, [...trail, key], sourceRecord);
    }
  }
  visit(data);
  return result;
}

async function main() {
  const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
  if (args.includes('--help')) {
    console.log('node tools/text-spelling-audit.mjs --deps <private npm prefix> --pdf-text <private page JSON> --out <private output folder> [--python <python.exe>] [--suggest]');
    return;
  }
  const deps = path.resolve(option('--deps', path.join(ROOT, '../../.dev/environments/spelling-audit')));
  const out = path.resolve(option('--out', path.join(ROOT, '../../.dev/tests/spelling-audit-20261021')));
  const pdfPath = option('--pdf-text', path.join(ROOT, '../../.dev/maintenance/spelling-20261021/shadowdark-pages.json'));
  const require = createRequire(path.join(deps, 'package.json'));
  const nspell = require('nspell'), acorn = require('acorn');
  const dictionary = (await import(pathToFileURL(require.resolve('dictionary-en')).href)).default;
  const checker = nspell(dictionary), config = JSON.parse(await fs.readFile(path.join(ROOT, 'tools/text-spelling-allowlist.json'), 'utf8'));
  if (!checker.correct('character') || checker.correct('recieve')) throw new Error('English dictionary sanity check failed.');
  const reference = JSON.parse(await fs.readFile(pdfPath, 'utf8')), pdfIndex = new Map();
  for (const page of reference.pages) {
    // Join line-wrap hyphenation, but keep ordinary spaces to avoid inventing words.
    const text = page.text.replace(/([A-Za-z])-\s*\r?\n\s*([A-Za-z])/g, '$1$2');
    for (const word of words(text)) {
      const key = normalize(word);
      if (!pdfIndex.has(key)) pdfIndex.set(key, new Set());
      pdfIndex.get(key).add(page.page);
    }
  }
  const inventory = [], errors = [], fileStats = [], sourceFiles = [];
  for (const root of ['S3_content', 'portfolio', 'templates', 'static', 'tools/tile-debugger']) {
    try { sourceFiles.push(...await filesUnder(path.join(ROOT, root))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const pythonFiles = (await fs.readdir(ROOT)).filter(file => file.endsWith('.py')).map(file => path.join(ROOT, file));
  for (const full of [...new Set(sourceFiles)].sort()) {
    const file = path.relative(ROOT, full).replaceAll('\\', '/'), source = await fs.readFile(full, 'utf8');
    const start = inventory.length;
    try {
      if (file.endsWith('.js')) inventory.push(...extractJavaScript(source, acorn.parse, file));
      else if (file.endsWith('.json')) inventory.push(...extractJson(source, file));
      else if (file.endsWith('.html')) {
        const html = extractHtml(source, file); inventory.push(...html.records);
        for (const script of html.scripts) try { inventory.push(...extractJavaScript(script.source, acorn.parse, file, script.offset)); }
        catch (error) { errors.push({ file, kind: 'inline-script', error: error.message }); }
      } else if (file.endsWith('.css')) for (const match of source.matchAll(/\bcontent\s*:\s*(["'])(.*?)\1/g))
        inventory.push({ file, line: source.slice(0, match.index).split('\n').length, kind: 'css-content', text: match[2] });
    } catch (error) { errors.push({ file, error: error.message }); }
    fileStats.push({ file, sha256: sha(source), bytes: Buffer.byteLength(source), strings: inventory.length - start,
      fixOwnership: protectedFile(file) ? 'parent-owned; report only' : 'audit-owned' });
  }
  const python = option('--python', 'python');
  const script = `import ast,json,sys\nresult=[]\nfor file in sys.argv[1:]:\n try:\n  source=open(file,encoding='utf-8-sig').read(); tree=ast.parse(source)\n  result.extend({'file':file,'line':n.lineno,'kind':'python-string','text':n.value} for n in ast.walk(tree) if isinstance(n,ast.Constant) and isinstance(n.value,str))\n except Exception as e: result.append({'file':file,'error':str(e)})\nprint(json.dumps(result))`;
  const extracted = spawnSync(python, ['-c', script, ...pythonFiles], { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (extracted.status !== 0) throw new Error(`Python AST extraction failed: ${extracted.stderr || extracted.error}`);
  for (const item of JSON.parse(extracted.stdout)) {
    item.file = path.relative(ROOT, item.file).replaceAll('\\', '/');
    if (item.error) errors.push(item);
    else inventory.push({ ...item, technical: technicalString(item.text) });
  }
  for (const full of pythonFiles) {
    const source = await fs.readFile(full, 'utf8'), file = path.basename(full);
    fileStats.push({ file, sha256: sha(source), bytes: Buffer.byteLength(source), strings: inventory.filter(item => item.file === file).length,
      fixOwnership: 'audit-owned' });
  }
  console.error(`Inventoried ${inventory.length} strings in ${fileStats.length} files; checking dictionary and PDF evidence.`);
  const glyphFindings = [], scopes = {};
  for (const item of inventory) {
    item.scope = auditScope(item.file, item.sourceRecord);
    scopes[item.scope] = (scopes[item.scope] || 0) + 1;
    for (const glyph of suspiciousGlyphs(item.text)) glyphFindings.push({ file: item.file, line: item.line,
      pointer: item.pointer, scope: item.scope, ...glyph, text: item.text.slice(Math.max(0, glyph.offset - 45), glyph.offset + 65) });
  }
  const approvedWords = new Map();
  for (const [file, reason] of Object.entries(config.approvedDataFiles)) for (const item of inventory.filter(item => item.file === file))
    for (const word of words(item.text)) approvedWords.set(normalize(word), reason);
  const proper = new Map(Object.entries(config.properNames).map(([word, reason]) => [normalize(word), reason]));
  const terms = new Map(Object.entries(config.terms).map(([word, reason]) => [normalize(word), reason]));
  const acronym = new Map(Object.entries(config.acronyms).map(([word, reason]) => [normalize(word), reason]));
  const technicalTerms = new Map(Object.entries(config.technicalTerms || {}).map(([word, reason]) => [normalize(word), reason]));
  const cache = new Map(), findings = new Map(), categories = {};
  for (const item of inventory) {
    if (item.technical && !proper.has(normalize(item.text)) && !acronym.has(normalize(item.text)) &&
      !Object.hasOwn(config.approvedDataFiles, item.file)) { item.classification = 'technical-identifier'; continue; }
    item.tokens = [];
    for (const word of words(item.text)) {
      const key = normalize(word);
      const customFile = Object.hasOwn(config.approvedDataFiles, item.file);
      const cacheKey = customFile ? `approved-file:${key}` : key;
      let decision = cache.get(cacheKey);
      if (!decision) {
        if (proper.has(key)) decision = { category: 'allowlisted-proper-name', reason: proper.get(key) };
        else if (acronym.has(key)) decision = { category: 'acronym', reason: acronym.get(key) };
        else if (terms.has(key)) decision = { category: 'allowlisted-project-term', reason: terms.get(key) };
        else if (technicalTerms.has(key)) decision = { category: 'technical-term', reason: technicalTerms.get(key) };
        else if (checker.correct(word) || checker.correct(key) || checker.correct(key.charAt(0).toUpperCase() + key.slice(1))) decision = { category: 'dictionary' };
        else if (customFile && approvedWords.has(key)) decision = { category: 'user-approved-custom', reason: approvedWords.get(key) };
        else if (pdfIndex.has(key)) decision = { category: 'pdf-attested', pdfPages: [...pdfIndex.get(key)] };
        else if ([key.replace(/s$/, ''), key.replace(/es$/, ''), key.replace(/ed$/, ''), key.replace(/ing$/, ''),
          key.replace(/ing$/, 'e'), key.replace(/ed$/, 'e')].some(base => base !== key && pdfIndex.has(base))) {
          const base = [key.replace(/s$/, ''), key.replace(/es$/, ''), key.replace(/ed$/, ''), key.replace(/ing$/, ''),
            key.replace(/ing$/, 'e'), key.replace(/ed$/, 'e')].find(base => base !== key && pdfIndex.has(base));
          decision = { category: 'pdf-attested-inflection', base, pdfPages: [...pdfIndex.get(base)] };
        }
        else if (/^[A-Z]$/.test(word) || key.length === 1) decision = { category: 'single-letter-or-fragment' };
        else decision = { category: 'unresolved', suggestions: args.includes('--suggest') && key.length <= 20 ? checker.suggest(key).slice(0, 5) : [] };
        cache.set(cacheKey, decision);
      }
      item.tokens.push({ word, ...decision });
      categories[decision.category] = (categories[decision.category] || 0) + 1;
      if (decision.category !== 'dictionary') {
        const findingKey = `${decision.category}:${key}`;
        if (!findings.has(findingKey)) findings.set(findingKey, { word: key, forms: new Set(), ...decision, occurrences: [] });
        const finding = findings.get(findingKey); finding.forms.add(word);
        finding.occurrences.push({ file: item.file, line: item.line, kind: item.kind, pointer: item.pointer,
          sourceRecord: item.sourceRecord, scope: item.scope,
          text: item.text.slice(0, 260), fixOwnership: protectedFile(item.file) ? 'parent-owned; report only' : 'audit-owned' });
      }
    }
  }
  const reviewGroup = occurrence => {
    if (occurrence.sourceRecord?.sources?.includes('srd5e')) return 'supplemental-source-not-validated-by-core-PDF';
    if (/monsters-\d+\.json$/.test(occurrence.file) && /Monster Name/.test(occurrence.pointer || '') ||
      /monsters\/\d+\/name$/.test(occurrence.pointer || '')) return 'original-creature-name-review';
    if (/mcc-random-generator/.test(occurrence.file)) return 'separate-MCC-portfolio-terminology-review';
    if (/\/tags\/|\/movement$/.test(occurrence.pointer || '')) return 'data-tag-or-mechanical-identifier-review';
    if (occurrence.file.endsWith('/treasure.js')) return 'equipment-and-instrument-vocabulary-review';
    if (protectedFile(occurrence.file)) return 'parent-owned-copy-review';
    if (occurrence.kind === 'json-display-key') return 'data-label-review';
    return 'other-prose-or-technical-candidate-review';
  };
  for (const finding of findings.values()) if (finding.category === 'unresolved')
    finding.reviewGroups = [...new Set(finding.occurrences.map(reviewGroup))];
  const result = { generatedAt: new Date().toISOString(), sourceRoot: ROOT,
    dictionary: { engine: 'nspell', engineVersion: require('nspell/package.json').version,
      package: 'dictionary-en', version: JSON.parse(await fs.readFile(path.join(path.dirname(require.resolve('dictionary-en')), 'package.json'), 'utf8')).version,
      sha256: sha(dictionary.dic), affixSha256: sha(dictionary.aff) },
    pdf: { source: reference.source, sha256: reference.sha256, pages: reference.pages.length, indexing: reference.extraction },
    summary: { files: fileStats.length, records: inventory.length, categories,
      uniqueWords: new Set([...cache.keys()].map(key => key.replace(/^approved-file:/, ''))).size,
      technicalRecords: inventory.filter(item => item.classification === 'technical-identifier').length,
      scopes, suspiciousGlyphs: glyphFindings.length,
      unresolved: [...findings.values()].filter(item => item.category === 'unresolved').length },
    extractionErrors: errors, suspiciousGlyphs: glyphFindings, files: fileStats,
    findings: [...findings.values()].map(finding => ({ ...finding, forms: [...finding.forms] })).sort((a, b) => a.word.localeCompare(b.word)) };
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(out, 'inventory.json'), JSON.stringify(inventory, null, 2));
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(result, null, 2));
  const unresolved = result.findings.filter(item => item.category === 'unresolved');
  await fs.writeFile(path.join(out, 'unresolved.tsv'), ['word\tcount\tsuggestions\tfirst-file\tline\tcontext', ...unresolved.map(item => {
    const first = item.occurrences[0]; return [item.word, item.occurrences.length, item.suggestions.join(', '), first.file, first.line, first.text.replace(/[\t\r\n]+/g, ' ')].join('\t');
  })].join('\n'));
  console.log(JSON.stringify({ ...result.summary, extractionErrors: errors, output: out }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
