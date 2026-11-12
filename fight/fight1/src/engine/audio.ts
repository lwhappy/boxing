/**
 * Web Audio mixer with one SFX bus (through a compressor so stacked punches never clip).
 * Browsers only allow audio after a user gesture, so `unlock()` runs on the first press.
 */
export class Audio {
  readonly ctx: AudioContext
  private master: GainNode
  /** Connect sound sources here. */
  readonly sfx: GainNode

  constructor() {
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain()
    this.sfx = this.ctx.createGain()
    const comp = this.ctx.createDynamicsCompressor()
    comp.threshold.value = -10
    comp.ratio.value = 6
    comp.attack.value = 0.002
    comp.release.value = 0.12
    this.sfx.connect(comp).connect(this.master)
    this.master.connect(this.ctx.destination)
  }

  unlock(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  /** Volume in 0..1. */
  setVolume(volume: number, muted = false): void {
    this.master.gain.setTargetAtTime(muted ? 0 : volume, this.ctx.currentTime, 0.05)
  }
}
