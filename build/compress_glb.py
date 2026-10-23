#!/usr/bin/env python3
"""Shrink a .glb by re-encoding its textures to JPEG at a smaller size.

Why: the Tripo exports used 4096x4096 RGBA PNGs, which made up ~89% of a 39 MB
file (13-15 MB per base-colour map). Nothing in the scene needs that: both
characters occupy a fraction of a 1600px canvas, and no texture uses alpha.

Roles are read from the material bindings, so the right budget goes to the right
map: base colour 2048, normal 1024, anything unbound 512.

Usage:  compress_glb.py in.glb out.glb
"""
import io
import json
import struct
import sys

from PIL import Image

JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942

BUDGET = {"base": (2048, 86), "normal": (1024, 92), "other": (512, 85)}


def read_glb(path):
    data = open(path, "rb").read()
    if data[:4] != b"glTF":
        raise SystemExit(f"{path}: not a glb")
    off, doc, binary = 12, None, b""
    while off < len(data):
        length, ctype = struct.unpack("<II", data[off:off + 8])
        chunk = data[off + 8:off + 8 + length]
        if ctype == JSON_CHUNK:
            doc = json.loads(chunk)
        elif ctype == BIN_CHUNK:
            binary = chunk
        off += 8 + length
    return doc, binary


def write_glb(path, doc, binary):
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    bn = binary + b"\x00" * ((4 - len(binary) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(bn)
    with open(path, "wb") as fh:
        fh.write(b"glTF" + struct.pack("<II", 2, total))
        fh.write(struct.pack("<II", len(js), JSON_CHUNK) + js)
        fh.write(struct.pack("<II", len(bn), BIN_CHUNK) + bn)


def texture_roles(doc):
    """image index -> 'base' | 'normal' | 'other'"""
    tex_source = {i: t.get("source") for i, t in enumerate(doc.get("textures", []))}
    roles = {}
    for mat in doc.get("materials", []):
        pbr = mat.get("pbrMetallicRoughness", {})
        for key, role in (("baseColorTexture", "base"),
                          ("metallicRoughnessTexture", "normal")):
            idx = pbr.get(key, {}).get("index")
            if idx is not None and tex_source.get(idx) is not None:
                roles[tex_source[idx]] = role
        idx = mat.get("normalTexture", {}).get("index")
        if idx is not None and tex_source.get(idx) is not None:
            roles[tex_source[idx]] = "normal"
    return roles


def shrink(raw, role):
    im = Image.open(io.BytesIO(raw))
    limit, quality = BUDGET[role]
    if max(im.size) > limit:
        ratio = limit / max(im.size)
        im = im.resize((max(1, round(im.width * ratio)), max(1, round(im.height * ratio))),
                       Image.LANCZOS)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        if im.getchannel("A").getextrema()[0] < 250:
            # real transparency: keep PNG, JPEG would flatten it
            buf = io.BytesIO()
            im.save(buf, "PNG", optimize=True)
            return buf.getvalue(), "image/png"
        im = im.convert("RGB")
    elif im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    return buf.getvalue(), "image/jpeg"


def compress(src, dst, verbose=True):
    doc, binary = read_glb(src)
    roles = texture_roles(doc)

    # replace the bytes behind each image bufferView
    replaced = {}
    report = []
    for i, img in enumerate(doc.get("images", [])):
        bv = doc["bufferViews"][img["bufferView"]]
        start = bv.get("byteOffset", 0)
        raw = binary[start:start + bv["byteLength"]]
        before = len(raw)
        new, mime = shrink(raw, roles.get(i, "other"))
        replaced[img["bufferView"]] = (new, mime, i)
        report.append((i, before, len(new), mime))

    # rebuild the binary chunk in bufferView order, keeping 4-byte alignment
    out = bytearray()
    for idx, bv in enumerate(doc["bufferViews"]):
        if idx in replaced:
            payload = replaced[idx][0]
        else:
            start = bv.get("byteOffset", 0)
            payload = binary[start:start + bv["byteLength"]]
        pad = (4 - len(out) % 4) % 4
        if pad:
            out.extend(b"\x00" * pad)
        bv["byteOffset"] = len(out)
        bv["byteLength"] = len(payload)
        out.extend(payload)

    for bv_idx, (payload, mime, img_idx) in replaced.items():
        doc["images"][img_idx]["mimeType"] = mime

    doc["buffers"][0]["byteLength"] = len(out)
    write_glb(dst, doc, bytes(out))

    if verbose:
        print(f"{src} -> {dst}")
        for i, b, a, mime in report:
            print(f"   img{i}: {b/1e6:6.2f} MB -> {a/1e3:7.1f} kB  {mime}")
        import os
        print(f"   glb: {os.path.getsize(src)/1e6:.1f} MB -> {os.path.getsize(dst)/1e6:.1f} MB")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    compress(sys.argv[1], sys.argv[2])
