"""Infer conservative organic shadow drafts from artwork and artist pen examples."""
import argparse
from collections import defaultdict, deque
import hashlib
import json
import math
from pathlib import Path
import statistics

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

CELL = 54
ASSETS = Path(__file__).resolve().parents[1] / 'S3_content' / 'assets'


def organic(name):
    return name.startswith(('org-', 'black-org-', '1x1-org-')) or 'organic' in name.lower()


def artwork(name):
    path = (ASSETS / name).resolve()
    if not path.is_relative_to(ASSETS.resolve()) or path.is_symlink():
        raise ValueError('Artwork path leaves the asset folder.')
    with Image.open(path) as original:
        image = original.convert('RGBA')
    data = image.tobytes()
    mask = Image.frombytes('L', image.size, bytes(
        255 if data[i+3] > 127 and max(data[i:i+3]) < 64 else 0 for i in range(0, len(data), 4)))
    return image, mask, hashlib.sha256(path.read_bytes()).hexdigest()


def components(mask):
    width, height = mask.size
    data = mask.tobytes()
    labels = [-1] * len(data)
    groups = []
    for start, value in enumerate(data):
        if not value or labels[start] >= 0:
            continue
        group, queue = [], deque([start])
        labels[start] = len(groups)
        while queue:
            index = queue.popleft()
            group.append(index)
            x, y = index % width, index // width
            for nx, ny in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
                neighbor = ny * width + nx
                if 0 <= nx < width and 0 <= ny < height and data[neighbor] and labels[neighbor] < 0:
                    labels[neighbor] = labels[start]
                    queue.append(neighbor)
        groups.append(group)
    return labels, groups


def erode(mask, radius):
    if not radius:
        return mask.copy()
    # Outside the asset is continuation, not a transparent margin to shrink into.
    padded = ImageOps.expand(mask, radius, fill=255).filter(ImageFilter.MinFilter(2*radius+1))
    return padded.crop((radius,radius,mask.width+radius,mask.height+radius))


def boundary_loops(mask):
    width, height = mask.size
    data = mask.tobytes()
    outgoing = defaultdict(set)

    def filled(x,y):
        return 0 <= x < width and 0 <= y < height and data[y*width+x]

    for y in range(height):
        for x in range(width):
            if not filled(x,y):
                continue
            if not filled(x,y-1): outgoing[(x,y)].add((x+1,y))
            if not filled(x+1,y): outgoing[(x+1,y)].add((x+1,y+1))
            if not filled(x,y+1): outgoing[(x+1,y+1)].add((x,y+1))
            if not filled(x-1,y): outgoing[(x,y+1)].add((x,y))
    loops = []
    directions = {(1,0):0,(0,1):1,(-1,0):2,(0,-1):3}
    priority = {1:0,0:1,3:2,2:3}
    while outgoing:
        start = min(outgoing)
        current, previous_direction, points = start, 0, [start]
        while True:
            options = outgoing[current]
            end = min(options, key=lambda point: priority[(directions[(point[0]-current[0],point[1]-current[1])]-previous_direction)%4])
            previous_direction = directions[(end[0]-current[0],end[1]-current[1])]
            options.remove(end)
            if not options: del outgoing[current]
            points.append(end)
            current = end
            if current == start: break
        loops.append(points)
    return loops


def contour_chains(loop, width, height):
    def frame(a,b):
        return a[0] == b[0] and a[0] in (0,width) or a[1] == b[1] and a[1] in (0,height)
    edges = list(zip(loop,loop[1:]))
    border = [i for i,(a,b) in enumerate(edges) if frame(a,b)]
    if not border:
        return [loop]
    offset = border[0] + 1
    edges = edges[offset:] + edges[:offset]
    result, chain = [], []
    for a,b in edges:
        if frame(a,b):
            if len(chain) > 1: result.append(chain)
            chain = []
        else:
            if not chain: chain.append(a)
            chain.append(b)
    if len(chain) > 1: result.append(chain)
    return result


def point_segment_distance(point, a, b):
    dx, dy = b[0]-a[0], b[1]-a[1]
    t = max(0,min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy or 1)))
    return math.hypot(point[0]-a[0]-t*dx,point[1]-a[1]-t*dy)


