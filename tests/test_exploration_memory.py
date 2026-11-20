from copy import deepcopy
import pytest
from rooms import validate_exploration_memory
from test_rooms import clients, dungeon, create, join, post

def partial_memory():
    return {"version": 1, "routes": {"": {
        "complete": {"2,2": True},
        "partial": {"1,1": [[[[1,1],[2,1],[1,2],[1,1]]]]},
        "rooms": {}, "halls": {}}}}

def test_private_geometry_preserves_partial_shape_and_complete_cells():
    memory=partial_memory()
    assert validate_exploration_memory(memory,dungeon()) == memory

@pytest.mark.parametrize("change",[
    lambda m:m["routes"].update({"foreign":{"complete":{},"partial":{}}}),
    lambda m:m["routes"][""]["complete"].update({"99,99":True}),
    lambda m:m["routes"][""]["complete"].update({"2,2":False}),
    lambda m:m["routes"][""]["partial"]["1,1"][0][0].__setitem__(1,[2.1,1]),
    lambda m:m["routes"][""]["partial"]["1,1"][0][0].__setitem__(1,[float("nan"),1]),
    lambda m:m["routes"][""]["partial"]["1,1"][0][0].__setitem__(-1,[1.5,1.5]),
])
def test_private_geometry_rejects_invalid_coordinates_routes_and_open_rings(change):
    memory=partial_memory();change(memory)
    with pytest.raises(ValueError):validate_exploration_memory(memory,dungeon())

def test_compact_room_completion_is_preserved_in_transport():
    memory={"version":1,"compactRegions":True,"routes":{"":{"complete":{},"partial":{},"rooms":{"r1":True},"halls":{}}}}
    assert validate_exploration_memory(memory,dungeon()) == memory
    bad=deepcopy(memory);bad["routes"][""]["rooms"]={"foreign":True}
    with pytest.raises(ValueError):validate_exploration_memory(bad,dungeon())

def test_private_geometry_survives_leave_and_resume_without_leaking_to_host(clients):
    host,guest,_=clients;room=create(host);join(guest,room)
    memory=partial_memory()
    saved=post(guest,f"/api/rooms/{room['id']}/presence",{"viewer_visibility":{"explorationMemory":memory}})
    assert saved.status_code==200,saved.json
    assert saved.json["viewer_visibility"]["explorationMemory"]==memory
    assert host.get(f"/api/rooms/{room['id']}").json["viewer_visibility"].get("explorationMemory")!=memory
    assert post(guest,f"/api/rooms/{room['id']}/leave",{"viewer_visibility":{"explorationMemory":memory}}).status_code==200
    resumed=post(guest,f"/api/rooms/{room['id']}/resume",{})
    assert resumed.status_code==200
    assert resumed.json["viewer_visibility"]["explorationMemory"]==memory
