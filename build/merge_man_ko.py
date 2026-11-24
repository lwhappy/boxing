#!/usr/bin/env python3
"""Append kick-woman's 'knock-out' fall clip into fight-man.glb.

Channels are copied with node indices remapped by NAME and accessors /
bufferViews rebased into the base binary, so the male fighter gets a real
knockdown (his own 'defeat' clip is only a standing stagger).

ROOT-FRAME CORRECTION
---------------------
The source clip's hips root track is authored in the boxer-woman coordinate
space (Y-up rig container, no rotation), but fight-man's container
('Armature') carries rot.x=+90. Copying the hips track verbatim makes the
whole-body drop happen sideways — the fighter keeps standing height while his
body slides a metre through the air instead of falling onto the mat.

So the hips root track is re-expressed in the target frame:
    p' = rest_m + Rx(-90) . (p - rest_src)   (plus LIFT along local -Z)
    q' = Rx(-90) * q
Everything below the hips is untouched (bone rest orientations are identical
between the two rigs — only the container rotation differs).

usage: python3 build/merge_man_ko.py [lift_cm]
"""
import struct
import json
import math
import sys

SRC_BASE = 'web/media/glb/fight-man.glb'
SRC_KICK = 'web/training/boxing-vs-kickboxing/models/kick-woman.glb'
OUT = 'web/media/glb/fight-man.glb'
TAKE = ['knock-out']
LIFT_CM = float(sys.argv[1]) if len(sys.argv) > 1 else 0.0


def load(p):
    b = open(p, 'rb').read()
    ln = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + ln])
    off = 20 + ln
    clen, ctype = struct.unpack('<II', b[off:off + 8])
    return j, b[off + 8:off + 8 + clen]


def read_acc(j, bd, ai):
    acc = j['accessors'][ai]
    bv = j['bufferViews'][acc['bufferView']]
    o = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    ncomp = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[acc['type']]
    cnt = acc['count']
    vals = list(struct.unpack('<%df' % (cnt * ncomp), bd[o:o + cnt * ncomp * 4]))
    return acc, vals, ncomp


def rot_minus_90(v):
    """Rx(-90): (x, y, z) -> (x, z, -y)"""
    return (v[0], v[2], -v[1])


def quat_mul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    )


# The output is also the working asset, so a re-run must start from the
# pristine (pre-merge) file. Pull it straight out of git when the working copy
# already carries the merged clip — this makes the script idempotent.
BASE_REV = '7cbd515'      # "fight/game: swap male fighter to European male sculpt"
import os
import subprocess
import tempfile

if any(a['name'] in TAKE for a in load(SRC_BASE)[0]['animations']):
    tmp = os.path.join(tempfile.gettempdir(), 'fight-man-base.glb')
    with open(tmp, 'wb') as f:
        f.write(subprocess.check_output(['git', 'show', f'{BASE_REV}:{SRC_BASE}']))
    SRC_BASE = tmp
    print(f'base restored from git {BASE_REV}')

jb, bb = load(SRC_BASE)
jk, bk = load(SRC_KICK)

name_b = [n.get('name') or '' for n in jb['nodes']]
name_k = [n.get('name') or '' for n in jk['nodes']]
idx_b = {}
for i, nm in enumerate(name_b):
    idx_b.setdefault(nm, i)

HIPS = next(nm for nm in name_k if nm.endswith('Hips'))
i_k = name_k.index(HIPS)
rest_s = jk['nodes'][i_k]['translation']
rest_m = jb['nodes'][idx_b[HIPS]]['translation']

Q_RINV = (math.sin(-math.pi / 4), 0.0, 0.0, math.cos(-math.pi / 4))

pad = lambda n: (4 - n % 4) % 4

bin_parts = [bb]
cursor = len(bb)
added = []

for aname in TAKE:
    a = next(x for x in jk['animations'] if x['name'] == aname)

    # ---- transform the hips root tracks into the target rig frame ----
    fixed = {}          # old accessor idx -> (raw bytes, min, max)
    for ch in a['channels']:
        if name_k[ch['target']['node']] != HIPS:
            continue
        path = ch['target']['path']
        if path not in ('translation', 'rotation'):
            continue
        old = a['samplers'][ch['sampler']]['output']
        if old in fixed:
            continue
        acc, vals, ncomp = read_acc(jk, bk, old)
        cnt = acc['count']
        out = []
        if path == 'translation':
            for i in range(cnt):
                d = rot_minus_90((vals[i * 3] - rest_s[0],
                                  vals[i * 3 + 1] - rest_s[1],
                                  vals[i * 3 + 2] - rest_s[2]))
                out += [rest_m[0] + d[0], rest_m[1] + d[1], rest_m[2] + d[2] - LIFT_CM]
            mn = [min(out[i::3]) for i in range(3)]
            mx = [max(out[i::3]) for i in range(3)]
        else:
            for i in range(cnt):
                out += list(quat_mul(Q_RINV, (vals[i * 4], vals[i * 4 + 1],
                                              vals[i * 4 + 2], vals[i * 4 + 3])))
            mn = mx = None
        fixed[old] = (struct.pack('<%df' % len(out), *out), mn, mx)
        print(f'  corrected {path} track ({cnt} keys)')

    acc_map = {}
    new_samplers = []
    for s in a['samplers']:
        row = {}
        for role in ('input', 'output'):
            old = s[role]
            if old not in acc_map:
                acc, _, _ = read_acc(jk, bk, old)
                if old in fixed:
                    data, mn, mx = fixed[old]
                else:
                    bv = jk['bufferViews'][acc['bufferView']]
                    o = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
                    n = bv['byteLength'] if acc.get('byteOffset', 0) == 0 else None
                    ncomp = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[acc['type']]
                    n = acc['count'] * ncomp * 4
                    data = bk[o:o + n]
                    mn = acc.get('min')
                    mx = acc.get('max')
                cursor += pad(cursor)
                new_off = cursor
                bin_parts.append(data)
                cursor += len(data)
                jb['bufferViews'].append({'buffer': 0, 'byteOffset': new_off, 'byteLength': len(data)})
                new_acc = {
                    'bufferView': len(jb['bufferViews']) - 1,
                    'componentType': acc['componentType'],
                    'count': acc['count'],
                    'type': acc['type'],
                }
                if mn is not None:
                    new_acc['min'] = [round(v, 6) for v in mn]
                    new_acc['max'] = [round(v, 6) for v in mx]
                jb['accessors'].append(new_acc)
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
out_b = struct.pack('<III', 0x46546C67, 2, total)
out_b += struct.pack('<II', len(js), 0x4E4F534A) + js
out_b += struct.pack('<II', len(merged), 0x004E4942) + merged
open(OUT, 'wb').write(out_b)
print(f'wrote {OUT} ({len(out_b)/1e6:.1f}MB), lift={LIFT_CM}cm, added: {added}')
print('total animations:', len(jb['animations']))
