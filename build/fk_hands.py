# FK check: hand trajectories in a baked combo GLB (relative to hips@t0)
import struct, json, sys

path = sys.argv[1] if len(sys.argv) > 1 else 'web/media/glb/combobag-man.glb'
anim_name = sys.argv[2] if len(sys.argv) > 2 else 'combo'

b = open(path, 'rb').read()
ln = struct.unpack('<I', b[12:16])[0]
j = json.loads(b[20:20 + ln])
off = 20 + ln
clen, ctype = struct.unpack('<II', b[off:off + 8])
binb = b[off + 8:off + 8 + clen]

def acc_vals(idx):
    acc = j['accessors'][idx]
    bv = j['bufferViews'][acc['bufferView']]
    o = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    n = acc['count']
    nc = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[acc['type']]
    vals = struct.unpack_from('<' + 'f' * (n * nc), binb, o)
    return [tuple(vals[i * nc:(i + 1) * nc]) for i in range(n)]

nodes = j['nodes']
a = next(x for x in j['animations'] if x['name'] == anim_name)
chan = {}
for ch in a['channels']:
    ni = ch['target']['node']
    path2 = ch['target']['path']
    smp = a['samplers'][ch['sampler']]
    chan[(ni, path2)] = (acc_vals(smp['input']), acc_vals(smp['output']))
parent = {}
for i, n in enumerate(nodes):
    for c in n.get('children', []):
        parent[c] = i

def node_local(ni, t):
    n = nodes[ni]
    tr = list(n.get('translation', [0, 0, 0]))
    ro = list(n.get('rotation', [0, 0, 0, 1]))
    sc = list(n.get('scale', [1, 1, 1]))
    if (ni, 'translation') in chan:
        times, vals = chan[(ni, 'translation')]
        tr = list(vals[min(range(len(times)), key=lambda i: abs(times[i][0] - t))])
    if (ni, 'rotation') in chan:
        times, vals = chan[(ni, 'rotation')]
        ro = list(vals[min(range(len(times)), key=lambda i: abs(times[i][0] - t))])
    x, y, z = tr
    qx, qy, qz, qw = ro
    m = [
        [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
        [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
        [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)]]
    v = [sum(m[i][k] * tr[k] * sc[k] for k in range(3)) for i in range(3)]
    return (m, v)

def world(ni, t):
    chain = []
    cur = ni
    while cur is not None:
        chain.append(cur)
        cur = parent.get(cur)
    wx = wy = wz = 0.0
    M = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    for ni2 in reversed(chain):
        R, T = node_local(ni2, t)
        wx += M[0][0] * T[0] + M[0][1] * T[1] + M[0][2] * T[2]
        wy += M[1][0] * T[0] + M[1][1] * T[1] + M[1][2] * T[2]
        wz += M[2][0] * T[0] + M[2][1] * T[1] + M[2][2] * T[2]
        M = [[sum(M[i][k] * R[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
    return (wx, wy, wz)

name2idx = {n.get('name'): i for i, n in enumerate(nodes)}
lh = name2idx['mixamorig:LeftHand']
rh = name2idx['mixamorig:RightHand']
hx0 = world(name2idx['mixamorig:Hips'], 0)[0]
print('t  LH(rel)  RH(rel)')
for i in range(0, 161, 5):
    t = i / 30.0
    lhv = world(lh, t)
    rhv = world(rh, t)
    print(f"t={t:.2f} LH({lhv[0]-hx0:+.2f},{lhv[1]:.2f},{lhv[2]:+.2f}) RH({rhv[0]-hx0:+.2f},{rhv[1]:.2f},{rhv[2]:+.2f})")
