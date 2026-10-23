import sys, os, json, struct, re
# Fast structural check of FBX files without Blender: count mixamorig bone refs, geometry presence.
d = "/Users/justrun/project/boxing-3/animations"
rows = []
for fn in sorted(os.listdir(d)):
    if not fn.lower().endswith(".fbx"): continue
    p = os.path.join(d, fn)
    b = open(p, "rb").read()
    size = len(b)
    magic_ok = b[:20].find(b"Kaydara FBX Binary") >= 0 or b[:19].find(b"Kaydara FBX Binary") >= 0
    ver = struct.unpack("<I", b[23:27])[0] if size > 27 else 0
    bones = len(set(re.findall(rb"mixamorig[:_][A-Za-z]+", b)))
    has_mesh = b"Geometry" in b or b"Vertices" in b
    has_skin = b"Deformer" in b and b"Skin" in b
    rows.append({"file": fn, "kb": round(size/1024), "ver": ver, "bones": bones, "mesh": has_mesh, "skin": has_skin})
from collections import Counter
print("files:", len(rows))
print("versions:", Counter(r["ver"] for r in rows))
print("bone-count distribution:", Counter(r["bones"] for r in rows).most_common(6))
print("with mesh:", sum(1 for r in rows if r["mesh"]), "with skin:", sum(1 for r in rows if r["skin"]))
for r in rows:
    if r["mesh"] or r["skin"]:
        print("  SKINNED:", r)
print("size min/max KB:", min(r["kb"] for r in rows), max(r["kb"] for r in rows))
json.dump(rows, open(os.path.join(d, "verify.json"), "w"), indent=1)
