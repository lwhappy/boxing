import type { Region } from './anchors'

/**
 * Synthesized fight sounds (no audio files): a low thump for weight, a filtered noise crack for the
 * glove slap, and a short whoosh when a punch is thrown. Region changes the character of the hit.
 */
export class FightSfx {
  private readonly noise: AudioBuffer

  constructor(private readonly ctx: AudioContext, private readonly out: AudioNode) {
    const len = Math.floor(ctx.sampleRate * 0.6)
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = this.noise.getChannelData(0)
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1
  }

  private get ready(): boolean {
    return this.ctx.state === 'running'
  }

  private tone(freq: number, end: number, dur: number, type: OscillatorType, vol: number, delay = 0): void {
    const t = this.ctx.currentTime + delay
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(end, 20), t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(this.out)
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  private burst(filter: BiquadFilterType, freq: number, q: number, dur: number, vol: number, delay = 0, sweepTo?: number): void {
    const t = this.ctx.currentTime + delay
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    src.playbackRate.value = 0.9 + Math.random() * 0.2
    const f = this.ctx.createBiquadFilter()
    f.type = filter
    f.frequency.setValueAtTime(freq, t)
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur)
    f.Q.value = q
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.006, dur * 0.2))
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f).connect(g).connect(this.out)
    src.start(t, Math.random() * 0.3)
    src.stop(t + dur + 0.05)
  }

  /** Impact sound. `power` 0.5..1.5 scales loudness and depth. */
  hit(region: Region, power: number): void {
    if (!this.ready) return
    const p = Math.max(0.5, Math.min(1.5, power))
    const v = (Math.random() - 0.5) * 0.12
    switch (region) {
      case 'head':
        this.tone(150 * (1 + v), 48, 0.17, 'sine', 0.95 * p)
        this.burst('highpass', 1700, 0.7, 0.07, 0.7 * p)
        this.burst('bandpass', 3200 * (1 + v), 1.4, 0.045, 0.5 * p, 0.004)
        this.tone(95, 40, 0.28, 'triangle', 0.3 * p, 0.01)
        break
      case 'body':
        this.tone(118 * (1 + v), 40, 0.24, 'sine', 1 * p)
        this.burst('lowpass', 1100, 0.8, 0.12, 0.75 * p)
        this.burst('bandpass', 2200, 1, 0.05, 0.3 * p)
        break
      case 'arm':
        this.burst('bandpass', 1350 * (1 + v), 2.2, 0.075, 0.65 * p)
        this.tone(320, 170, 0.07, 'triangle', 0.32 * p)
        this.tone(140, 70, 0.1, 'sine', 0.35 * p)
        break
      case 'leg':
        this.tone(105, 45, 0.18, 'sine', 0.7 * p)
        this.burst('lowpass', 900, 0.8, 0.09, 0.5 * p)
        break
    }
  }

  /** Air whoosh when a punch enters its strike window. */
  swing(): void {
    if (!this.ready) return
    this.burst('bandpass', 500, 1.2, 0.2, 0.16, 0, 2600)
  }

  ui(): void {
    if (!this.ready) return
    this.tone(660, 720, 0.05, 'triangle', 0.12)
  }
}
