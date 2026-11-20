from copy import deepcopy
import pytest
from sqlmodel import SQLModel, Session, select
from werkzeug.security import generate_password_hash
from app import app, engine, User, SavedRun
from autosave_models import AccountAutosave

@pytest.fixture
def autosave_client():
    app.config.update(TESTING=True)
    SQLModel.metadata.drop_all(engine)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        users=[User(username=name,password_hash=generate_password_hash("password")) for name in ["auto-one","auto-two"]]
        db.add_all(users);db.commit()
        ids=[user.id for user in users]
    with app.test_client() as client:
        yield client,ids

def signin(client,identifier):
    with client.session_transaction() as session:
        session["_user_id"]=str(identifier);session["_fresh"]=True

def state():
    return {"seed":123,"level":1,"map":{"width":2,"height":2},
            "tiles":[{"x":x,"y":y,"type":"floor"} for y in range(2) for x in range(2)],
            "characters":[],"entities":[],"rooms":[],"halls":[],"run":{"autosaveSteps":27}}

def test_autosave_requires_authentication(autosave_client):
    client,_=autosave_client
    assert client.get("/api/autosave").status_code==401
    assert client.put("/api/autosave",json={"state_json":state()}).status_code==401

def test_autosave_overwrites_one_slot_without_consuming_manual_saves(autosave_client):
    client,ids=autosave_client;signin(client,ids[0])
    for i in range(4):
        snapshot=state();snapshot["run"]["autosaveSteps"]=i
        result=client.put("/api/autosave",json={"state_json":snapshot})
        assert result.status_code==200,result.json
        assert result.json["revision"]==i+1
    assert client.get("/api/autosave").json["state_json"]["run"]["autosaveSteps"]==3
    with Session(engine) as db:
        assert len(db.exec(select(AccountAutosave)).all())==1
        assert not db.exec(select(SavedRun)).all()

def test_autosave_is_private_to_each_account(autosave_client):
    client,ids=autosave_client;signin(client,ids[0])
    assert client.put("/api/autosave",json={"state_json":state()}).status_code==200
    signin(client,ids[1])
    assert client.get("/api/autosave").status_code==404
    second=state();second["seed"]=456
    assert client.put("/api/autosave",json={"state_json":second}).status_code==200
    signin(client,ids[0]);assert client.get("/api/autosave").json["seed"]==123

def test_invalid_autosave_cannot_destroy_previous_snapshot(autosave_client):
    client,ids=autosave_client;signin(client,ids[0])
    client.put("/api/autosave",json={"state_json":state()})
    for payload in [{},{"state_json":{}},{"state_json":{**state(),"level":11}}]:
        assert client.put("/api/autosave",json=payload).status_code==400
    assert client.get("/api/autosave").json["revision"]==1

def test_autosave_counts_toward_account_quota_and_rolls_back_on_failure(autosave_client,monkeypatch):
    import storage_limits
    client,ids=autosave_client;signin(client,ids[0])
    client.put("/api/autosave",json={"state_json":state()})
    monkeypatch.setattr(storage_limits,"MAX_ACCOUNT_BYTES",1)
    assert client.put("/api/autosave",json={"state_json":state()}).status_code==409
    assert client.get("/api/autosave").json["revision"]==1

def test_account_export_includes_autosave(autosave_client):
    client,ids=autosave_client
    client.post("/login",data={"username":"auto-one","password":"password"})
    client.put("/api/autosave",json={"state_json":state()})
    assert client.get("/api/account/export").json["autosave"]["state_json"]["seed"]==123


def test_metadata_list_does_not_transfer_the_dungeon_snapshot(autosave_client):
    client,ids=autosave_client;signin(client,ids[0])
    client.put("/api/autosave",json={"state_json":state()})
    metadata=client.get("/api/autosave?metadata=1").json
    assert metadata["id"]=="autosave"
    assert metadata["seed"]==123 and metadata["revision"]==1
    assert "state_json" not in metadata


def test_shared_autosave_context_is_charged_once(autosave_client,monkeypatch):
    import storage_limits
    from app import SavedCharacter
    from sqlalchemy import String,cast,func
    _,ids=autosave_client
    with Session(engine) as db:
        db.add(AccountAutosave(user_id=ids[0],state_json=state(),room_json={"members":[{"display_name":"A"*10000}]}));db.commit()
        expected=db.exec(select(func.length(cast(AccountAutosave.state_json,String))+func.length(cast(AccountAutosave.room_json,String))).where(AccountAutosave.user_id==ids[0])).one()
        monkeypatch.setattr(storage_limits,"MAX_ACCOUNT_BYTES",expected)
        assert storage_limits.storage_available(db,ids[0],SavedRun,SavedCharacter)
        monkeypatch.setattr(storage_limits,"MAX_ACCOUNT_BYTES",expected-1)
        assert not storage_limits.storage_available(db,ids[0],SavedRun,SavedCharacter)
