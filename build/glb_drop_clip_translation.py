"""Drop all `translation` channels of one animation inside a GLB.

Used for clips transplanted between GLBs whose hips translation channels were
authored in a different unit space (the source clip's hips keys are metres, the
destination rig is centimetres), which collapses the skeleton. Rotations are
unit quaternions in bone-local space and are rig-independent, so keeping only
the rotation channels preserves the motion; the hips stay at the height the
previous clip left them.

Usage:  python3 build/glb_drop_clip_translation.py in.glb clip-name out.glb
"""
import json
import struct
import sys

SRC, CLIP, OUT = sys.argv[1], sys.argv[2], sys.argv[3]

data = open(SRC, "rb").read()
assert data[:4] == b"glTF", f"{SRC}: not a glb"
off, doc, binary = 12, None, b""
while off < len(data):
    length, ctype = struct.unpack("<II", data[off:off + 8])
    chunk = data[off + 8:off + 8 + length]
    if ctype == 0x4E4F534A:
        doc = json.loads(chunk)
    elif ctype == 0x004E4942:
        binary = chunk
    off += 8 + length

clip = next((a for a in doc["animations"] if a.get("name") == CLIP), None)
assert clip, f"clip {CLIP} not found (have {[a.get('name') for a in doc['animations']]})"
before = len(clip["channels"])
clip["channels"] = [c for c in clip["channels"] if c["target"]["path"] != "translation"]
print(f"[drop] {CLIP}: channels {before} -> {len(clip['channels'])}")

js = json.dumps(doc, separators=(",", ":")).encode()
js += b" " * ((4 - len(js) % 4) % 4)
bn = binary + b"\x00" * ((4 - len(binary) % 4) % 4)
total = 12 + 8 + len(js) + 8 + len(bn)
with open(OUT, "wb") as fh:
    fh.write(b"glTF" + struct.pack("<II", 2, total))
    fh.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
    fh.write(struct.pack("<II", len(bn), 0x004E4942) + bn)
print(f"[drop] wrote {OUT}")
