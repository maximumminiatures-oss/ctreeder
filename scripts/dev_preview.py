"""Local-only preview with an isolated database and no production credentials."""
import os
from pathlib import Path
import secrets
import sys

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
secret_path = root / ".preview-secret"
if not secret_path.exists():
    with secret_path.open("x", encoding="ascii") as secret_file:
        secret_file.write(secrets.token_urlsafe(48))
preview_secret = secret_path.read_text(encoding="ascii").strip()
os.environ.update(
    DATABASE_URL="sqlite:///" + str(root / "preview.sqlite3"),
    SECRET_KEY=preview_secret, OAUTH_CLIENT_ID="preview-disabled",
    OAUTH_CLIENT_SECRET="preview-disabled", FLASK_ENV="development",
    PUBLIC_BASE_URL="", RATELIMIT_STORAGE_URI="memory://",
)

from app import app
from flask import abort, jsonify, request
import json


@app.get('/__preview__/test-party')
def local_test_party():
    if request.remote_addr not in {'127.0.0.1', '::1'}:
        abort(404)
    fixture = root.parents[1] / '.dev' / 'fixtures' / 'shadowspawner' / 'three-characters.json'
    if not fixture.is_file():
        abort(404)
    response = jsonify(json.loads(fixture.read_text(encoding='utf-8')))
    response.headers['Cache-Control'] = 'no-store'
    return response

app.run(host="127.0.0.1", port=int(os.environ.get("PREVIEW_PORT", "5057")), debug=False, threaded=True)
