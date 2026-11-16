"""TopoJSON (states) -> pre-projected, simplified SVG paths for the LFL India map.

Regenerate src/modules/lfl/components/map/india-states.json:
  curl -L -o india.topo.json https://cdn.jsdelivr.net/gh/udit-001/india-maps-data@2884453/topojson/india.json
  python scripts/build-india-map.py 0.6   # simplification tolerance in map units
  cp india-states.json src/modules/lfl/components/map/

Outline follows India's official depiction (all of J&K and Ladakh). Keep the
projection constants in sync with components/map/geo.ts.
"""
import json, math, sys
t = json.load(open("india.topo.json"))
sx, sy = t["transform"]["scale"]; tx, ty = t["transform"]["translate"]
arcs = []
for arc in t["arcs"]:
    x = y = 0; pts = []
    for dx, dy in arc:
        x += dx; y += dy
        pts.append((x * sx + tx, y * sy + ty))
    arcs.append(pts)

# Equirectangular scaled by cos(mid-latitude): close enough for a country this size.
LON0, LAT1, K = 67.5, 37.8, math.cos(math.radians(22))
SCALE = 1000 / ((97.6 - LON0) * K)
def proj(lon, lat):
    return ((lon - LON0) * K * SCALE, (LAT1 - lat) * SCALE)

def ring(indexes):
    pts = []
    for i in indexes:
        a = arcs[i] if i >= 0 else list(reversed(arcs[~i]))
        pts.extend(a if not pts else a[1:])
    return pts

def simplify(pts, tol):
    if len(pts) < 4: return pts
    # Douglas-Peucker
    def dp(a, b):
        (x1, y1), (x2, y2) = pts[a], pts[b]
        dx, dy = x2 - x1, y2 - y1; L = math.hypot(dx, dy) or 1e-9
        best, idx = 0, None
        for i in range(a + 1, b):
            d = abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / L
            if d > best: best, idx = d, i
        if best > tol and idx:
            return dp(a, idx)[:-1] + dp(idx, b)
        return [pts[a], pts[b]]
    # Closed ring: start == end, so split at the point farthest from the start.
    far = max(range(len(pts)), key=lambda i: math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]))
    return dp(0, far)[:-1] + dp(far, len(pts) - 1)

TOL = float(sys.argv[1]) if len(sys.argv) > 1 else 0.6
states = []
minx = miny = 1e9; maxx = maxy = -1e9
for g in t["objects"]["states"]["geometries"]:
    polys = g["arcs"] if g["type"] == "MultiPolygon" else [g["arcs"]]
    rings = []
    for poly in polys:
        for r in poly:
            full = [proj(*xy) for xy in ring(r)]
            p = simplify(full, TOL)
            if len(p) < 3: p = full  # tiny islands: keep unsimplified
            area = abs(sum(p[i][0] * p[i - 1][1] - p[i - 1][0] * p[i][1] for i in range(len(p)))) / 2
            rings.append((area, p))
    biggest = max(a for a, _ in rings)
    d = []
    for area, p in rings:
        # Drop specks unless the state is only specks (e.g. Lakshadweep keeps its islands).
        if area < 1.5 and biggest >= 1.5: continue
        for x, y in p:
            minx, miny, maxx, maxy = min(minx, x), min(miny, y), max(maxx, x), max(maxy, y)
        d.append("M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in p) + "Z")
    states.append({"code": g["properties"]["st_code"], "name": g["properties"]["st_nm"], "d": "".join(d)})

out = {
    "source": "udit-001/india-maps-data (states topojson @2884453), simplified",
    "projection": {"lon0": LON0, "lat1": LAT1, "k": K, "scale": SCALE},
    "viewBox": [math.floor(minx) - 4, math.floor(miny) - 4, math.ceil(maxx - minx) + 8, math.ceil(maxy - miny) + 8],
    "states": states,
}
json.dump(out, open("india-states.json", "w"), separators=(",", ":"))
print("bbox lat:", round(t["bbox"][1], 2), "→", round(t["bbox"][3], 2), "lon:", round(t["bbox"][0], 2), "→", round(t["bbox"][2], 2))
print("viewBox", out["viewBox"], "bytes", len(json.dumps(out, separators=(",", ":"))))
