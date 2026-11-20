"""Authenticated autosave IO; game mutations remain in command/rule modules."""
from datetime import datetime, timezone
from flask import request
from flask_login import current_user, login_required
from sqlalchemy import update
from sqlmodel import Session
from autosave_models import AccountAutosave
from validation import validate_state
from storage_limits import storage_available, STORAGE_FULL

def write_account_autosave(db, user_id, state, room_json=None):
    """Caller serializes account writers; never accept room metadata from the browser."""
    saved = db.get(AccountAutosave, user_id)
    if saved is None:
        saved = AccountAutosave(user_id=user_id, state_json=state, room_json=room_json)
    else:
        saved.state_json = state
        saved.room_json = room_json
        saved.revision += 1
    saved.updated_at = datetime.now(timezone.utc)
    db.add(saved)
    return saved


def register_autosave_routes(app, engine, User, SavedRun, SavedCharacter, rate_limit):
    @app.route("/api/autosave", methods=["GET", "PUT"])
    @login_required
    @rate_limit("60 per minute")
    def account_autosave():
        with Session(engine) as db:
            if request.method == "GET":
                saved = db.get(AccountAutosave, current_user.id)
                if saved is None:
                    return {"error": "not_found", "message": "No autosave is available."}, 404
                result = {"id": "autosave", "name": "Autosave", "revision": saved.revision,
                        "seed": saved.state_json["seed"], "level": saved.state_json["level"],
                        "multiplayer": bool(saved.room_json),
                        "state_json": saved.state_json, "updated_at": saved.updated_at.isoformat()}
                if request.args.get("metadata") == "1": result.pop("state_json")
                return result, 200
            data = request.get_json(silent=True)
            state = data.get("state_json") if isinstance(data, dict) else None
            if not isinstance(state, dict):
                return {"error": "invalid_state", "message": "state_json is required."}, 400
            try:
                validate_state(state, require_map=True)
            except ValueError as exc:
                return {"error": "invalid_state", "message": str(exc)}, 400
            # Serializes account writers in Postgres and SQLite before the upsert.
            db.exec(update(User).where(User.id == current_user.id).values(session_version=User.session_version))
            saved = write_account_autosave(db, current_user.id, state)
            if not storage_available(db, current_user.id, SavedRun, SavedCharacter):
                db.rollback()
                return STORAGE_FULL
            db.commit()
            return {"id": "autosave", "revision": saved.revision, "updated_at": saved.updated_at.isoformat()}, 200
