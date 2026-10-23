"""Print a compact summary of a .glb: animations, skins, meshes, nodes of interest.

usage: python3 build/glb_info.py path.glb
"""
import json
import struct
import sys


def read_glb(path):
    with open(path, "rb") as f:
        magic, version, length = struct.unpack("<4sII", f.read(12))
        assert magic == b"glTF", magic
        chunk_len, chunk_type = struct.unpack("<I4s", f.read(8))
        js = json.loads(f.read(chunk_len))
    return js


def main(path):
    g = read_glb(path)
    acc = g.get("accessors", [])
    print("file:", path)
    print("meshes:", len(g.get("meshes", [])), "nodes:", len(g.get("nodes", [])), "skins:", len(g.get("skins", [])), "materials:", len(g.get("materials", [])))
    for i, s in enumerate(g.get("skins", [])):
        print(f"  skin[{i}] joints={len(s.get('joints', []))}")
    print("animations:")
    for a in g.get("animations", []):
        dur = 0.0
        for s in a.get("samplers", []):
            mx = acc[s["input"]].get("max")
            if mx:
                dur = max(dur, mx[0])
        chans = len(a.get("channels", []))
        print(f"  - {a.get('name')}: {dur:.3f}s, channels={chans}")
    names = [n.get("name", "") for n in g.get("nodes", [])]
    picked = [n for n in names if any(k in n for k in ("hit-stomucher", "Speaker", "Armature", "tripo_node"))]
    print("key nodes:", picked)
    print("has morphtargets:", any("targets" in m.get("primitives", [{}])[0] for m in g.get("meshes", []) if m.get("primitives")))


if __name__ == "__main__":
    main(sys.argv[1])
