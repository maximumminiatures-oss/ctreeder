"""Lossless, bounded private-fog transport. No geometry or visibility decisions."""
import base64
import binascii
import gzip
import json
import zlib
from validation import validate_json

ENCODING = "sd-private-fog-gzip-v1"
HEADER = "X-ShadowSpawner-Visibility-Encoding"
WIRE_LIMIT = 1024 * 1024
DECODED_LIMIT = 5 * 1024 * 1024
THRESHOLD = 32768
CHUNK = 12000


def pack_private_visibility(value):
    raw = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    if len(raw) <= THRESHOLD:
        return value
    if len(raw) > DECODED_LIMIT:
        raise ValueError("Player exploration exceeds the supported decoded size.")
    encoded = base64.b64encode(gzip.compress(raw, mtime=0)).decode("ascii")
    packed = {"encoding": ENCODING, "bytes": len(raw),
              "data": [encoded[i:i+CHUNK] for i in range(0, len(encoded), CHUNK)]}
    if "floorLevel" in value:
        packed["floorLevel"] = value["floorLevel"]
    validate_json(packed, max_bytes=WIRE_LIMIT)
    return packed


def unpack_private_visibility(value):
    """Return decoded data and its validation budget; never allocate unbounded output."""
    validate_json(value, max_bytes=WIRE_LIMIT)
    if "encoding" not in value:
        return value, WIRE_LIMIT
    if value.get("encoding") != ENCODING or set(value) - {"encoding", "bytes", "data", "floorLevel"}:
        raise ValueError("Unsupported player exploration encoding.")
    size, chunks = value.get("bytes"), value.get("data")
    if (type(size) is not int or not 0 < size <= DECODED_LIMIT or
            not isinstance(chunks, list) or not chunks or
            any(not isinstance(c, str) or not c or len(c) > CHUNK for c in chunks)):
        raise ValueError("Invalid encoded player exploration.")
    try:
        binary = base64.b64decode("".join(chunks), validate=True)
        stream = zlib.decompressobj(31)
        raw = stream.decompress(binary, size + 1)
        if len(raw) != size or not stream.eof or stream.unused_data or stream.unconsumed_tail:
            raise ValueError("Invalid encoded player exploration length.")
        decoded = json.loads(raw.decode("utf-8"))
    except (binascii.Error, zlib.error, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError("Invalid encoded player exploration.") from error
    if not isinstance(decoded, dict) or "encoding" in decoded:
        raise ValueError("Invalid encoded player exploration object.")
    if ("floorLevel" in value) != ("floorLevel" in decoded) or value.get("floorLevel") != decoded.get("floorLevel"):
        raise ValueError("Invalid encoded exploration floor.")
    validate_json(decoded, max_bytes=DECODED_LIMIT)
    return decoded, DECODED_LIMIT
