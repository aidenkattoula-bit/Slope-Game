// =============================================================================
// AUDIO - everything synthesised with the Web Audio API (no sound files)
//  * whoosh: looping filtered noise + a tone, both rising in pitch with speed
//  * crash:  noise burst through a falling low-pass + sub thump
//  * blip:   short rising sine every 100 points
//  * mute toggle (persisted by the caller)
// =============================================================================
export class AudioSys {
  constructor(muted = false) {
    this.ctx = null;
    this.muted = muted;
    this.running = false;
  }

  /** Must be called from a user gesture (key / click / touch). */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(ctx.destination);

    // shared noise buffer (2 s of white noise)
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // whoosh chain
    this.wNoise = ctx.createBufferSource();
    this.wNoise.buffer = this.noiseBuf;
    this.wNoise.loop = true;
    this.wFilter = ctx.createBiquadFilter();
    this.wFilter.type = 'bandpass';
    this.wFilter.Q.value = 0.9;
    this.wFilter.frequency.value = 300;
    this.wGain = ctx.createGain();
    this.wGain.gain.value = 0;
    this.wNoise.connect(this.wFilter).connect(this.wGain).connect(this.master);
    this.wNoise.start();

    this.wTone = ctx.createOscillator();
    this.wTone.type = 'triangle';
    this.wTone.frequency.value = 90;
    this.wToneGain = ctx.createGain();
    this.wToneGain.gain.value = 0;
    this.wTone.connect(this.wToneGain).connect(this.master);
    this.wTone.start();
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.02);
  }

  /** Begin the whoosh (call when a run starts). */
  start() {
    this.init();
    this.running = true;
  }

  /** Stop the whoosh (crash / pause / menu). */
  stop() {
    this.running = false;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.wGain.gain.setTargetAtTime(0, t, 0.08);
    this.wToneGain.gain.setTargetAtTime(0, t, 0.08);
  }

  /** speed01: 0..1 of max speed. airborne: quieter, thinner wind. */
  setSpeed(speed01, airborne = false) {
    if (!this.ctx || !this.running) return;
    const t = this.ctx.currentTime;
    const s = Math.min(1, Math.max(0, speed01));
    this.wFilter.frequency.setTargetAtTime(250 + s * s * 2600, t, 0.1);
    this.wGain.gain.setTargetAtTime((0.05 + s * 0.2) * (airborne ? 0.7 : 1), t, 0.1);
    this.wTone.frequency.setTargetAtTime(80 + s * 220, t, 0.1);
    this.wToneGain.gain.setTargetAtTime((0.015 + s * 0.035) * (airborne ? 0.4 : 1), t, 0.1);
  }

  crash() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3000, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t); src.stop(t + 0.85);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.45);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.9, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(og).connect(this.master);
    o.start(t); o.stop(t + 0.55);
  }

  blip() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(1320, t + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.18);
  }

  land(impact = 8) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
    const g = ctx.createGain();
    const vol = Math.min(0.5, 0.1 + impact * 0.02);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.2);
  }

  click() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(520, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.06);
  }
}