def path_samples(paths, step=2):
    for path in paths:
        for a,b in zip(path,path[1:]):
            count = max(1,math.ceil(math.dist(a,b)/step))
            for i in range(count):
                yield (a[0]+(b[0]-a[0])*i/count,a[1]+(b[1]-a[1])*i/count)
        yield path[-1]


def black_fraction(points, mask):
    pixels, width, height = mask.tobytes(), mask.width, mask.height
    values = [pixels[min(height-1,max(0,int(y)))*width+min(width-1,max(0,int(x)))] > 0
              for x,y in path_samples([points],.5) if -.01 <= x <= width+.01 and -.01 <= y <= height+.01]
    return sum(values)/len(values) if values else 1


def simplify_open(points, epsilon, mask):
    if len(points) <= 2: return points
    distance, index = max((point_segment_distance(point,points[0],points[-1]),i)
                          for i,point in enumerate(points[1:-1],1))
    if distance <= epsilon and black_fraction([points[0],points[-1]],mask) >= .995:
        return [points[0],points[-1]]
    if distance < .01: index = len(points)//2
    return simplify_open(points[:index+1],epsilon,mask)[:-1] + simplify_open(points[index:],epsilon,mask)


def simplify(points, epsilon, mask):
    if points[0] != points[-1]: return simplify_open(points,epsilon,mask)
    ring = points[:-1]
    anchor = min(range(len(ring)),key=lambda i:ring[i])
    ring = ring[anchor:] + ring[:anchor]
    split = max(range(1,len(ring)),key=lambda i:math.dist(ring[0],ring[i]))
    first = simplify_open(ring[:split+1],epsilon,mask)
    second = simplify_open(ring[split:]+[ring[0]],epsilon,mask)
    return first[:-1] + second


def infer_contours(mask, inset=1, epsilon=1.5, min_area=18):
    _, groups = components(mask)
    filtered = bytearray(mask.width*mask.height)
    for group in groups:
        touches_frame = any(index%mask.width in (0,mask.width-1) or index//mask.width in (0,mask.height-1) for index in group)
        if len(group) >= min_area or touches_frame and len(group)>=3:
            for index in group: filtered[index] = 255
    inset_mask = erode(Image.frombytes('L',mask.size,bytes(filtered)),inset)
    _, inset_groups = components(inset_mask)
    retained = bytearray(len(filtered))
    for group in inset_groups:
        touches_frame = any(index%mask.width in (0,mask.width-1) or index//mask.width in (0,mask.height-1) for index in group)
        if len(group) >= 4 or touches_frame:
            for index in group: retained[index] = 255
    paths = []
    for loop in boundary_loops(Image.frombytes('L',mask.size,bytes(retained))):
        for chain in contour_chains(loop,mask.width,mask.height):
            length = sum(math.dist(a,b) for a,b in zip(chain,chain[1:]))
            touches_frame = any(x in (0,mask.width) or y in (0,mask.height) for x,y in chain)
            if length < (2 if touches_frame else 8): continue
            if chain[0] == chain[-1]:
                area = abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(chain,chain[1:])))/2
                if area < 8: continue
            reduced = simplify(chain,epsilon,mask)
            paths.append(reduced)
    return paths


def light_edges(mask):
    pixels, width, height = mask.tobytes(), mask.width, mask.height
    w,h = width//CELL,height//CELL
    result, fractions = [], {}
    for y in range(h+1):
        for x in range(w):
            row = min(height-1,y*CELL)
            key = f'h:{x}:{y}'
            values = [pixels[row*width+px] > 0 for px in range(x*CELL,(x+1)*CELL)]
            fractions[key] = sum(values)/CELL
            if all(values): result.append(key)
    for y in range(h):
        for x in range(w+1):
            col = min(width-1,x*CELL)
            key = f'v:{x}:{y}'
            values = [pixels[py*width+col] > 0 for py in range(y*CELL,(y+1)*CELL)]
            fractions[key] = sum(values)/CELL
            if all(values): result.append(key)
    return result,fractions


def distance_to_paths(point, paths):
    return min((point_segment_distance(point,a,b) for path in paths for a,b in zip(path,path[1:])),default=CELL)


def quantiles(values):
    ordered = sorted(values)
    if not ordered: return {}
    return {name:round(ordered[round((len(ordered)-1)*q)],3) for name,q in [('p25',.25),('median',.5),('p75',.75),('p90',.9)]}


