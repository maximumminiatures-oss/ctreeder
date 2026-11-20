// Private transport only: JSON + gzip preserves every polygon coordinate and ring.
export const PRIVATE_VISIBILITY_ENCODING = 'sd-private-fog-gzip-v1';
export const PRIVATE_VISIBILITY_HEADER = 'X-ShadowSpawner-Visibility-Encoding';
const WIRE_LIMIT = 1024 * 1024;
const DECODED_LIMIT = 5 * 1024 * 1024;
const CHUNK = 12000;
const encoder = new TextEncoder();
let lastJson, lastPacked;

async function readBounded(stream, limit) {
  const reader = stream.getReader(), parts = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('Player exploration exceeds the supported size.');
      parts.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}

export async function packPrivateVisibility(value) {
  const json = JSON.stringify(value);
  if (json === lastJson) return lastPacked;
  const raw = encoder.encode(json);
  if (raw.length <= 32768) return value;
  if (raw.length > DECODED_LIMIT) throw new Error('Player exploration exceeds the supported decoded size.');
  const bytes = await readBounded(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip')), WIRE_LIMIT);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const base64 = btoa(binary), data = [];
  for (let i = 0; i < base64.length; i += CHUNK) data.push(base64.slice(i, i + CHUNK));
  const packed = { encoding: PRIVATE_VISIBILITY_ENCODING, bytes: raw.length, data };
  if (Object.hasOwn(value, 'floorLevel')) packed.floorLevel = value.floorLevel;
  if (encoder.encode(JSON.stringify(packed)).length > WIRE_LIMIT) throw new Error('Player exploration exceeds the supported transport size.');
  lastJson = json; lastPacked = packed;
  return packed;
}

export async function unpackPrivateVisibility(value) {
  if (!value || !Object.hasOwn(value, 'encoding')) return value;
  if (value.encoding !== PRIVATE_VISIBILITY_ENCODING || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > DECODED_LIMIT ||
      !Array.isArray(value.data) || !value.data.length || value.data.some(c => typeof c !== 'string' || !c.length || c.length > CHUNK) ||
      encoder.encode(JSON.stringify(value)).length > WIRE_LIMIT) throw new Error('Invalid encoded player exploration.');
  const base64 = value.data.join('');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('Invalid encoded player exploration.');
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const raw = await readBounded(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')), value.bytes);
  if (raw.length !== value.bytes) throw new Error('Invalid encoded exploration length.');
  const decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded) || Object.hasOwn(decoded, 'encoding') ||
      Object.hasOwn(decoded, 'floorLevel') !== Object.hasOwn(value, 'floorLevel') || decoded.floorLevel !== value.floorLevel) throw new Error('Invalid encoded exploration floor.');
  return decoded;
}
