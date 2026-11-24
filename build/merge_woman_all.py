#!/usr/bin/env python3
"""Merge kick-woman's signature clips into boxer-woman.glb's full library.

The two GLBs share an identical Mixamo skeleton (hips translation matches to
1e-9), so animation channels can be copied verbatim — only the binary buffer
needs concatenating with accessor/bufferView offsets rebased.
"""
import struct, json, sys

SRC_BASE = 'web/media/glb/boxer-woman.glb'
SRC_KICK = 'web/training/boxing-vs-kickboxing/models/kick-woman.glb'
OUT = 'web/media/glb/woman-all.glb'
TAKE = ['roundhouse-kick', 'flying-kick', 'knock-out', 'hit-uppercut']

def load(p):
    b = open(p, 'rb').read()
    ln = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + ln])
    off = 20 + ln
    clen, ctype = struct.unpack('<II', b[off:off + 8])
    return j, b[off + 8:off + 8 + clen], b[:20 + ln]

jb, bb, headb = load(SRC_BASE)
jk, bk, _ = load(SRC_KICK)

# sanity: identical skeletons (allow signed-zero float noise)
def close(a, b):
    if a is None and b is None: return True
    if a is None or b is None: return False
    return len(a) == len(b) and all(abs(x - y) < 1e-6 for x, y in zip(a, b))
hips_b = next(n for n in jb['nodes'] if 'Hips' in (n.get('name') or ''))
hips_k = next(n for n in jk['nodes'] if 'Hips' in (n.get('name') or ''))
assert close(hips_b['translation'], hips_k['translation']), 'skeleton mismatch'
assert close(hips_b.get('rotation'), hips_k.get('rotation')), 'skeleton rotation mismatch'

pad = lambda n: (4 - n % 4) % 4   # accessor byteOffsets must stay 4-aligned

bin_parts = [bb]
cursor = len(bb)
added = []
for aname in TAKE:
    a = next(x for x in jk['animations'] if x['name'] == aname)
    # map this animation's samplers/accessors into the base GLB
    acc_map = {}
    for si, s in enumerate(a['samplers']):
        for role in ('input', 'output'):
            old = s[role]
            if old in acc_map:
                continue
            acc = jk['accessors'][old]
            bv = jk['bufferViews'][acc['bufferView']]
            o = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
            n = bv.get('byteLength') or 0
            # derive byteLength from accessor if missing
            comp = {5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}[acc['componentType']]
            ncomp = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[acc['type']]
            n = comp * ncomp * acc['count']
            data = bk[o:o + n]
            cursor += pad(cursor)
            new_off = cursor
            bin_parts.append(data)
            cursor += n
            jb['bufferViews'].append({
                'buffer': 0, 'byteOffset': new_off, 'byteLength': n,
            })
            jb['accessors'].append({
                'bufferView': len(jb['bufferViews']) - 1,
                'componentType': acc['componentType'],
                'count': acc['count'],
                'type': acc['type'],
                **({'min': acc['min'], 'max': acc['max']} if 'min' in acc else {}),
            })
            acc_map[old] = len(jb['accessors']) - 1
    new_samplers = [{'input': acc_map[s['input']], 'output': acc_map[s['output']],
                     'interpolation': s.get('interpolation', 'LINEAR')} for s in a['samplers']]
    jb['animations'].append({'name': aname, 'samplers': new_samplers, 'channels': a['channels']})
    added.append(aname)

merged = b''.join(bin_parts)
assert len(merged) % 4 == 0

# rebuild GLB: JSON chunk + BIN chunk
js = json.dumps(jb, separators=(',', ':')).encode()
js += b' ' * ((4 - len(js) % 4) % 4)
total = 12 + 8 + len(js) + 8 + len(merged)
out = struct.pack('<III', 0x46546C67, 2, total)
out += struct.pack('<II', len(js), 0x4E4F534A) + js
out += struct.pack('<II', len(merged), 0x004E4942) + merged
open(OUT, 'wb').write(out)
print(f'wrote {OUT} ({len(out)/1e6:.1f}MB), added clips: {added}')
print('total animations:', len(jb['animations']))
