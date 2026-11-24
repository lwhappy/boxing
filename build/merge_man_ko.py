#!/usr/bin/env python3
"""Append kick-woman's 'knock-out' fall clip into fight-man.glb.

Both GLBs are the same Mixamo pipeline (cm units, Armature scale 0.01,
rot.x +90) and share identical bone names, so channels are copied with
node indices remapped by NAME and accessors/bufferViews rebased into the
base binary. This gives the male fighter a real knockdown (his own
'defeat' clip is only a standing stagger).
"""
import struct, json

SRC_BASE = 'web/media/glb/fight-man.glb'
SRC_KICK = 'web/training/boxing-vs-kickboxing/models/kick-woman.glb'
OUT = 'web/media/glb/fight-man.glb'
TAKE = ['knock-out']

def load(p):
    b = open(p, 'rb').read()
    ln = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + ln])
    off = 20 + ln
    clen, ctype = struct.unpack('<II', b[off:off + 8])
    return j, b[off + 8:off + 8 + clen], b[:20 + ln]

jb, bb, headb = load(SRC_BASE)
jk, bk, _ = load(SRC_KICK)

name_b = [n.get('name') or '' for n in jb['nodes']]
name_k = [n.get('name') or '' for n in jk['nodes']]
idx_b = {}
for i, nm in enumerate(name_b):
    idx_b.setdefault(nm, i)

pad = lambda n: (4 - n % 4) % 4

bin_parts = [bb]
cursor = len(bb)
added = []
for aname in TAKE:
    a = next(x for x in jk['animations'] if x['name'] == aname)
    acc_map = {}
    new_samplers = []
    for s in a['samplers']:
        row = {}
        for role in ('input', 'output'):
            old = s[role]
            if old not in acc_map:
                acc = jk['accessors'][old]
                bv = jk['bufferViews'][acc['bufferView']]
                o = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
                comp = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}[acc['componentType']]
                ncomp = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[acc['type']]
                n = comp * ncomp * acc['count']
                data = bk[o:o + n]
                cursor += pad(cursor)
                new_off = cursor
                bin_parts.append(data)
                cursor += n
                jb['bufferViews'].append({'buffer': 0, 'byteOffset': new_off, 'byteLength': n})
                jb['accessors'].append({
                    'bufferView': len(jb['bufferViews']) - 1,
                    'componentType': acc['componentType'],
                    'count': acc['count'],
                    'type': acc['type'],
                    **({'min': acc['min'], 'max': acc['max']} if 'min' in acc else {}),
                })
                acc_map[old] = len(jb['accessors']) - 1
            row[role] = acc_map[old]
        new_samplers.append({**row, 'interpolation': s.get('interpolation', 'LINEAR')})
    new_channels = []
    for ch in a['channels']:
        tgt = ch['target']
        nm = name_k[tgt['node']]
        assert nm in idx_b, f'bone {nm!r} missing in fight-man'
        new_channels.append({**ch, 'target': {**tgt, 'node': idx_b[nm]}})
    jb['animations'].append({'name': aname, 'samplers': new_samplers, 'channels': new_channels})
    added.append(aname)

merged = b''.join(bin_parts)
assert len(merged) % 4 == 0

js = json.dumps(jb, separators=(',', ':')).encode()
js += b' ' * ((4 - len(js) % 4) % 4)
total = 12 + 8 + len(js) + 8 + len(merged)
out = struct.pack('<III', 0x46546C67, 2, total)
out += struct.pack('<II', len(js), 0x4E4F534A) + js
out += struct.pack('<II', len(merged), 0x004E4942) + merged
open(OUT, 'wb').write(out)
print(f'wrote {OUT} ({len(out)/1e6:.1f}MB), added clips: {added}')
print('total animations:', len(jb['animations']))
