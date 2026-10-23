import numpy as np
from scipy import signal
import wave, struct

SR = 44100
DUR = 0.55
n = int(SR * DUR)
t = np.arange(n) / SR
rng = np.random.default_rng(20261020)

def env(tau, t0=0.0):
    x = np.clip(t - t0, 0, None)
    return np.exp(-x / tau) * (t >= t0)

def bp(x, lo, hi, order=2):
    b, a = signal.butter(order, [lo / (SR / 2), hi / (SR / 2)], btype='band')
    return signal.lfilter(b, a, x)

def lp(x, f, order=2):
    b, a = signal.butter(order, f / (SR / 2), btype='low')
    return signal.lfilter(b, a, x)

def hp(x, f, order=2):
    b, a = signal.butter(order, f / (SR / 2), btype='high')
    return signal.lfilter(b, a, x)

noise = rng.standard_normal(n)

# 1) 起始瞬态：手套皮面接触的高频「啪」
click = hp(noise, 2500, 3) * env(0.0035)
click /= np.max(np.abs(click)) + 1e-9

# 2) 中频「啪/噗」：280-2200Hz 噪声，衰减 45ms
smack = bp(noise, 280, 2200, 2) * env(0.045)
smack /= np.max(np.abs(smack)) + 1e-9

# 3) 拳头冲击的低频 thud：130 -> 52 Hz 快速下滑 + 饱和
f0, f1, glide = 130.0, 52.0, 0.055
freq = f0 * (f1 / f0) ** np.clip(t / glide, 0, 1)
phase = 2 * np.pi * np.cumsum(freq) / SR
thud = np.sin(phase) * env(0.085)
thud = np.tanh(thud * 1.7)

# 4) 身体被击中的胸腔回响：55-160Hz，稍慢衰减
body = lp(bp(noise, 55, 200, 2), 220) * env(0.13, 0.012)
body /= np.max(np.abs(body)) + 1e-9

# 5) 极短房间尾巴（两次衰减反射，模拟室内感）
tail = bp(noise, 400, 3500) * (env(0.22, 0.03) * 0.10)

leather = hp(bp(noise, 1500, 6000, 2), 1200) * env(0.012)
leather /= np.max(np.abs(leather)) + 1e-9

mix = (
    1.00 * click +
    1.20 * smack +
    0.42 * thud +
    0.14 * body +
    0.85 * leather +
    tail
)

# 轻微软削波，增加冲击感
mix = hp(np.tanh(mix * 1.1), 60, 2)
mix /= np.max(np.abs(mix)) + 1e-9
mix *= 0.92

# 1ms 淡入 / 末端 40ms 淡出，避免爆音
fade_in = int(0.001 * SR)
mix[:fade_in] *= np.linspace(0, 1, fade_in)
fade_out = int(0.04 * SR)
mix[-fade_out:] *= np.linspace(1, 0, fade_out)

out = '/Users/justrun/project/boxing-3/resources/audio/punch-impact.wav'
with wave.open(out, 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(b''.join(struct.pack('<h', int(v * 32767)) for v in mix))

print('written', out)
print('peak', round(float(np.max(np.abs(mix))), 3), 'rms', round(float(np.sqrt(np.mean(mix**2))), 4))
for tb in (0.0, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5):
    i = int(tb * SR)
    seg = mix[i:i + int(0.02 * SR)]
    print('  t=%.2fs  amp=%.3f' % (tb, float(np.max(np.abs(seg)))))
