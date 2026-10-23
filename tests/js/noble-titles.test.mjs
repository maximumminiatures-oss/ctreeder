import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../../S3_content/data/noble-titles.json', import.meta.url), 'utf8'));

// Approved source notation is deliberately independent of the JSON representation.
const approvedTable = `England & Western Feudal Ranks|2
Monarch ()|.1; Sovereign ()|.1; () [the] heir apparent|.25; Crown Prince ()|.25; Crown Princess ()|.25; Castellan ()|2; Vogt ()|2; Constable ()|2; Marshal ()|2; Steward ()|2; Seneschal ()|2; Chamberlain ()|2; Justiciar ()|2; Potentate ()|2; Banneret ()|2; Palatine ()|2; Chancellor ()|2; Burgrave ()|2; () [a] peer|2; Emperor ()|.05; Empress ()|.05; King ()|.1; Queen ()|.1; Archduke ()|.2; Archduchess ()|.2; Grand Duke ()|.2; Grand Duchess ()|.2; Duke ()|.5; Duchess ()|.5; Prince ()|.25; Princess ()|.25; Marquess ()|.7; Marchioness ()|.7; Margrave ()|.8; Margravine ()|.8; Count ()|1; Countess ()|1; Earl ()|1; Landgrave ()|1; Landgravine ()|1; Viscount ()|1.5; Viscountess ()|1.5; Baron ()|2; Baroness ()|2; Baronet ()|3; Baronetess ()|3; Dame ()|4; Sir ()|4
Indian Subcontinent|1
Samrat ()|.05; Chhatrapati ()|.05; Maharaja ()|.2; Maharani ()|.2; Raja ()|.5; Rani ()|.5; Yuvaraja ()|.3; Nawab ()|1; Subahdar ()|1.5; Mansabdar ()|3; Kotwal ()|3; Thakur ()|4; Nayaka ()|4; Jagirdar ()|5; () [the] kshatriya|5; Zamindar ()|8
Mesoamerican|1
Huey Tlatoani ()|.05; Kaloomte' ()|.1; Cihuacoatl ()|.1; Tlatoani ()|.3; K'uhul Ajaw ()|.3; Iya ()|.5; Ajaw ()|.7; Tlacateccatl ()|1.5; Tlacochcalcatl ()|1.5; Sajal ()|2; Teuctli ()|4; () [the] pilli|7
Arabian & Levantine|1
Caliph ()|.05; Sultan ()|.1; Malik ()|.3; Malika ()|.3; Amir al-Umara ()|.5; Vizier ()|.8; Hajib ()|1; Na'ib ()|1.5; Wali ()|2; Emir ()|2; () [the] muqta|4; Sheikh ()|6
Egyptian|1
Atabeg al-Asakir ()|.1; Ustadar ()|.3; Dawadar ()|.3; Amir Majlis ()|.5; Silahdar ()|.5; Amir Akhur ()|.5; Amir Mi'a ()|1; Amir Tablkhana ()|2; Muqaddam ()|3; Amir Ashara ()|4
West African|1
Kaya Magan ()|.05; Mansa ()|.05; Askia ()|.1; Buurba ()|.2; Alaafin ()|.2; Oba ()|.4; Bashorun ()|.5; Balama ()|1; Dina Tigi ()|1; Korey Farma ()|1; Farba ()|2; Oloye ()|5
Ethiopian|1
Negusa Nagast ()|.05; Itegue ()|.05; Enderase ()|.2; Bitwoded ()|.2; Negus ()|.3; Ras ()|.8; Mesfin ()|1; Balambaras ()|1.5; Fitawrari ()|2; Dejazmach ()|2; Gerazmach ()|2.5; Qenyazmach ()|2.5
Byzantine|1
Basileus ()|.05; Basilissa ()|.05; Autokrator ()|.05; Caesar ()|.1; Sebastokrator ()|.1; Panhypersebastos ()|.2; Megas Doux ()|.3; Megas Domestikos ()|.3; Despot ()|.5; Katepano ()|1; Stratopedarches ()|1.5; Doux ()|2; Droungarios ()|2.5; Tourmarches ()|4
Turkish|1
Padishah ()|.05; Khagan ()|.05; Atabeg ()|.3; Beylerbey ()|.8; Sanjakbey ()|1.5; Qadi ()|2; Subasi ()|2.5; () [the] timariot|2.5; Bey ()|3; Agha ()|3; Zaim ()|4
Chinese (Qing Dynasty)|1
Huangdi ()|.05; Huanghou ()|.05; Taizi ()|.1; Wang ()|.4; Beile ()|.8; Beizi ()|1; Zongdu ()|1; Gong ()|1.5; Xunfu ()|1.5; Tidu ()|2; Jiangjun ()|3; Zongbing ()|3; Zhixian ()|6; () [the] shi|8; () [a] shengyuan|8
Japanese|1
Tenno ()|.05; Shogun ()|.05; Sessho ()|.1; Kanpaku ()|.1; Daijo-daijin ()|.2; Sadaijin ()|.3; Udaijin ()|.3; Shugo ()|1; Daimyo ()|2; () [of the] kuge|2.5; Jito ()|4; Gokenin ()|5; () [the] samurai|8
Korean|1
Taewang ()|.05; Wangbi ()|.05; Wangseja ()|.1; Yeonguijeong ()|.2; Jwauijeong ()|.3; Uuijeong ()|.3; Daegun ()|.5; Gongju ()|.5; Gun ()|1; Gwanchalsa ()|1.5; () [of the] yangban|5; () [the] musa|7
Italian|1
Doge ()|.05; Dogaressa ()|.05; Gonfaloniere ()|.3; Podesta ()|1; Capitano del Popolo ()|1; Signore ()|1.5; Priore ()|2; Alfiere ()|2; Condottiero ()|3; Patrizio ()|4; Cavaliere ()|5
German & Holy Roman Empire|1
Kurfürst ()|.2; Kurfürstin ()|.2; Reichserbschenk ()|.5; Reichsgraf ()|1; Freiherr ()|1.5; Freifrau ()|1.5; Burggraf ()|1.5; Altgraf ()|1.5; Wildgraf ()|1.5; Raugraf ()|1.5; Edler ()|3; Ritter ()|4
French|1
Dauphin ()|.1; Dauphine ()|.1; () [a] pair de France|.5; Grand Fauconnier ()|.5; Grand Louvetier ()|.5; Grand Panetier ()|.5; Vidame ()|1; Vicomte ()|1.5; Sire ()|2; Prevot ()|2.5; Ecuyer ()|3; Chevalier ()|4
Spanish & Portuguese|1
Príncipe de Asturias ()|.1; () [a] grande de España|.5; Adelantado ()|.8; Infante ()|1; Infanta ()|1; Alferez ()|1.5; Rico-hombre ()|2; Alcalde ()|2.5; Alguacil ()|3; Fidalgo ()|4; Hidalgo ()|5; Caballero ()|5
Irish|1
Ard Ri ()|.05; Tanist ()|.2; Ri Coicid ()|.3; Ri Tuaithe ()|.8; Brehon ()|1.5; Ollamh ()|1.5; Briugu ()|2; Flaith ()|2.5; Aire Febe ()|3; Aire ()|4; Aire Desa ()|4; () [of the] derbfine|4; () [the] kern|5
Scottish|1
Mormaer ()|.4; Baron of Regality ()|.8; Thane ()|1; Deemster ()|1; Toisech ()|1.5; () [the] hose-net holder|1.5; Baillie ()|2.5; () [the] tacksman|3; Laird ()|4
Scandinavian|1
Konungr ()|.1; Dronning ()|.1; Jarl ()|.5; Lagman ()|1; Godi ()|1.5; Hersir ()|2; Lendmann ()|2.5; Bryti ()|2.5; Riddari ()|4; () [the] hirdmann|5; () [the] sveinn|6
Slavic & Russian|1
Tsar ()|.05; Tsaritsa ()|.05; Tsarevich ()|.1; Tsarevna ()|.1; Velikiy Knyaz ()|.3; Knyaz ()|.8; Okolnichi ()|1; Posadnik ()|1; Tysyatsky ()|1.5; Voivode ()|2; Boyar ()|2; Dyak ()|3; () [the] deti boyarskie|4; () [the] druzhinnik|6
Caucasian|1
Mepe ()|.05; Tagavor ()|.05; Eristavt-Eristavi ()|.2; Spaspet ()|.3; Sparapet ()|.3; Mtavari ()|.5; Ishkhan ()|.8; Eristavi ()|1; Nakharar ()|1.5; Sepuh ()|2.5; Aznauri ()|4
Central Asian & Steppe Nomadic|1
Khagan ()|.05; Khatun ()|.05; Khan ()|.3; Ilkhan ()|.4; Yabgu ()|.5; Khong Tayiji ()|.8; Shad ()|1; Beki ()|1; Noyan ()|2; Tarkhan ()|3; Baga'atur ()|5
Southeast Asian|1
Devaraja ()|.05; Yuvarat ()|.1; Upayuvraja ()|.2; Chao Phraya ()|.5; Rakryan ()|1; Phraya ()|1.5; Datu ()|2; Phra ()|2.5; Luang ()|3.5`;
const approvedLines = approvedTable.split('\n');
const approved = [];
for (let index = 0; index < approvedLines.length; index += 2) {
  const [name, weight] = approvedLines[index].split('|');
  approved.push({
    name,
    weight: Number(weight),
    titles: approvedLines[index + 1].split('; ').map((entry) => {
      const [notation, titleWeight = '1'] = entry.split('|');
      return { notation, weight: Number(titleWeight) };
    }),
  });
}
const counts = [48, 16, 12, 12, 10, 12, 12, 14, 11, 15, 13, 12, 11, 12, 12, 12, 13, 9, 11, 14, 11, 11, 9];
const titles = data.cultures.flatMap((culture) => culture.titles);
const culture = (name) => data.cultures.find((entry) => entry.name === name);

