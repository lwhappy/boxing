# Find duplicate-content FBX groups in an animations dir, delete them and reset manifest status.
import hashlib, os, json, sys
from collections import defaultdict
d = sys.argv[1]
mani = os.path.join(d, 'manifest.json')
m = json.load(open(mani))
by_file = {i['file']: i for i in m['items']}
h = defaultdict(list)
for fn in os.listdir(d):
    if fn.endswith('.fbx'):
        h[hashlib.md5(open(os.path.join(d, fn), 'rb').read()).hexdigest()].append(fn)
dups = [v for v in h.values() if len(v) > 1]
files = sorted(f for g in dups for f in g)
for f in files:
    os.remove(os.path.join(d, f))
    if f in by_file:
        by_file[f]['status'] = 'pending'
        by_file[f].pop('bytes', None)
json.dump(m, open(mani, 'w'), indent=1)
print(f"{d}: dup groups={len(dups)} files reset={len(files)}")
for g in dups: print('  ', g)
