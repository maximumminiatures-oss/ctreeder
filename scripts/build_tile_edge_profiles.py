"""Measure boundary cells of multi-cell organic artwork for tentative studies."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import urlsplit

from PIL import Image, ImageFilter

CELL = 54
ASSETS = Path(__file__).resolve().parents[1] / 'S3_content' / 'assets'


def black(pixel):
    return pixel[3] > 127 and max(pixel[:3]) < 64


def measure_cells(path, all_cells=False):
    with Image.open(path) as original:
        image = original.convert('RGBA')
    width, height = image.size
    if width % CELL or height % CELL:
        raise ValueError(f'Artwork does not align to the 54px grid: {path.name}')
    w, h = width // CELL, height // CELL
    safe = []
    if all_cells and path.name.startswith('org-hall-'):
        mask = Image.new('L', image.size)
        mask.putdata([0 if black(pixel) else 255 for pixel in image.getdata()])
        safe = [mask.filter(ImageFilter.MinFilter(size)) for size in (29, 21, 13, 7, 1)]
    cells = []
    for y in range(h):
        for x in range(w):
            if not all_cells and x not in (0, w - 1) and y not in (0, h - 1):
                continue
            left, top, right, bottom = x * CELL, y * CELL, (x + 1) * CELL - 1, (y + 1) * CELL - 1
            corners = {'NW': (left, top), 'NE': (right, top), 'SE': (right, bottom), 'SW': (left, bottom)}
            edges = {'N': [(px, top) for px in range(left, right + 1)],
                     'E': [(right, py) for py in range(top, bottom + 1)],
                     'S': [(px, bottom) for px in range(left, right + 1)],
                     'W': [(left, py) for py in range(top, bottom + 1)]}
            signature = ''.join(key + ('o' if black(image.getpixel(point)) else 'x') for key, point in corners.items())
            signature += ''.join(key + ('o' if sum(black(image.getpixel(point)) for point in points) > CELL / 2 else 'x')
                                 for key, points in edges.items())
            cell = {'x': x, 'y': y, 'signature': signature}
            for mask in safe:
                points = [(px, py) for py in range(top, bottom + 1) for px in range(left, right + 1)
                          if mask.getpixel((px, py))]
                if points:
                    px, py = min(points, key=lambda p: (p[0] - left - 26.5)**2 + (p[1] - top - 26.5)**2)
                    cell['walkPoint'] = [(px + .5) / CELL, (py + .5) / CELL]
                    break
            cells.append(cell)
    return {'id': path.name, 'digest': hashlib.sha256(path.read_bytes()).hexdigest(), 'w': w, 'h': h, 'cells': cells}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('study', help='Study JSON path or loopback asset catalog URL')
    parser.add_argument('output', type=Path)
    parser.add_argument('--all-cells', action='store_true', help='Include interior cells for runtime corridor topology')
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError('Profile file already exists; preserve it and choose another filename.')
    if args.study.startswith('http:'):
        address = urlsplit(args.study)
        if address.hostname not in ('127.0.0.1', 'localhost') or address.path != '/api/catalog':
            raise ValueError('Only the local workbench catalog is supported.')
        with urlopen(args.study, timeout=10) as response:
            study = json.load(response)
    else:
        study = json.loads(Path(args.study).read_text(encoding='utf-8'))
    if 'assets' in study and 'pages' not in study:
        names = sorted({asset['id'] for asset in study['assets']
                        if (args.all_cells and (asset['id'].startswith(('org-', 'black-org', '1x1-org', 'crypt '))))
                        or (not args.all_cells and asset['id'].startswith('org-') and (asset['w'] > 1 or asset['h'] > 1))})
    else:
        names = sorted({tile['asset'] for page in study['pages'] for tile in page['placements']
                        if tile['asset'].startswith('org-') and (tile['w'] > 1 or tile['h'] > 1)})
    profiles = []
    for name in names:
        path = (ASSETS / name).resolve()
        if not path.is_relative_to(ASSETS.resolve()):
            raise ValueError('Asset path leaves the website asset folder.')
        profiles.append(measure_cells(path, args.all_cells))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({'version': 1, 'cellSize': CELL, 'assets': profiles}, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'macroAssets': len(profiles),
                      'boundaryCells': sum(len(profile['cells']) for profile in profiles)}, indent=2))


if __name__ == '__main__':
    main()