test('all 23 approved cultures and 312 titles are present in supplied order', () => {
  assert.deepEqual(Object.keys(data), ['cultures']);
  assert.equal(data.cultures.length, 23);
  assert.equal(titles.length, 312);
  assert.deepEqual(data.cultures.map((entry) => entry.titles.length), counts);
  assert.deepEqual(data.cultures.map((entry) => entry.name), approved.map((entry) => entry.name));
  assert.equal(new Set(data.cultures.map((entry) => entry.name)).size, 23);
});

test('every title, joiner, case, and relative weight exactly reproduces the approved table', () => {
  const reconstructed = data.cultures.map((entry) => ({
    name: entry.name,
    weight: entry.weight,
    titles: entry.titles.map((title) => ({
      notation: title.position === 'prefix'
        ? title.text + ' ()'
        : '() [' + title.joiner + '] ' + title.text,
      weight: title.weight,
    })),
  }));
  assert.deepEqual(reconstructed, approved);
});

test('data uses only the agreed structured fields and positive finite numeric weights', () => {
  for (const entry of data.cultures) {
    assert.deepEqual(Object.keys(entry).sort(), ['name', 'titles', 'weight']);
    assert.equal(typeof entry.name, 'string');
    assert.equal(entry.name, entry.name.trim());
    assert.equal(typeof entry.weight, 'number');
    assert.ok(Number.isFinite(entry.weight) && entry.weight > 0, entry.name);
    assert.ok(Array.isArray(entry.titles) && entry.titles.length > 0);
    for (const title of entry.titles) {
      assert.deepEqual(Object.keys(title).sort(), ['joiner', 'position', 'text', 'weight']);
      assert.equal(typeof title.text, 'string');
      assert.ok(title.text.length > 0);
      assert.equal(title.text, title.text.trim());
      assert.doesNotMatch(title.text, /[\[\]\(\)]/u);
      assert.ok(['prefix', 'suffix'].includes(title.position));
      assert.ok(['', 'the', 'a', 'of the'].includes(title.joiner));
      assert.equal(typeof title.weight, 'number');
      assert.ok(Number.isFinite(title.weight) && title.weight > 0, title.text);
      if (title.position === 'prefix') assert.equal(title.joiner, '');
      else assert.notEqual(title.joiner, '');
    }
  }
});

