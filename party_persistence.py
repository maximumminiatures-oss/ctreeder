"""Private party snapshots and stable character identity at persistence boundaries."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import unicodedata
import uuid

from better_profanity import profanity
from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, delete
from sqlmodel import Field, SQLModel, select

from validation import validate_json

MAX_PARTIES = 20
MAX_RETAINED_PARTIES = 60
MAX_PARTY_BYTES = 3 * 1024 * 1024


class PartyLimitError(ValueError):
    pass

# Avoid treating identity words as insults. Names never leave this process.
profanity.load_censor_words(whitelist_words=["gay", "lesbian", "queer", "homosexual", "transgender"])


class SavedParty(SQLModel, table=True):
    __tablename__ = "saved_parties"
    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(sa_column=Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True))
    name: str = Field(sa_column=Column(String(80), nullable=False))
    party_json: dict = Field(sa_column=Column(JSON, nullable=False))
    revision: int = Field(default=1, nullable=False)
    deleted_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column=Column(DateTime(timezone=True), nullable=False))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column=Column(DateTime(timezone=True), nullable=False))


def party_name(value):
    if not isinstance(value, str):
        raise ValueError("Choose a party name of 1 to 80 characters.")
    value = unicodedata.normalize("NFKC", value).strip()
    if not 1 <= len(value) <= 80 or any(unicodedata.category(char).startswith("C") for char in value):
        raise ValueError("Choose a party name of 1 to 80 printable characters.")
    if any(char in value for char in '<>') or profanity.contains_profanity(value):
        raise ValueError("Please choose another party name.")
    return value


def character_lineage(character):
    """Original runtime IDs are stable across saved versions and room imports."""
    value = character.get("lineageId") or character.get("id")
    if not isinstance(value, str) or not 1 <= len(value) <= 120:
        raise ValueError("A character needs a valid original ID or lineageId.")
    return value


def with_lineage(character, *, fallback=None):
    character = deepcopy(character)
    if not character.get("lineageId") and not character.get("id"):
        character["lineageId"] = fallback or uuid.uuid4().hex
    character["lineageId"] = character_lineage(character)
    return character


def validate_party_snapshot(source, name):
    validate_json(source, max_bytes=MAX_PARTY_BYTES)
    characters = source.get("characters")
    if not isinstance(characters, list) or not 1 <= len(characters) <= 16 or any(not isinstance(char, dict) for char in characters):
        raise ValueError("A saved party must contain 1 to 16 characters.")
    characters = [with_lineage(char) for char in characters]
    ids = [char.get("id") for char in characters]
    lineages = [character_lineage(char) for char in characters]
    if any(not isinstance(identifier, str) or not 1 <= len(identifier) <= 120 for identifier in ids) or len(set(ids)) != len(ids) or len(set(lineages)) != len(lineages):
        raise ValueError("Only one version of each character can be in a party.")
    snapshot = {"schema_version": 1, "name": party_name(name), "partyName": party_name(name), "characters": characters}
    # Character objects retain complete summon, charm, disguise and item timers.
    # No map, membership, account IDs, or pending consensus is copied into a party.
    for key in ("timers", "partyAssets", "activeCharacterId", "arcaneTime", "spellClock", "roundClock", "gameClock"):
        if key in source:
            snapshot[key] = deepcopy(source[key])
    for key in ("timers", "partyAssets"):
        if key in snapshot and not isinstance(snapshot[key], dict):
            raise ValueError(f"Invalid party {key}.")
    validate_json(snapshot, max_bytes=MAX_PARTY_BYTES)
    return snapshot


def create_party(db, user_id, name, source):
    snapshot = validate_party_snapshot(source, name)
    db.exec(delete(SavedParty).where(SavedParty.user_id == user_id,
                                    SavedParty.deleted_at < datetime.now(timezone.utc) - timedelta(days=30)))
    records = db.exec(select(SavedParty).where(SavedParty.user_id == user_id)).all()
    if len(records) >= MAX_RETAINED_PARTIES or sum(item.deleted_at is None for item in records) >= MAX_PARTIES:
        raise PartyLimitError("Your saved-party limit has been reached.")
    saved = SavedParty(user_id=user_id, name=snapshot["name"], party_json=snapshot)
    db.add(saved)
    db.flush()
    return saved


def party_summary(saved):
    return {"id": saved.id, "name": saved.name, "revision": saved.revision,
            "character_count": len(saved.party_json.get("characters", [])),
            "created_at": saved.created_at.isoformat(), "updated_at": saved.updated_at.isoformat()}


def register_party_routes(app, engine, User, SavedRun, SavedCharacter, rate_limit):
    from flask import request
    from flask_login import current_user, login_required
    from sqlalchemy import and_, or_, update
    from sqlmodel import Session
    from room_models import GameRoom, RoomMember, utcnow
    from rooms import HOST_LEASE, guest_hash
    from storage_limits import storage_available, STORAGE_FULL

    @app.get("/api/parties")
    @login_required
    def list_parties():
        with Session(engine) as db:
            records = db.exec(select(SavedParty).where(SavedParty.user_id == current_user.id, SavedParty.deleted_at == None)
                              .order_by(SavedParty.updated_at.desc()).limit(MAX_PARTIES)).all()
            return {"results": [party_summary(item) for item in records]}

    @app.post("/api/parties")
    @login_required
    @rate_limit("30 per minute")
    def save_party():
        data = request.get_json(silent=True)
        try:
            validate_json(data)
        except ValueError as exc:
            return {"error": "invalid_json", "message": str(exc)}, 400
        # Shared rooms must use the authoritative, unanimous group-action endpoint.
        if data.get("room_id") is not None:
            return {"error": "consensus_required", "message": "Use the dungeon's group-action confirmation to save its party."}, 409
        try:
            with Session(engine) as db:
                db.exec(update(User).where(User.id == current_user.id).values(session_version=User.session_version))
                identity = RoomMember.user_id == current_user.id
                guest = guest_hash()
                if guest:
                    identity = or_(identity, and_(RoomMember.user_id == None, RoomMember.guest_hash == guest))
                online_member = db.exec(select(RoomMember.id).join(GameRoom, GameRoom.id == RoomMember.room_id).where(
                    identity, RoomMember.status == "active", RoomMember.last_seen_at >= utcnow() - HOST_LEASE,
                    GameRoom.closed_at == None).limit(1)).first()
                if online_member:
                    return {"error": "consensus_required", "message": "Use the dungeon's group-action confirmation to save its party."}, 409
                saved = create_party(db, current_user.id, data.get("name", "The Party"), data.get("party_json", data.get("state_json")))
                if not storage_available(db, current_user.id, SavedRun, SavedCharacter):
                    return STORAGE_FULL
                db.commit()
                return {**party_summary(saved), "party_json": saved.party_json}, 201
        except PartyLimitError as exc:
            return {"error": "save_limit", "message": str(exc)}, 409
        except ValueError as exc:
            return {"error": "invalid_party", "message": str(exc)}, 400

    @app.route("/api/parties/<int:party_id>", methods=["GET", "DELETE"])
    @login_required
    @rate_limit("60 per minute")
    def party_record(party_id):
        with Session(engine) as db:
            if request.method == "DELETE":
                db.exec(update(User).where(User.id == current_user.id).values(session_version=User.session_version))
            saved = db.get(SavedParty, party_id)
            if not saved or saved.user_id != current_user.id or saved.deleted_at:
                return {"error": "not_found"}, 404
            if request.method == "GET":
                return {**party_summary(saved), "party_json": saved.party_json}
            data = request.get_json(silent=True) or {}
            try:
                validate_json(data)
            except ValueError as exc:
                return {"error": "invalid_json", "message": str(exc)}, 400
            if type(data.get("revision")) is not int or data["revision"] != saved.revision:
                return {"error": "revision_conflict", "message": "Reload the party before deleting this save."}, 409
            saved.deleted_at = datetime.now(timezone.utc)
            saved.updated_at = saved.deleted_at
            saved.revision += 1
            db.add(saved)
            db.commit()
            return {"id": saved.id, "revision": saved.revision}