def calibrate(examples, cache, macro=False):
    training, insets, artist_counts, segment_lengths = [], [], [], []
    for name,rule in examples.items():
        if rule.get('source') == 'inferred': continue
        if name not in cache or ((rule['w']>1 or rule['h']>1) != macro): continue
        mask = cache[name][1]
        paths = [[[x*CELL,y*CELL] for x,y in path['points']] for path in rule['paths'] if path.get('source') != 'inferred']
        if not paths: continue
        training.append((name,paths))
        for path in paths:
            if len(path)>2: artist_counts.append(len(path))
            segment_lengths.extend(math.dist(a,b) for a,b in zip(path,path[1:]) if math.dist(a,b)>2)
        eroded = [erode(mask,r).tobytes() for r in range(6)]
        for x,y in path_samples(paths):
            if not 1 <= x < mask.width-1 or not 1 <= y < mask.height-1: continue
            index = int(y)*mask.width+int(x)
            if not eroded[0][index]: continue
            insets.append(max(r for r,data in enumerate(eroded) if data[index]))
    # Use the artist's inset depth, clamped to preserve narrow wall features.
    inset = max(1,min(2,round(statistics.median(insets) if insets else 1)))
    candidates = []
    for radius in (range(1,4) if macro else [inset]):
        for epsilon in ((1,2,3,4,5,6) if macro else (.75,1,1.25,1.5,2,2.5,3)):
            distances, complexity = [], []
            for name,artist in training:
                mask=cache[name][1]
                inferred = infer_contours(mask,radius,epsilon)
                samples = [point for point in path_samples(artist,4) if 1 <= point[0] < mask.width-1 and 1 <= point[1] < mask.height-1]
                if not inferred or not samples: continue
                distances.extend(distance_to_paths(point,inferred) for point in samples)
                hand_points = sum(len(path) for path in artist if len(path)>2)
                inferred_points = sum(len(path) for path in inferred if len(path)>2)
                if hand_points and inferred_points: complexity.append(abs(math.log(inferred_points/hand_points)))
            median_distance = statistics.median(distances) if distances else CELL
            median_complexity = statistics.median(complexity) if complexity else 0
            score = median_distance + 2*median_complexity
            candidates.append({'inset':radius,'epsilon':epsilon,'score':round(score,4),'medianDistancePx':round(median_distance,3),
                               'medianComplexityLogError':round(median_complexity,3)})
    best = min(candidates,key=lambda item:item['score'])
    return {'insetPx':best['inset'],'epsilonPx':best['epsilon'],'minimumComponentPixels':18,'trainingAssets':len(training),
            'artistContourPointCounts':quantiles(artist_counts),'artistSegmentLengthsPx':quantiles(segment_lengths),
            'artistInsetDepthPx':quantiles(insets),'candidates':candidates}