test('England has double culture weight and all other cultures including West African have weight one', () => {
  assert.equal(culture('England & Western Feudal Ranks').weight, 2);
  for (const entry of data.cultures.slice(1)) assert.equal(entry.weight, 1, entry.name);
  assert.equal(culture('West African').weight, 1);
  assert.equal(data.cultures.reduce((sum, entry) => sum + entry.weight, 0), 24);
});

test('fractional weights retain nonzero intervals at minimum and cumulative boundaries', () => {
  assert.equal(Math.min(...titles.map((title) => title.weight)), 0.05);
  assert.equal(Math.max(...titles.map((title) => title.weight)), 8);
  assert.equal(culture('England & Western Feudal Ranks').titles.find((title) => title.text === 'heir apparent').weight, 0.25);
  assert.equal(culture('Southeast Asian').titles.find((title) => title.text === 'Luang').weight, 3.5);
  assert.equal(titles.some((title) => title.weight === 0.7), true);
  assert.equal(titles.some((title) => title.weight === 0.8), true);
  for (const entry of data.cultures) {
    let total = 0;
    let hundredths = 0;
    for (const title of entry.titles) {
      const previous = total;
      total += title.weight;
      hundredths += Math.round(title.weight * 100);
      assert.ok(total > previous, title.text + ' must retain a positive selection interval');
      assert.ok(Math.abs((total - previous) - title.weight) < 1e-12);
      assert.ok(Math.abs(total - hundredths / 100) < 1e-10);
    }
  }
});

