"""Copy one animation from a source GLB into a destination GLB.

The two files share the same Mixamo skeleton (same node names, same joint
order), so a clip can be transplanted by matching channel target nodes by
name. Nothing else in the destination is touched: mesh, skin, materials and
every existing clip keep their exact bytes — only the animation data of the
copied clip is appended to the BIN chunk.

Usage:
  python3 build/glb_copy_anim.py --src man-combos.glb --dst boxer-man.glb \
      --clip jab_cross_x2 --as jab-cross-x2 [--out new.glb]
"""
import json
import struct
import sys
import os
import copy

argv = sys.argv[1:]
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default

SRC = arg("--src")
DST = arg("--dst")
CLIP = arg("--clip")
AS = arg("--as", CLIP)
OUT = arg("--out", "/tmp/glb_copy_anim.out.glb")
assert SRC and DST and CLIP, "need --src --dst --clip"


def read_glb(path):
    data = open(path, "rb").read()
    assert data[:4] == b"glTF", f"{path}: not a glb"
    ver, total = struct.unpack("<II", data[4:12])
    off, chunks = 12, []
    while off < len(data):
        clen, ctype = struct.unpack("<II", data[off:off + 8])
        chunks.append((ctype, off + 8, clen))
        off += 8 + clen
    jchunk = next(c for c in chunks if c[0] == 0x4E4F534A)
    bchunk = next((c for c in chunks if c[0] == 0x004E4942), None)
    j = json.loads(data[jchunk[1]:jchunk[1] + jchunk[2]].decode("utf-8"))
    b = data[bchunk[1]:bchunk[1] + bchunk[2]] if bchunk else b""
    return j, b


def write_glb(path, j, b):
    js = json.dumps(j, separators=(",", ":")).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    b = b + b"\x00" * ((4 - len(b) % 4) % 4)
    total = 12 + 8 + len(js) + (8 + len(b) if b else 0)
    out = bytearray()
    out += b"glTF" + struct.pack("<II", 2, total)
    out += struct.pack("<II", len(js), 0x4E4F534A) + js
    if b:
        out += struct.pack("<II", len(b), 0x004E4942) + b
    open(path, "wb").write(bytes(out))


sj, sb = read_glb(SRC)
dj, db = read_glb(DST)

clip = next((a for a in sj.get("animations", []) if a.get("name") == CLIP), None)
assert clip, f"clip {CLIP} not found in {SRC} (have {[a.get('name') for a in sj.get('animations', [])]})"

# node name -> index in both files
def node_index_map(src, dst):
    dmap = {}
    for i, n in enumerate(dst["nodes"]):
        dmap.setdefault(n.get("name"), i)
    m = {}
    for i, n in enumerate(src["nodes"]):
        name = n.get("name")
        if name in dmap:
            m[i] = dmap[name]
    return m

nmap = node_index_map(sj, dj)
missing = [sj["nodes"][c["target"]["node"]].get("name") for c in clip["channels"] if c["target"]["node"] not in nmap]
assert not missing, f"skeleton mismatch, missing nodes: {sorted(set(missing))}"

buffer_end = len(db)
new_views, new_accessors = {}, {}


def copy_accessor(idx):
    """Copy one source accessor (+ its bufferView bytes) into the destination."""
    if idx in new_accessors:
        return new_accessors[idx]
    acc = copy.deepcopy(sj["accessors"][idx])
    a = acc
    if "bufferView" in a:
        vi = a["bufferView"]
        if vi in new_views:
            a["bufferView"] = new_views[vi]
        else:
            view = copy.deepcopy(sj["bufferViews"][vi])
            start = view.get("byteOffset", 0)
            length = view["byteLength"]
            # 4-byte alignment for the new view
            pad = (4 - (buffer_end % 4)) % 4
            global db
            db += b"\x00" * pad
            view["byteOffset"] = len(db) + pad
            new_views[vi] = len(dj["bufferViews"])
            dj["bufferViews"].append(view)
            db += sb[start:start + length]
            a["bufferView"] = new_views[vi]
    new_accessors[idx] = len(dj["accessors"])
    dj["accessors"].append(a)
    return new_accessors[idx]

# byteLength is only known after all copies — patch at the end
anim = {"name": AS, "channels": [], "samplers": []}
for sm in clip["samplers"]:
    anim["samplers"].append({
        "input": copy_accessor(sm["input"]),
        "output": copy_accessor(sm["output"]),
        "interpolation": sm.get("interpolation", "LINEAR"),
    })
for ch in clip["channels"]:
    anim["channels"].append({
        "sampler": ch["sampler"],
        "target": {"node": nmap[ch["target"]["node"]], "path": ch["target"]["path"]},
    })

dj.setdefault("animations", [])
dj["animations"] = [a for a in dj["animations"] if a.get("name") != AS]
dj["animations"].append(anim)

if not dj.get("buffers"):
    dj["buffers"] = [{"byteLength": 0}]
dj["buffers"][0]["byteLength"] = len(db)

write_glb(OUT, dj, db)
print(f"[copy] {CLIP} -> {OUT} as '{AS}' ({len(anim['channels'])} channels, {len(db)/1048576:.2f} MB bin)")