def contact_sheet(items, cache, destination):
    columns, cell_w, cell_h = 6,220,260
    sheet = Image.new('RGB',(columns*cell_w,math.ceil(len(items)/columns)*cell_h),'#303636')
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf',12)
    for index,(name,rule) in enumerate(items):
        image = cache[name][0]
        left,top = (index%columns)*cell_w,(index//columns)*cell_h
        scale = min(180/image.width,190/image.height)
        size = (round(image.width*scale),round(image.height*scale))
        x,y = left+(cell_w-size[0])//2,top+5
        sheet.paste('#c7b67a',(x,y,x+size[0],y+size[1]))
        sheet.paste(image.resize(size,Image.Resampling.NEAREST),(x,y),image.resize(size,Image.Resampling.NEAREST))
        for path in rule['paths']:
            points = [(x+px*CELL*scale,y+py*CELL*scale) for px,py in path['points']]
            draw.line(points,fill='#54dcff',width=2)
            for px,py in points: draw.ellipse((px-2,py-2,px+2,py+2),fill='#54dcff')
        label = name.removesuffix('.png')
        lines = [label[i:i+29] for i in range(0,len(label),29)]
        draw.multiline_text((left+5,top+199),'\n'.join(lines[:3]),font=font,fill='white',spacing=2)
        draw.text((left+5,top+245),f"{sum(len(p['points']) for p in rule['paths'])} points / {len(rule['paths'])} lines",font=font,fill='#a6e4f0')
    sheet.save(destination)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('evidence',type=Path,help='Normalized artist shadow report, including rules')
    parser.add_argument('output',type=Path)
    parser.add_argument('--sheet',type=Path)
    args = parser.parse_args()
    if args.output.exists(): raise ValueError('Preserve prior drafts; choose a new output filename.')
    evidence = json.loads(args.evidence.read_text(encoding='utf-8'))
    examples = evidence['rules']
    cache = {path.name:artwork(path.name) for path in sorted(ASSETS.iterdir())
             if path.is_file() and organic(path.name) and path.suffix.lower()=='.png' and not path.is_symlink()}
    style = calibrate(examples,cache)
    style['macro'] = calibrate(examples,cache,macro=True)
    rules,report = {},[]
    for name,(image,mask,digest) in cache.items():
        if image.width%CELL or image.height%CELL: raise ValueError(f'Non-grid organic artwork: {name}')
        edges,fractions = light_edges(mask)
        local_style = style['macro'] if image.width>CELL or image.height>CELL else style
        epsilon = local_style['epsilonPx']
        inferred = infer_contours(mask,local_style['insetPx'],epsilon,local_style['minimumComponentPixels'])
        if local_style is style['macro']:
            length = sum(math.dist(a,b) for points in inferred for a,b in zip(points,points[1:]))
            budget = math.ceil(length/local_style['artistSegmentLengthsPx']['median']) + len(inferred)
            while sum(map(len,inferred)) > budget*1.15 and epsilon < 6:
                epsilon += .5
                inferred = infer_contours(mask,local_style['insetPx'],epsilon,local_style['minimumComponentPixels'])
        artist = examples.get(name)
        if artist and (artist['digest']!=digest or artist['w']*CELL!=image.width or artist['h']*CELL!=image.height):
            artist = None
        paths = artist['paths'] if artist is not None else [
            {'id':f'inferred-{digest[:12]}-{index}','points':[[round(x/CELL,4),round(y/CELL,4)] for x,y in points]}
            for index,points in enumerate(inferred)]
        conflicts = []
        explicit = evidence.get('lightAnnotations',{}).get(name,{})
        for key,value in explicit.items():
            if key.startswith('p:'):
                if value: conflicts.append(key)
            elif value and key not in edges: conflicts.append(key)
        raw_coverage = min((black_fraction(points,mask) for points in inferred),default=1)
        source = artist.get('source','artist') if artist is not None else 'inferred'
        reviewed = artist is not None and (source != 'inferred' or artist.get('reviewed') is True)
        review = [] if reviewed else ['inferred contour; artist review requested']
        if conflicts: review.append('artist edge annotation differs from full-black-edge rule')
        if raw_coverage<.99: review.append('narrow or concave feature needs inspection')
        rule = {'digest':digest,'w':image.width//CELL,'h':image.height//CELL,'paths':paths,
                'lightEdges':edges,'explicitLight':explicit,'source':source,'reviewed':reviewed,
                **({'edited':True} if artist is not None and artist.get('edited') else {}),
                'reviewReasons':review,'insetPx':local_style['insetPx'],'epsilonPx':epsilon}
        rules[name] = rule
        report.append({'asset':name,'source':rule['source'],'lines':len(paths),'points':sum(len(path['points']) for path in paths),
                       'fullBlackEdges':edges,'edgeFractions':fractions,'edgeConflicts':conflicts,
                       'inferredSegmentBlackCoverage':round(raw_coverage,5),'reviewReasons':review})
    result = {'version':1,'cellSize':CELL,'style':style,'rules':rules,'assets':report,
              'sourceEvidence':{'file':args.evidence.name,'sha256':hashlib.sha256(args.evidence.read_bytes()).hexdigest()}}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    if args.sheet:
        pending = [(name,rule) for name,rule in rules.items() if rule['reviewReasons']]
        contact_sheet(pending,cache,args.sheet)
    print(json.dumps({'output':str(args.output),'organicAssets':len(rules),
                      'artistAssets':sum(r['source']=='artist' for r in rules.values()),
                      'inferredAssets':sum(r['source']=='inferred' for r in rules.values()),'style':style},indent=2))


if __name__=='__main__': main()