test('suffixes keep lowercase titles and literal joiners without embedded spacing', () => {
  const suffixes = titles.filter((title) => title.position === 'suffix');
  assert.equal(suffixes.length, 22);
  assert.deepEqual([...new Set(suffixes.map((title) => title.joiner))].sort(), ['a', 'of the', 'the']);
  for (const title of suffixes) {
    assert.equal(title.text[0], title.text[0].toLowerCase(), title.text);
    assert.equal(title.joiner, title.joiner.trim());
  }
  const render = (title, name) => title.position === 'prefix'
    ? title.text + ' ' + name
    : name + ' ' + title.joiner + ' ' + title.text;
  assert.equal(render(suffixes.find((title) => title.text === 'kuge'), 'Dor'), 'Dor of the kuge');
  assert.equal(render(suffixes.find((title) => title.text === 'peer'), 'Dor'), 'Dor a peer');
  assert.equal(render(suffixes.find((title) => title.text === 'heir apparent'), 'Dor'), 'Dor the heir apparent');
});

test('Unicode, apostrophes, supplied spellings, and cross-culture duplicates are retained', () => {
  for (const text of ['Kurfürst', 'Kurfürstin', 'Príncipe de Asturias', 'grande de España',
    "Kaloomte'", "K'uhul Ajaw", "Na'ib", "Baga'atur", 'Prevot', 'Podesta', 'Alferez', 'Godi']) {
    assert.ok(titles.some((title) => title.text === text), text);
  }
  assert.equal(titles.filter((title) => title.text === 'Khagan').length, 2);
  assert.equal(culture('Turkish').titles.find((title) => title.text === 'Khagan').weight, 0.05);
  assert.equal(culture('Central Asian & Steppe Nomadic').titles.find((title) => title.text === 'Khagan').weight, 0.05);
  assert.equal(titles.some((title) => title.text.includes('\uFFFD')), false);
});
