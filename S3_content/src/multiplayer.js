import { packPrivateVisibility, unpackPrivateVisibility, PRIVATE_VISIBILITY_ENCODING, PRIVATE_VISIBILITY_HEADER } from './private-visibility.js';
import { serializeDungeonState } from './persistence.js';
import { apiFetch, readApiResponse } from './api.js';

const ROOM_REQUEST_TIMEOUT_MS = 30000;
const privateWrites = new Map();

export function normalizeSessionCode(value) {
  const text = String(value || '').trim();
  try {
    const url = new URL(text);
    return (url.searchParams.get('join') || '').toUpperCase();
  } catch {
    return text.toUpperCase();
  }
}

export function roomRequest(id, action = '', body = null, method = 'POST', options = {}) {
  if (!body?.viewer_visibility) return performRoomRequest(id, action, body, method, options);
  // Preserve snapshot order even if gzip/upload of an older heartbeat takes longer.
  const previous = privateWrites.get(id) || Promise.resolve();
  const pending = previous.catch(() => {}).then(() => performRoomRequest(id, action, body, method, options));
  privateWrites.set(id, pending);
  const cleanup = () => { if (privateWrites.get(id) === pending) privateWrites.delete(id); };
  pending.then(cleanup, cleanup);
  return pending;
}

async function performRoomRequest(id, action, body, method, options) {
  const query = new URLSearchParams(Object.entries(options.query || {}).filter(([, value]) => value !== null && value !== undefined));
  const path = `/api/rooms${id ? `/${encodeURIComponent(id)}` : ''}${action ? `/${action}` : ''}${query.size ? `?${query}` : ''}`;
  const controller = new AbortController();
  const requestedTimeout = Number.isFinite(options.timeoutMs) ? Math.max(1000, options.timeoutMs) : ROOM_REQUEST_TIMEOUT_MS;
  const timeoutMs = body?.viewer_visibility?.explorationMemory ? Math.max(ROOM_REQUEST_TIMEOUT_MS, requestedTimeout) : requestedTimeout;
  let timedOut = false;
  const cancel = () => controller.abort();
  if (options.signal?.aborted) cancel();
  else options.signal?.addEventListener('abort', cancel, { once: true });
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      const error = new Error('The dungeon server took too long to respond.');
      error.status = 0;
      error.code = 'request_timeout';
      reject(error);
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([
      (async () => {
        const packedBody = body?.viewer_visibility ? { ...body, viewer_visibility: await packPrivateVisibility(body.viewer_visibility) } : body;
        if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        return apiFetch(path, {
        method: body === null ? 'GET' : method,
        signal: controller.signal,
        keepalive: options.keepalive === true,
        headers: { [PRIVATE_VISIBILITY_HEADER]: PRIVATE_VISIBILITY_ENCODING },
        ...(body === null ? {} : { body: JSON.stringify(packedBody) })
      }); })(),
      deadline
    ]);
    const data = await readApiResponse(response);
    if (data.viewer_visibility) data.viewer_visibility = await unpackPrivateVisibility(data.viewer_visibility);
    return data;
  } catch (error) {
    if (timedOut || error?.code === 'request_timeout') throw error;
    if (error?.name === 'AbortError') {
      const cancelled = new Error('Dungeon request canceled.');
      cancelled.status = 0;
      cancelled.code = 'request_cancelled';
      throw cancelled;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
  }
}

export const createHostSession = (state, options = {}) => roomRequest('', '', {
  name: state.run?.name || 'Unnamed dungeon', state_json: serializeDungeonState(state), options
});
export const joinHostSession = (value, options = {}) => roomRequest('', 'join', {
  code: normalizeSessionCode(value), display_name: options.displayName || 'Adventurer'
});
export const getHostSession = (id, revision = null) => roomRequest(id, '', null, 'GET', {
  query: Number.isInteger(revision) ? { revision } : {}
});
export const listJoinedRooms = () => roomRequest('', 'saved');
