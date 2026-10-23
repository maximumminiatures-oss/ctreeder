const MINOR_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

export function canonicalWeaponSpelling(value) {
  return String(value ?? '').replace(/\b(long|short|great|cross|war)\s+(sword|bow|axe|club|hammer)\b/gi,
    (_, prefix, suffix) => `${prefix}${suffix}`);
}

// Presentation only: item identities and player-written names retain their stored values.
export function formatFieldName(value) {
  const text = canonicalWeaponSpelling(value).replace(/\s+/g, ' ').trim();
  let first = true;
  return text.replace(/[A-Za-z]+(?:['\u2019][A-Za-z]+)?/g, word => {
    const lower = word.toLowerCase();
    const result = !first && MINOR_WORDS.has(lower) ? lower
      : /^(?:AC|HP|XP|GP|SP|CP|STR|DEX|CON|INT|WIS|CHA|FIN|I|II|III|IV|V|VI|VII|VIII|IX|X)$/.test(word) ? word
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    first = false;
    return result;
  });
}
