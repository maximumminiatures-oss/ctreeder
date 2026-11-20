from copy import deepcopy
import base64,gzip,json
import pytest
from private_visibility import pack_private_visibility, unpack_private_visibility, ENCODING, HEADER
from rooms import validate_viewer_visibility
from room_models import GameRoom,RoomMember
from sqlmodel import Session,select
from app import engine
from test_rooms import clients,create,join,post,dungeon


def large_visibility():
    ring=[[1,1],[1.9999999999999998,1.2345678901234567],[2,2],[1,1]]
    return {"floorLevel":1,"explorationMemory":{"version":1,"compactRegions":True,"routes":{
        "":{"complete":{"2,2":True},"partial":{"1,1":[[ring,[[1.2,1.2],[1.3,1.2],[1.2,1.3],[1.2,1.2]]] for _ in range(12000)]},"rooms":{},"halls":{}},
        "@legacy":{"complete":{"3,3":True},"partial":{},"rooms":{},"halls":{}}}},"closedDoorExploredSides":{"door":["left"]}}


def test_exact_large_roundtrip_retains_limits_and_geometry():
    value=large_visibility();before=deepcopy(value)
    assert len(json.dumps(value).encode())>1024*1024
    with pytest.raises(ValueError,match="too large"):validate_viewer_visibility(value,dungeon())
    packed=pack_private_visibility(value)
    assert len(json.dumps(packed).encode())<1024*1024
    assert unpack_private_visibility(packed)[0]==value
    expected=deepcopy(value);expected.pop('floorLevel');expected.update(exploredEver=[],routeExplored={},routeDarkvisionExplored={},visitedRoomIds=[],exploredInnerWallInteriors=[])
    assert validate_viewer_visibility(packed,dungeon())==expected
    assert value==before


@pytest.mark.parametrize('mutation',[
 lambda p:p.update(bytes=p['bytes']+1),lambda p:p.update(bytes=6*1024*1024),
 lambda p:p.update(floorLevel=2),lambda p:p.update(encoding='unknown'),
 lambda p:p.update(data=['!']),lambda p:p.update(data=[p['data'][0][4:]]),
 lambda p:p.update(data=p['data']+[base64.b64encode(gzip.compress(b'{}')).decode()]),
])
def test_malformed_compressed_payloads_rejected(mutation):
    packed=pack_private_visibility(large_visibility());mutation(packed)
    with pytest.raises(ValueError):unpack_private_visibility(packed)


def test_decompression_bomb_and_nested_wrapper_rejected():
    packed={'encoding':ENCODING,'bytes':100,'data':[base64.b64encode(gzip.compress(b'x'*(5*1024*1024))).decode()]}
    with pytest.raises(ValueError):unpack_private_visibility(packed)
    nested={'encoding':ENCODING,'bytes':2,'data':['aaaa']}
    with pytest.raises(ValueError):unpack_private_visibility(nested)


def test_encoded_geometry_still_rejects_invalid_coordinates():
    value=large_visibility();value['explorationMemory']['routes']['']['partial']['1,1'][0][0][1][0]=2.1
    with pytest.raises(ValueError,match='point'):validate_viewer_visibility(pack_private_visibility(value),dungeon())


def test_large_private_memory_survives_presence_leave_resume_and_is_not_shared(clients):
    host,guest,_=clients;room=create(host);join(guest,room);value=large_visibility();packed=pack_private_visibility(value)
    path=f"/api/rooms/{room['id']}"
    saved=post(guest,path+'/presence',{'viewer_visibility':packed});assert saved.status_code==200,saved.json
    assert saved.json['viewer_visibility']['explorationMemory']==value['explorationMemory']
    assert host.get(path).json['viewer_visibility'].get('explorationMemory')!=value['explorationMemory']
    encoded=guest.get(path,headers={HEADER:ENCODING});assert encoded.status_code==200
    returned=unpack_private_visibility(encoded.json['viewer_visibility'])[0]
    assert returned==saved.json['viewer_visibility']
    assert encoded.headers.get('Cache-Control')=='no-store'
    legacy=post(guest,path+'/presence',{'viewer_visibility':{'floorLevel':1,'exploredEver':['1,1']}})
    assert legacy.status_code==200,legacy.json
    assert legacy.json['viewer_visibility']['explorationMemory']==value['explorationMemory']
    with Session(engine) as db:
        member=db.exec(select(RoomMember).where(RoomMember.room_id==room['id'],RoomMember.role=='player')).one()
        assert member.visibility_json['explorationMemory']==value['explorationMemory']
        game=db.get(GameRoom,room['id']);game.state_json={**game.state_json,'level':2};db.add(game);db.commit()
    # A delayed old-floor compressed heartbeat cannot erase current-floor memory.
    stale=post(guest,path+'/presence',{'viewer_visibility':packed});assert stale.status_code==200,stale.json
    assert stale.json['viewer_visibility']['explorationMemory']==value['explorationMemory']
    # Leave submits the same old-floor snapshot; ignore it and retain server-owned fog.
    assert post(guest,path+'/leave',{'viewer_visibility':packed}).status_code==200
    resumed=post(guest,path+'/resume',{});assert resumed.status_code==200
    assert resumed.json['viewer_visibility']['explorationMemory']==value['explorationMemory']


def test_host_creation_preserves_exact_memory_without_public_fog_leak(clients, monkeypatch):
    import rooms
    host,guest,_=clients;state=dungeon();value=large_visibility();state['visibility'].update(value)
    # Isolate the persistence boundary; the legacy normalizer does not know the new memory field.
    normalized=deepcopy(state);normalized['visibility'].pop('explorationMemory')
    monkeypatch.setattr(rooms.game_runtime,'apply',lambda *a,**kw:{'state_json':deepcopy(normalized)})
    response=post(host,'/api/rooms',{'state_json':state,'options':{}})
    assert response.status_code==201,response.json
    assert response.json['viewer_visibility']['explorationMemory']==value['explorationMemory']
    joined=join(guest,response.json)
    assert 'explorationMemory' not in joined['viewer_visibility']
    assert 'explorationMemory' not in joined['state_json']['visibility']
