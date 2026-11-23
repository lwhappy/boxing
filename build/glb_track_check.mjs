// Offline GLB animation track sanity: per-clip quaternion discontinuity
// (max jump between consecutive samples, incl. wrap last->first) + durations.
// Usage: node glb_track_check.mjs <file.glb>
import fs from 'node:fs';
const file = process.argv[2] || 'web/media/glb/leadhook-man.glb';
const buf = fs.readFileSync(file);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString());
const binOff = 20 + jsonLen;
const binLen = buf.readUInt32LE(binOff - 8 + 4);
const bin = buf.slice(binOff + 8, binOff + 8 + binLen);

function acc(accIdx) {
  const a = json.accessors[accIdx];
  const bv = json.bufferViews[a.bufferView];
  const start = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const n = a.count;
  const comps = { VEC3: 3, VEC4: 4, SCALAR: 1 }[a.type];
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = start + i * comps * 4;
    const v = [];
    for (let c = 0; c < comps; c++) v.push(bin.readFloatLE(o + c * 4));
    out.push(v);
  }
  return out;
}

const qdist = (a, b) => {
  let d = 0;
  for (let i = 0; i < 4; i++) d += (a[i] - b[i]) ** 2;
  let d2 = 0;
  for (let i = 0; i < 4; i++) d2 += (a[i] + b[i]) ** 2;   // antipodal q ~ -q
  return Math.sqrt(Math.min(d, d2));
};

for (const an of json.animations) {
  const times = new Map();
  let maxStep = 0, maxWrap = 0, worst = '';
  for (const s of an.samplers) {
    if (!times.has(s.input)) times.set(s.input, acc(s.input));
  }
  const durations = [...times.values()].map((t) => t[t.length - 1] - t[0]);
  const dur = Math.max(...durations);
  for (const ch of an.channels) {
    if (ch.target.path !== 'rotation') continue;
    const q = acc(an.samplers[ch.target.node ?? ch.sampler].output ?? an.samplers[ch.sampler].output);
    const tt = times.get(an.samplers[ch.sampler].input);
    // sorted-time check (garbage unsorted entries break interpolation)
    let unsorted = 0;
    for (let i = 1; i < tt.length; i++) if (tt[i] < tt[i - 1]) unsorted++;
    for (let i = 1; i < q.length; i++) {
      const d = qdist(q[i - 1], q[i]);
      if (d > maxStep) { maxStep = d; worst = ch.target.name + ' @' + i + (unsorted ? ' UNSORTED' : ''); }
    }
    const dw = qdist(q[q.length - 1], q[0]);
    if (dw > maxWrap) maxWrap = dw;
  }
  console.log(`${an.name}: dur=${dur.toFixed(2)}s maxStep=${maxStep.toFixed(3)} (${worst}) wrapJump=${maxWrap.toFixed(3)}`);
}
console.log('clips:', json.animations.map((a) => a.name).join(', '));
