"""Private browser-import service. It receives no account or database secrets."""
import threading

from flask import Flask, request

from shadowdarklings_import import import_options, validate_export, run_shadowdarklings_import_worker


app = Flask(__name__)
_import_slot = threading.BoundedSemaphore(1)


@app.get("/healthz")
def health():
    return {"status": "ok"}, 200


@app.post("/import")
def import_character():
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or type(data.get("base_classes_only", False)) is not bool:
        return {"error": "invalid_request", "message": "Invalid character import request."}, 400
    try:
        options = import_options(data)
    except ValueError as exc:
        return {"error": "invalid_request", "message": str(exc)}, 400
    if not _import_slot.acquire(blocking=False):
        return {
            "error": "import_busy",
            "message": "Another character import is already running. Please try again in a moment.",
        }, 503, {"Retry-After": "5"}
    try:
        character_json = run_shadowdarklings_import_worker(data.get("base_classes_only", False), **options)
        validate_export(character_json, options.get("mode"))
        return {"character_json": character_json}, 200
    except Exception as exc:
        app.logger.warning("Isolated ShadowDarklings import failed (%s): %s", type(exc).__name__, exc)
        return {
            "error": "upstream_unavailable",
            "message": "ShadowDarklings is currently unreachable or timed out.",
        }, 503
    finally:
        _import_slot.release()
