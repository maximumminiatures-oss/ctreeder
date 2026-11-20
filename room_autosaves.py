"""Trusted snapshots of a shared dungeon; restoring never edits the source room."""
from copy import deepcopy
from datetime import timedelta
from sqlalchemy import update
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import select
from flask import current_app
from autosaves import write_account_autosave
from room_models import GameRoom, RoomMember, utcnow
from storage_limits import storage_available

class AutosaveQuotaError(Exception):
    pass


def capture_room_autosave(db, room, User, SavedRun, SavedCharacter, option_keys, state_snapshot=None):
    # A savepoint preserves the valid game command if its extra backup exceeds quota.
    try:
        with db.begin_nested():
            db.exec(update(User).where(User.id == room.host_user_id).values(session_version=User.session_version))
            members = db.exec(select(RoomMember).where(
                RoomMember.room_id == room.id, RoomMember.status == "active")).all()
            context = {
                "version": 1, "source_room_id": room.id, "name": room.name,
                "options": {key: getattr(room, key) for key in option_keys},
                "joins_locked": room.joins_locked,
                "ownership": deepcopy(room.ownership_json),
                "primary_assignments": deepcopy(room.primary_assignments_json),
                "members": [{"id": m.id, "user_id": m.user_id, "guest_hash": m.guest_hash,
                    "display_name": m.display_name, "role": m.role,
                    "visibility": deepcopy(m.visibility_json)} for m in members],
            }
            saved = write_account_autosave(db, room.host_user_id, deepcopy(state_snapshot if state_snapshot is not None else room.state_json), context)
            if not storage_available(db, room.host_user_id, SavedRun, SavedCharacter):
                raise AutosaveQuotaError()
            revision = saved.revision
        return {"saved": True, "revision": revision}
    except AutosaveQuotaError:
        return {"saved": False, "message": "The host autosave could not finish because account storage is full."}
    except Exception:
        current_app.logger.exception("Shared autosave failed; valid game command retained.")
        return {"saved": False, "message": "The host autosave could not finish. Try saving the dungeon manually."}


def restore_room_autosave(db, saved, user, User, option_keys):
    context = saved.room_json
    if not context or context.get("version") != 1:
        raise ValueError("This autosave is a solo dungeon.")
    snapshot = deepcopy(saved.state_json)
    snapshot.pop("groupAction", None)
    snapshot["multiplayerMotions"] = []
    snapshot["run"] = {**snapshot.get("run", {}), "id": None, "revision": None}
    options = {key: bool(context.get("options", {}).get(key, False)) for key in option_keys}
    room = GameRoom(host_user_id=user.id, name=context.get("name", "Dungeon")[:80],
        state_json=snapshot, joins_locked=bool(context.get("joins_locked")), **options)
    db.add(room)
    db.flush()
    rows = context.get("members", [])
    old_host = next((row for row in rows if row.get("role") == "host"), {})
    host = RoomMember(room_id=room.id, user_id=user.id,
        display_name=(user.display_name or user.username)[:80], role="host",
        visibility_json=deepcopy(old_host.get("visibility", {})))
    db.add(host)
    db.flush()
    remap = {old_host.get("id"): host.id}
    accounts = {user.id}
    for row in rows:
        if row.get("role") == "host":
            continue
        account = row.get("user_id")
        if account is not None and (account in accounts or db.get(User, account) is None):
            continue
        if account is None and not row.get("guest_hash"):
            continue
        member = RoomMember(room_id=room.id, user_id=account, guest_hash=row.get("guest_hash"),
            display_name=row.get("display_name", "Player")[:80], role="player",
            visibility_json=deepcopy(row.get("visibility", {})),
            last_seen_at=utcnow()-timedelta(days=1))
        db.add(member)
        db.flush()
        if account is not None:
            accounts.add(account)
        remap[row["id"]] = member.id
    room.ownership_json = {character["id"]: remap.get(context.get("ownership", {}).get(character["id"]), host.id)
        for character in snapshot.get("characters", [])}
    if isinstance(snapshot.get("marchingGroups"),dict):
        snapshot["marchingGroups"]={remap.get(identifier,identifier):group for identifier,group in snapshot["marchingGroups"].items()}
    if isinstance(snapshot.get("rest"), dict):
        for key in ("requiredMemberIds", "acceptedMemberIds"):
            if isinstance(snapshot["rest"].get(key), list):
                snapshot["rest"][key] = list(dict.fromkeys(remap[old] for old in snapshot["rest"][key] if old in remap))
    for entity in snapshot.get("entities", []):
        if entity.get("ownerMemberId"):
            entity["ownerMemberId"] = remap.get(entity["ownerMemberId"], host.id)
    room.state_json=snapshot
    flag_modified(room,"state_json")
    room.primary_assignments_json = {new_id: identifier if room.ownership_json.get(identifier) == new_id else None
        for old_id, identifier in context.get("primary_assignments", {}).items()
        if (new_id := remap.get(old_id))}
    room.primary_assignments_json.setdefault(host.id, next(
        (identifier for identifier, owner in room.ownership_json.items() if owner == host.id), None))
    db.add(room)
    return room, host
