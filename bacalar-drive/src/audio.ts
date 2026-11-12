/**
 * All game sounds are synthesized with WebAudio: no audio files to download or license.
 * Browsers only allow audio after a user gesture, so the context starts on the first key
 * press or touch.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private screech: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private rain: { gain: GainNode } | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;

  constructor() {
    try { this.muted = localStorage.getItem('bjg-muted') === '1'; } catch { /* storage unavailable */ }
    const start = () => this.start();
    window.addEventListener('keydown', start);
    window.addEventListener('pointerdown', start);
  }

  private start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // white noise buffer shared by tires, rain and impacts
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // engine: two detuned sawtooths through a low-pass filter
    const osc = ctx.createOscillator(), osc2 = ctx.createOscillator();
    osc.type = 'sawtooth'; osc2.type = 'square';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 600; filter.Q.value = 3;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    osc.connect(filter); osc2.connect(g2).connect(filter);
    filter.connect(gain).connect(this.master);
    osc.start(); osc2.start();
    this.engine = { osc, osc2, filter, gain };

    // tire screech: band-passed noise
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const sf = ctx.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 2400; sf.Q.value = 6;
    const sg = ctx.createGain(); sg.gain.value = 0;
    src.connect(sf).connect(sg).connect(this.master);
    src.start();
    this.screech = { src, gain: sg, filter: sf };

    // rain: low-passed noise
    const rs = ctx.createBufferSource();
    rs.buffer = this.noiseBuf; rs.loop = true;
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 1800;
    const rg = ctx.createGain(); rg.gain.value = 0;
    rs.connect(rf).connect(rg).connect(this.master);
    rs.start();
    this.rain = { gain: rg };
  }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('bjg-muted', this.muted ? '1' : '0'); } catch { /* storage unavailable */ }
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /**
   * Per-frame engine state.
   * @param kind which engine voice to use
   * @param speed01 0..1 fraction of top speed
   * @param throttle 0..1
   * @param slip 0..1 tire slip (handbrake, hard cornering)
   */
  update(kind: 'jeep' | 'moto' | 'boat' | 'none', speed01: number, throttle: number, slip: number, rain: number) {
    const ctx = this.ctx;
    if (!ctx || !this.engine) return;
    const t = ctx.currentTime;
    const e = this.engine;
    if (kind === 'none') {
      e.gain.gain.setTargetAtTime(0, t, 0.15);
    } else {
      // fake gearbox: rpm climbs within each gear, drops on shift
      const gears = kind === 'boat' ? 1 : 5;
      const g = Math.min(gears - 1, Math.floor(speed01 * gears));
      const inGear = speed01 * gears - g;
      const rpm = 0.25 + 0.75 * (gears === 1 ? speed01 : (0.3 + 0.7 * inGear)) * (0.85 + throttle * 0.15);
      const base = kind === 'jeep' ? 42 : kind === 'moto' ? 70 : 55;
      const f = base + rpm * base * 2.6;
      e.osc.frequency.setTargetAtTime(f, t, 0.05);
      e.osc2.frequency.setTargetAtTime(f * (kind === 'moto' ? 2.01 : 0.502), t, 0.05);
      e.filter.frequency.setTargetAtTime(350 + rpm * 1500 + throttle * 600, t, 0.08);
      e.gain.gain.setTargetAtTime(0.06 + throttle * 0.07 + speed01 * 0.05, t, 0.08);
    }
    this.screech!.gain.gain.setTargetAtTime(Math.min(0.22, slip * 0.25), t, 0.05);
    this.rain!.gain.gain.setTargetAtTime(rain * 0.12, t, 0.5);
  }

  private env(node: AudioParam, t: number, peak: number, attack: number, decay: number) {
    node.setValueAtTime(0, t);
    node.linearRampToValueAtTime(peak, t + attack);
    node.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private tone(freq: number, type: OscillatorType, when: number, dur: number, peak: number, slideTo?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, when + dur);
    this.env(g.gain, when, peak, 0.01, dur);
    o.connect(g).connect(this.master);
    o.start(when); o.stop(when + dur + 0.05);
  }

  private noise(when: number, dur: number, peak: number, freq: number, type: BiquadFilterType = 'lowpass') {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain();
    this.env(g.gain, when, peak, 0.005, dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(when, Math.random()); s.stop(when + dur + 0.05);
  }

  /** Cartoon hit: thud, spring "boing" and a short voice-like yelp. */
  hit(strength: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noise(t, 0.18, 0.5 * strength + 0.2, 300);
    this.tone(180, 'sine', t, 0.45, 0.35, 620);
    this.tone(260, 'triangle', t + 0.05, 0.4, 0.18, 900);
    // "¡ay!": a vowel-ish glide with a formant filter
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth';
    const p = 300 + Math.random() * 250;
    o.frequency.setValueAtTime(p * 1.4, t + 0.04);
    o.frequency.exponentialRampToValueAtTime(p * 0.8, t + 0.38);
    f.type = 'bandpass'; f.frequency.setValueAtTime(900, t); f.frequency.linearRampToValueAtTime(1600, t + 0.3); f.Q.value = 4;
    this.env(g.gain, t + 0.04, 0.28, 0.02, 0.36);
    o.connect(f).connect(g).connect(this.master);
    o.start(t + 0.04); o.stop(t + 0.5);
  }

  /** Body landing on the ground. */
  bounce(strength: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.08, 0.15 * strength, 500);
    this.tone(140, 'sine', t, 0.18, 0.12 * strength, 90);
  }

  /** Points jingle, pitch rises with the combo. */
  points(combo: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const base = 660 * Math.pow(2, Math.min(combo - 1, 8) / 12);
    this.tone(base, 'square', t + 0.12, 0.09, 0.06);
    this.tone(base * 1.5, 'square', t + 0.2, 0.14, 0.06);
  }

  /** Door and a happy two-note chime when someone boards. */
  board() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.06, 0.25, 900);
    this.tone(784, 'sine', t + 0.08, 0.18, 0.18);
    this.tone(1175, 'sine', t + 0.2, 0.3, 0.18);
  }

  /** Drop-off at the gym: cash register style fanfare. */
  dropoff() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 'triangle', t + i * 0.09, 0.25, 0.2));
    this.tone(2093, 'sine', t + 0.42, 0.5, 0.12);
  }

  /** Vehicle crash into something solid. */
  crash(strength: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise(t, 0.35, Math.min(0.8, 0.25 + strength * 0.5), 900);
    this.noise(t, 0.25, Math.min(0.5, strength * 0.4), 3500, 'highpass');
    this.tone(70, 'sine', t, 0.3, 0.4 * strength, 40);
  }

  /** La Cucaracha-style two-tone horn. */
  horn() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = [392, 392, 392, 523, 659];
    notes.forEach((f, i) => {
      this.tone(f, 'square', t + i * 0.13, 0.11, 0.08);
      this.tone(f * 1.26, 'square', t + i * 0.13, 0.11, 0.05);
    });
  }

  /** Race countdown beep; the last one is higher and longer. */
  beep(go: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(go ? 880 : 440, 'square', t, go ? 0.5 : 0.18, 0.12);
  }

  /** Ka-ching for a reward card. */
  reward() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [784, 988, 1175, 1568, 1976].forEach((f, i) => this.tone(f, 'sine', t + i * 0.07, 0.4, 0.15));
  }
}
