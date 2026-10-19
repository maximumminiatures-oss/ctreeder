"""Bounds for untrusted JSON crossing save and game-command boundaries."""

import json
import math
import re


def validate_json(value, *, max_bytes=5 * 1024 * 1024):
    if not isinstance(value, dict):
        raise ValueError("Request body must be a JSON object.")
    pending = [(value, 0)]
    count = 0
    while pending:
        item, depth = pending.pop()
        count += 1
        if depth > 32 or count > 500000:
            raise ValueError("The submitted data is too complex.")
        if isinstance(item, dict):
            for key, child in item.items():
                if key in {"__proto__", "prototype", "constructor"} or len(key) > 200:
                    raise ValueError("The submitted data contains an invalid field.")
                pending.append((child, depth + 1))
        elif isinstance(item, list):
            if len(item) > 65536:
                raise ValueError("A submitted collection is too large.")
            pending.extend((child, depth + 1) for child in item)
        elif isinstance(item, str):
            if len(item) > 16384:
                raise ValueError("A submitted text field is too long.")
            for dice_count in re.findall(r"(?<!\w)(\d+)d\d+(?=$|[^\w]|x\d)", item, flags=re.I):
                if int(dice_count) > 100:
                    raise ValueError("Dice expressions may contain at most 100 dice.")
        elif isinstance(item, (int, float)) and not isinstance(item, bool):
            if abs(item) > 2**53 - 1 or not math.isfinite(item):
                raise ValueError("A submitted number is outside the supported range.")
        elif item is not None and not isinstance(item, bool):
            raise ValueError("Unsupported data type.")
    if len(json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")) > max_bytes:
        raise ValueError("The submitted data is too large.")
    return value


def validate_state(value, *, require_map=False):
    validate_json(value)
    if require_map and ("seed" not in value or "level" not in value):
        raise ValueError("A dungeon seed and level are required.")
    if "seed" in value and (type(value["seed"]) is not int or abs(value["seed"]) > 2**32 - 1):
        raise ValueError("Invalid dungeon seed.")
    if "level" in value and (type(value["level"]) is not int or not 1 <= value["level"] <= 10):
        raise ValueError("Dungeon level must be between 1 and 10.")
    for key, limit in (("entities", 4096), ("rooms", 512), ("halls", 2048)):
        if key in value and (not isinstance(value[key], list) or len(value[key]) > limit or any(not isinstance(item, dict) for item in value[key])):
            raise ValueError(f"Invalid dungeon {key}.")
    characters = value.get("characters", [])
    if not isinstance(characters, list) or len(characters) > 16:
        raise ValueError("A dungeon can contain at most 16 characters.")
    seen = set()
    for character in characters:
        if not isinstance(character, dict):
            raise ValueError("Each character must be an object.")
        character_id = character.get("id")
        if not isinstance(character_id, str) or not 1 <= len(character_id) <= 120 or character_id in seen:
            raise ValueError("Character IDs must be unique, nonempty strings.")
        seen.add(character_id)
    if require_map or "map" in value:
        map_data = value.get("map")
        if not isinstance(map_data, dict):
            raise ValueError("A dungeon map is required.")
        width, height = map_data.get("width"), map_data.get("height")
        if any(type(size) is not int or not 1 <= size <= 256 for size in (width, height)):
            raise ValueError("Invalid dungeon dimensions.")
        tiles = value.get("tiles")
        if not isinstance(tiles, list) or len(tiles) != width * height:
            raise ValueError("Dungeon tiles do not match its dimensions.")
        if any(not isinstance(tile, dict) for tile in tiles):
            raise ValueError("Each tile must be an object.")
        validate_underpasses(value.get("underpasses", []), width, height, value.get("entities", []))
    return value


def validate_underpasses(routes, width, height, entities=()):
    if not isinstance(routes, list) or len(routes) > 64:
        raise ValueError("Invalid dungeon underpasses.")
    seen_ids, occupied = set(), set()

    def point(item):
        if not isinstance(item, dict) or any(type(item.get(key)) is not int for key in ("x", "y")):
            raise ValueError("Invalid underpass coordinates.")
        x, y = item["x"], item["y"]
        if not 0 <= x < width or not 0 <= y < height:
            raise ValueError("Invalid underpass coordinates.")
        return x, y

    for route in routes:
        if not isinstance(route, dict):
            raise ValueError("Invalid dungeon underpass.")
        route_id = route.get("id")
        if not isinstance(route_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", route_id) or route_id in seen_ids or route_id in {"__proto__", "constructor", "prototype"}:
            raise ValueError("Invalid underpass route ID.")
        seen_ids.add(route_id)
        cells = route.get("lowerCells")
        pit_tunnel = route.get("kind") == "pit-tunnel"
        if not isinstance(cells, list) or not (1 if pit_tunnel else 5) <= len(cells) <= 256:
            raise ValueError("Invalid underpass cells.")
        points = [point(cell) for cell in cells]
        unique = set(points)
        axis = route.get("axis")
        if len(unique) != len(points) or occupied.intersection(unique) or (not pit_tunnel and (axis not in {"horizontal", "vertical"} or any(
                b != (a[0] + (axis == "horizontal"), a[1] + (axis == "vertical")) for a, b in zip(points, points[1:])))):
            raise ValueError("Underpass routes must be separate, straight passages.")
        occupied.update(unique)
        crossings = route.get("upperCrossings")
        if not isinstance(crossings, list) or (len(crossings) != 1 if not pit_tunnel else len(crossings) > 256) or any(point(crossing) not in unique for crossing in crossings):
            raise ValueError("Invalid underpass crossing.")
        walls = route.get("wallCrossings", [])
        if not isinstance(walls, list) or len(walls) > 256 or any(point(wall) not in unique for wall in walls):
            raise ValueError("Invalid underpass wall crossing.")
        portals = route.get("portals")
        if pit_tunnel:
            if axis != "free" or portals != []:
                raise ValueError("Invalid pit underpass entrances.")
            reached, pending = {points[0]}, [points[0]]
            for x, y in pending:
                for next_point in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if next_point in unique and next_point not in reached:
                        reached.add(next_point)
                        pending.append(next_point)
            if reached != unique:
                raise ValueError("Pit underpass must be connected.")
            pit_ids = route.get("pitIds")
            if not isinstance(pit_ids, list) or not 2 <= len(pit_ids) <= 32 or any(not isinstance(pit_id, str) for pit_id in pit_ids) or len(set(pit_ids)) != len(pit_ids):
                raise ValueError("Invalid pit underpass links.")
            for pit_id in pit_ids:
                pit = next((entity for entity in entities if isinstance(entity, dict) and entity.get("id") == pit_id), None)
                if not pit or pit.get("subtype") != "pit" or pit.get("lowerRouteId") != route_id or not isinstance(pit.get("cells"), list) or not pit["cells"] or any(point(cell) not in unique or point(cell) not in {point(crossing) for crossing in crossings} for cell in pit["cells"]):
                    raise ValueError("Invalid pit underpass link.")
        elif not isinstance(portals, list) or len(portals) != 2:
            raise ValueError("Underpasses require two stair entrances.")
        for portal, end in zip(portals, (points[0], points[-1])):
            if not isinstance(portal, dict):
                raise ValueError("Invalid underpass entrance.")
            upper, lower = point(portal.get("upper")), point(portal.get("lower"))
            if lower != end or upper in unique or abs(upper[0] - lower[0]) + abs(upper[1] - lower[1]) != 1:
                raise ValueError("Invalid underpass entrance.")
        art = route.get("art", [])
        if not isinstance(art, list) or len(art) > 256:
            raise ValueError("Invalid underpass artwork.")
        for item in art:
            point(item)
            if item.get("asset") not in {"stairs-down-w-to-e", "stairs-down-e-to-w", "stairs-down-straight-1x1", "stairs-down-straight-1x2", "tunnel-below", "tunnel-below-wall"} or item.get("turn") not in range(4) or item.get("w") not in (1, 2) or item.get("h") != 1:
                raise ValueError("Invalid underpass artwork.")
