"""
Rotate one animation's root joint in a GLB so the body stands up.

Measured in the page: for 'left-uppercut' the hips->head vector came out as
(-0.27, 0, 0) while every other clip gives (0, +0.27, 0) — the take is lying on
its side. This premultiplies the hips rotation track by the world-space fix,
converted into the hips' parent space, and writes the GLB back in place.

Usage:
  python3 build/glb_fix_clip_up.py web/media/glb/man-hero.glb left-uppercut \
      --from=-1,0,0 --to=0,1,0
"""
import json
import math
import struct
import sys

path = sys.argv[1]
clip_name = sys.argv[2]
args = dict(a.split("=", 1) for a in sys.argv[3:] if a.startswith("--"))
src = [float(v) for v in args.get("--from", "-1,0,0").split(",")]
fix_translation = "--fix-translation" in args
dst = [float(v) for v in args.get("--to", "0,1,0").split(",")]

data = open(path, "rb").read()
assert data[:4] == b"glTF", "not a glb"
ver, total = struct.unpack("<II", data[4:12])
off = 12
chunks = []
while off < len(data):
    clen, ctype = struct.unpack("<II", data[off:off + 8])
    chunks.append((ctype, off + 8, clen))
    off += 8 + clen
jchunk = next(c for c in chunks if c[0] == 0x4E4F534A)
bchunk = next(c for c in chunks if c[0] == 0x004E4942)
j = json.loads(data[jchunk[1]:jchunk[1] + jchunk[2]].decode("utf-8"))
bin_start = bchunk[1]


# ---- quaternion helpers (x, y, z, w as in glTF) ----
def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    )


def qnorm(q):
    n = math.sqrt(sum(v * v for v in q)) or 1.0
    return tuple(v / n for v in q)


def qconj(q):
    return (-q[0], -q[1], -q[2], q[3])


def qaxis(axis, deg):
    h = math.radians(deg) / 2
    n = math.sqrt(sum(v * v for v in axis)) or 1.0
    s = math.sin(h) / n
    return (axis[0] * s, axis[1] * s, axis[2] * s, math.cos(h))


def qbetween(a, b):
    """shortest-arc rotation taking direction a to direction b"""
    import math as m
    na = m.sqrt(sum(v * v for v in a)) or 1.0
    nb = m.sqrt(sum(v * v for v in b)) or 1.0
    a = [v / na for v in a]
    b = [v / nb for v in b]
    dot = sum(x * y for x, y in zip(a, b))
    dot = max(-1.0, min(1.0, dot))
    if dot > 0.999999:
        return (0.0, 0.0, 0.0, 1.0)
    if dot < -0.999999:
        # 180 deg: pick any perpendicular axis
        axis = [1.0, 0.0, 0.0] if abs(a[0]) < 0.9 else [0.0, 1.0, 0.0]
        cx = a[1] * axis[2] - a[2] * axis[1]
        cy = a[2] * axis[0] - a[0] * axis[2]
        cz = a[0] * axis[1] - a[1] * axis[0]
        return qnorm((cx, cy, cz, 0.0))
    cx = a[1] * b[2] - a[2] * b[1]
    cy = a[2] * b[0] - a[0] * b[2]
    cz = a[0] * b[1] - a[1] * b[0]
    w = 1.0 + dot
    return qnorm((cx, cy, cz, w))


def node_parent_map(j):
    parent = {}
    for i, n in enumerate(j["nodes"]):
        for c in n.get("children", []):
            parent[c] = i
    return parent


def node_rot(j, i):
    n = j["nodes"][i]
    if "rotation" in n:
        return tuple(n["rotation"])
    return (0.0, 0.0, 0.0, 1.0)


def world_rot(j, parent, i):
    q = (0.0, 0.0, 0.0, 1.0)
    chain = []
    cur = i
    while cur is not None:
        chain.append(cur)
        cur = parent.get(cur)
    for idx in reversed(chain):
        q = qmul(q, node_rot(j, idx))
    return q


parent = node_parent_map(j)
anim = next((a for a in j["animations"] if a.get("name") == clip_name), None)
assert anim, f"animation {clip_name} not found: {[a.get('name') for a in j['animations']]}"

fix_world = qbetween(src, dst)
print(f"[glb] fix world: {tuple(round(v, 4) for v in fix_world)} "
      f"({math.degrees(2 * math.acos(max(-1, min(1, fix_world[3])))):.1f} deg)")

def qrot(q, v):
    """rotate vector v by quaternion q"""
    x, y, z, w = q
    vx, vy, vz = v
    # t = 2 * cross(q.xyz, v)
    tx = 2 * (y * vz - z * vy)
    ty = 2 * (z * vx - x * vz)
    tz = 2 * (x * vy - y * vx)
    return (vx + w * tx + (y * tz - z * ty),
            vy + w * ty + (z * tx - x * tz),
            vz + w * tz + (x * ty - y * tx))


touched = 0
touched_t = 0
for ch in anim["channels"]:
    if ch["target"]["path"] not in ("rotation", "translation"):
        continue
    node = ch["target"]["node"]
    if "Hips" not in (j["nodes"][node].get("name") or ""):
        continue
    par = parent.get(node)
    par_world = world_rot(j, parent, par) if par is not None else (0.0, 0.0, 0.0, 1.0)
    fix_local = qmul(qmul(qconj(par_world), fix_world), par_world)
    samp = anim["samplers"][ch["sampler"]]
    acc = j["accessors"][samp["output"]]
    if ch["target"]["path"] == "translation":
        if not fix_translation:
            continue
        assert acc["type"] == "VEC3" and acc["componentType"] == 5126, "expected float VEC3"
        bv = j["bufferViews"][acc["bufferView"]]
        base = bin_start + bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
        stride = bv.get("byteStride", 12)
        n = acc["count"]
        out = bytearray()
        for k in range(n):
            x, y, z = struct.unpack_from("<3f", data, base + k * stride)
            v = qrot(fix_local, (x, y, z))
            out += struct.pack("<3f", *v)
        buf = bytearray(data)
        buf[base:base + n * stride] = out
        data = bytes(buf)
        touched_t += 1
        print(f"[glb] rotated hips translation node {node} keys={n}")
        continue
    assert acc["type"] == "VEC4" and acc["componentType"] == 5126, "expected float VEC4"
    bv = j["bufferViews"][acc["bufferView"]]
    base = bin_start + bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = bv.get("byteStride", 16)
    n = acc["count"]
    out = bytearray()
    for k in range(n):
        x, y, z, w = struct.unpack_from("<4f", data, base + k * stride)
        q = qmul(fix_local, (x, y, z, w))
        q = qnorm(q)
        if q[3] < 0:
            q = (-q[0], -q[1], -q[2], -q[3])
        out += struct.pack("<4f", *q)
    buf = bytearray(data)
    buf[base:base + n * stride] = out
    data = bytes(buf)
    touched += 1
    print(f"[glb] rotated hips node {node} ({j['nodes'][node].get('name')}) keys={n}")

assert touched, "no hips rotation channel patched"
print(f"[glb] translation channels patched: {touched_t}")
open(path, "wb").write(data)
print(f"[glb] wrote {path} ({len(data)/1024:.0f} KB)")
