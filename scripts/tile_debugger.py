"""Loopback-only tile placement workbench; independent of game accounts/database."""
import argparse
import base64
import hashlib
import json
import mimetypes
import os
import re
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from uuid import uuid4

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "S3_content" / "assets"
TOOL = ROOT / "tools" / "tile-debugger"
OUTPUT = ROOT.parents[1] / ".dev" / "design-examples" / "organic-tiles"
STUDIES = OUTPUT / "studies"
IMAGE_TYPES = {".png", ".jpg", ".jpeg", ".gif", ".webp"}


def catalog():
    result = []
    for current, directories, files in os.walk(ASSETS, followlinks=False):
        directories[:] = [name for name in directories if name.lower() != 'old assets' and not os.path.islink(Path(current) / name)
                          and not os.path.isjunction(Path(current) / name)]
        for name in files:
            path = Path(current) / name
            if path.suffix.lower() not in IMAGE_TYPES or path.is_symlink():
                continue
            with Image.open(path) as image:
                width, height = image.size
            identifier = path.relative_to(ASSETS).as_posix()
            result.append({"id": identifier, "name": name, "pixelWidth": width, "pixelHeight": height,
                           "w": max(1, (width + 53) // 54), "h": max(1, (height + 53) // 54),
                           "digest": hashlib.sha256(path.read_bytes()).hexdigest()})
    floor = next(item for item in result if item["id"] == "room_grid_backgroung.jpg")
    result.append({**floor, "id": "__floor__", "name": "Paper floor", "w": 1, "h": 1,
                   "source": "room_grid_backgroung.jpg", "crop": True})
    return result


class Handler(BaseHTTPRequestHandler):
    def permitted(self, writing=False):
        host = self.headers.get("Host", "")
        valid = host in {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
        if writing:
            valid = valid and self.headers.get("Origin") == f"http://{host}"
        if not valid:
            self.respond(403, {"error": "This tool accepts local browser requests only."})
        return valid

    def respond(self, code, value, mime="application/json"):
        data = json.dumps(value, ensure_ascii=True).encode() if mime == "application/json" else value
        self.send_response(code)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self.permitted():
            return
        url = unquote(urlsplit(self.path).path)
        if url == "/api/catalog":
            self.respond(200, {"assets": catalog(), "outputDirectory": str(OUTPUT)})
            return
        if url.startswith("/api/studies/"):
            name = url.removeprefix("/api/studies/")
            if not re.fullmatch(r"[A-Za-z0-9_-]+\.json", name):
                self.respond(404, {"error": "Study not found"})
                return
            path = (STUDIES / name).resolve()
            if not path.is_file():
                index_path = STUDIES / 'archive-index.json'
                index = json.loads(index_path.read_text(encoding='utf-8-sig')) if index_path.is_file() else {}
                archived = index.get(name)
                archive_root = (OUTPUT / 'archive').resolve()
                candidate = (archive_root / archived).resolve() if isinstance(archived, str) else None
                path = candidate if candidate and candidate.is_relative_to(archive_root) else path
            allowed = path.is_relative_to(STUDIES.resolve()) or path.is_relative_to((OUTPUT / 'archive').resolve())
            if not allowed or not path.is_file() or path.is_symlink():
                self.respond(404, {"error": "Study not found"})
                return
            self.respond(200, path.read_bytes(), "application/json; charset=utf-8")
            return
        if url in {"/", "/tools/tile-debugger/"}:
            path = TOOL / "index.html"
        else:
            roots = {"/tools/tile-debugger/": TOOL, "/S3_content/assets/": ASSETS,
                     "/S3_content/src/": ROOT / "S3_content" / "src"}
            path = None
            for prefix, folder in roots.items():
                if url.startswith(prefix):
                    candidate = (folder / url[len(prefix):]).resolve()
                    if candidate.is_relative_to(folder.resolve()) and not candidate.is_symlink():
                        path = candidate
                    break
        if not path or not path.is_file():
            self.respond(404, {"error": "Not found"})
            return
        mime = "text/javascript" if path.suffix in {".js", ".mjs"} else mimetypes.guess_type(path)[0] or "application/octet-stream"
        self.respond(200, path.read_bytes(), mime)

    def do_POST(self):
        if not self.permitted(writing=True):
            return
        if self.path != "/api/output":
            self.respond(404, {"error": "Not found"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 32 * 1024 * 1024:
                raise ValueError("Output is too large.")
            payload = json.loads(self.rfile.read(size))
            scene = payload["scene"]
            if scene.get("version") != 1 or not isinstance(scene.get("placements"), list) or len(scene["placements"]) > 20000:
                raise ValueError("Invalid map output.")
            stem = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid4().hex[:8]
            snapshots = {}
            for kind in ("map", "lighting"):
                image = payload.get(kind, "")
                if not image.startswith("data:image/png;base64,"):
                    raise ValueError("Missing PNG snapshot.")
                data = base64.b64decode(image.split(",", 1)[1], validate=True)
                if not data.startswith(b"\x89PNG\r\n\x1a\n"):
                    raise ValueError("Invalid PNG snapshot.")
                snapshots[kind] = data
            OUTPUT.mkdir(parents=True, exist_ok=True)
            path = OUTPUT / (stem + ".json")
            path.write_text(json.dumps(scene, indent=2, ensure_ascii=True), encoding="utf-8")
            for kind, data in snapshots.items():
                (OUTPUT / f"{stem}-{kind}.png").write_bytes(data)
            (OUTPUT / f"{stem}-needs-confirmation.txt").write_text("\n".join(scene.get("needsConfirmation", [])), encoding="utf-8")
            self.respond(200, {"path": str(path), "stem": stem})
        except (ValueError, KeyError, TypeError) as error:
            self.respond(400, {"error": str(error)})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=5058)
    args = parser.parse_args()
    print(f"Tile debugger: http://127.0.0.1:{args.port}/tools/tile-debugger/", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
