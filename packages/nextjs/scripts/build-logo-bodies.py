"""Build compact collision parts from existing logo alpha; python3 scripts/build-logo-bodies.py (Pillow)."""
import json
import math
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
GRID = 16


def rectangles(alpha):
    # Conservative cells: averaging alpha can erase thin visible edges.
    mask = Image.new('L', (GRID, GRID), 0)
    for y in range(GRID):
        for x in range(GRID):
            cell = alpha.crop((math.floor(x*alpha.width/GRID), math.floor(y*alpha.height/GRID),
                               math.ceil((x+1)*alpha.width/GRID), math.ceil((y+1)*alpha.height/GRID)))
            if cell.getextrema()[1] >= 32:
                mask.putpixel((x, y), 255)
    parts, active = [], {}
    for y in range(GRID):
        runs, x = [], 0
        while x < GRID:
            if mask.getpixel((x, y)) < 96:
                x += 1
                continue
            start = x
            while x < GRID and mask.getpixel((x, y)) >= 96:
                x += 1
            runs.append((start, x - start))
        next_active = {}
        for run in runs:
            if run in active:
                rect = active[run]
                rect[3] += 1
            else:
                rect = [run[0], y, run[1], 1]
                parts.append(rect)
            next_active[run] = rect
        active = next_active
    return [[v / GRID for v in rect] for rect in parts]


if __name__ == '__main__':
    solid = Image.new('L', (16, 16), 255)
    assert rectangles(solid) == [[0, 0, 1, 1]]
    assert rectangles(Image.new('L', (16, 16), 0)) == []
    thin = Image.new('L', (256, 256), 0)
    thin.putpixel((8, 8), 255)
    assert rectangles(thin) == [[0, 0, 1/GRID, 1/GRID]]
    solid.paste(0, (4, 4, 12, 12))
    assert abs(sum(w*h for _, _, w, h in rectangles(solid)) - .75) < 1e-9
    logos = json.loads((ROOT / 'services/discover/logos.json').read_text())
    bodies = {}
    for symbol, filename in logos.items():
        path = ROOT / 'public' / filename.lstrip('/')
        # SVG logos keep a raster companion solely for offline alpha sampling.
        image = Image.open(path.with_suffix('.png') if path.suffix == '.svg' else path).convert('RGBA')
        size = max(image.size)
        alpha = Image.new('L', (size, size), 0)
        alpha.paste(image.getchannel('A'), ((size-image.width)//2, (size-image.height)//2))
        parts = rectangles(alpha)
        assert parts, symbol
        bodies[symbol] = parts
    (ROOT / 'services/discover/logo-bodies.json').write_text(json.dumps(bodies, separators=(',', ':')) + '\n')
    print(f'{len(bodies)} alpha silhouettes; max {max(map(len, bodies.values()))} parts, average {sum(map(len, bodies.values()))/len(bodies):.1f}')
