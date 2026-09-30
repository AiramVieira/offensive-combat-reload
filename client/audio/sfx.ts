// Procedural placeholder sounds (section 13) on Web Audio mixing buses. No asset files needed for the prototype;
// each function maps to a future sample bank entry (rifle_fire, dry_fire, rifle_reload, ...).
import type { SurfaceMaterial } from '../world/physics';

type Bus = 'sfx' | 'ui';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses!: Record<Bus, GainNode>;
  private noise!: AudioBuffer;
  private lowpass!: BiquadFilterNode;
  private volume = 0.7;

  /** Browsers only allow audio after a user gesture: call from the first click. */
  unlock() {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      // Muffled-hearing filter for low health (section 6).
      this.lowpass = ctx.createBiquadFilter();
      this.lowpass.type = 'lowpass';
      this.lowpass.frequency.value = 20000;
      this.master.connect(this.lowpass).connect(ctx.destination);
      this.buses = { sfx: ctx.createGain(), ui: ctx.createGain() };
      this.buses.sfx.connect(this.master);
      this.buses.ui.connect(this.master);
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.value = v;
  }

  setMuffled(amount: number) {
    if (!this.ctx) return;
    const f = 20000 * Math.pow(900 / 20000, amount);
    this.lowpass.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.1);
  }

  private get ready() {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private noiseBurst(t: number, dur: number, type: BiquadFilterType, freq: number, q: number, peak: number, bus: Bus = 'sfx', rate = 1) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, peak, 0.002, dur);
    src.connect(f).connect(g).connect(this.buses[bus]);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, bus: Bus = 'sfx', attack = 0.004) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, peak, attack, dur);
    o.connect(g).connect(this.buses[bus]);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  }

  /** Three layers: crack, body, room tail; +-5% pitch variation so it never sounds identical. */
  /** `volume` < 1 for other players' shots, attenuated by distance (2D for now). */
  gunshot(volume = 1) {
    if (!this.ready || volume < 0.02) return;
    const t = this.ctx!.currentTime;
    const p = 0.95 + Math.random() * 0.1;
    const v = volume;
    this.noiseBurst(t, 0.05, 'highpass', 2500 * p, 0.7, 0.55 * v * v, 'sfx', p);
    this.noiseBurst(t, 0.14, 'lowpass', 1400 * p, 0.9, 0.9 * v, 'sfx', p);
    this.tone(t, 'sine', 150 * p, 45, 0.12, 0.8 * v);
    this.noiseBurst(t + 0.02, 0.35, 'bandpass', 700 * p, 0.6, 0.12 * Math.sqrt(v), 'sfx', p);
  }

  dryFire() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(t, 0.03, 'highpass', 4000, 1, 0.35);
    this.tone(t, 'square', 1800, 900, 0.02, 0.05);
  }

  /** Reload timeline: mag out, mag in, and (empty reload) bolt release. */
  reload(duration: number, empty: boolean) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const click = (at: number, f: number, peak: number) => {
      this.noiseBurst(t + at, 0.05, 'bandpass', f, 3, peak);
      this.tone(t + at, 'triangle', f / 3, f / 6, 0.05, peak * 0.4);
    };
    click(duration * 0.2, 1800, 0.35);
    click(duration * 0.55, 1200, 0.5);
    if (empty) {
      click(duration * 0.8, 2600, 0.4);
      click(duration * 0.86, 1500, 0.45);
    }
  }

  hitmarker(headshot: boolean) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'triangle', headshot ? 2600 : 1700, headshot ? 2200 : 1500, 0.045, 0.35, 'ui', 0.001);
    if (headshot) this.tone(t + 0.02, 'sine', 3400, 3000, 0.12, 0.18, 'ui');
  }

  killDing() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'sine', 523, 520, 0.5, 0.35, 'ui', 0.002);
    this.tone(t, 'sine', 1046, 1040, 0.35, 0.15, 'ui', 0.002);
    this.tone(t + 0.08, 'sine', 784, 780, 0.5, 0.25, 'ui', 0.002);
  }

  /** Cartoon "boing" when a dummy falls over. */
  boing() {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.08);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.5);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 22;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 40;
    lfo.connect(lfoGain).connect(o.frequency);
    const g = ctx.createGain();
    this.env(g, t, 0.3, 0.01, 0.5);
    o.connect(g).connect(this.buses.sfx);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.6);
    lfo.stop(t + 0.6);
  }

  impact(material: SurfaceMaterial) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const freq: Record<SurfaceMaterial, number> = { grass: 500, concrete: 1800, wood: 900, metal: 3200, glass: 4500, tile: 2400 };
    this.noiseBurst(t, material === 'metal' ? 0.12 : 0.05, 'bandpass', freq[material], material === 'metal' ? 6 : 1.5, 0.12);
    if (material === 'metal') this.tone(t, 'triangle', 2400 + Math.random() * 800, 2000, 0.15, 0.05);
  }

  footstep(material: SurfaceMaterial, loud: number) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const freq: Record<SurfaceMaterial, number> = { grass: 350, concrete: 700, wood: 450, metal: 1400, glass: 1200, tile: 900 };
    this.noiseBurst(t, 0.07, 'lowpass', freq[material] * (0.9 + Math.random() * 0.2), 1, 0.12 * loud);
    this.tone(t, 'sine', 90, 50, 0.06, 0.12 * loud);
  }

  land(hard: boolean) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(t, 0.12, 'lowpass', 500, 1, hard ? 0.6 : 0.25);
    this.tone(t, 'sine', 110, 40, 0.15, hard ? 0.6 : 0.2);
  }

  hurt() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'sawtooth', 220, 110, 0.25, 0.15);
    this.noiseBurst(t, 0.15, 'lowpass', 600, 1, 0.3);
  }

  /** Sad trombone for the player's own death. */
  sadTrombone() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    [311, 294, 277, 262].forEach((f, i) => {
      const dur = i === 3 ? 0.9 : 0.3;
      this.tone(t + i * 0.35, 'sawtooth', f, i === 3 ? f * 0.94 : f, dur, 0.12, 'sfx', 0.03);
    });
  }

  squeak() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'square', 900, 1800, 0.08, 0.06);
    this.tone(t + 0.08, 'square', 1800, 1100, 0.1, 0.05);
  }

  /** Ice cream truck gag: a short music-box tune. */
  iceCream() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const notes = [659, 587, 523, 587, 659, 659, 659, 0, 587, 587, 587, 0, 659, 784, 784];
    notes.forEach((f, i) => {
      if (f) this.tone(t + i * 0.16, 'triangle', f, f, 0.18, 0.12, 'sfx', 0.005);
    });
  }

  knifeSwing() {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(600, t);
    f.frequency.exponentialRampToValueAtTime(3500, t + 0.14);
    const g = ctx.createGain();
    this.env(g, t, 0.35, 0.05, 0.12);
    src.connect(f).connect(g).connect(this.buses.sfx);
    src.start(t);
    src.stop(t + 0.25);
  }

  knifeHit() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(t, 0.08, 'lowpass', 900, 1, 0.7);
    this.tone(t, 'sine', 180, 60, 0.12, 0.6);
    this.tone(t + 0.01, 'square', 1200, 600, 0.05, 0.05);
  }

  /** "No pássaro!": two cartoon chirps and a slide whistle down. */
  bird() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 2; i++) {
      this.tone(t + i * 0.13, 'sine', 2600, 4200, 0.06, 0.25, 'ui', 0.002);
      this.tone(t + i * 0.13 + 0.05, 'sine', 4200, 3000, 0.05, 0.2, 'ui', 0.002);
    }
    this.tone(t + 0.3, 'sine', 1800, 300, 0.6, 0.2, 'ui', 0.01);
  }

  airHorn() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    for (const [f, at] of [[466, 0], [466, 0.18], [466, 0.36]] as const) {
      this.tone(t + at, 'sawtooth', f, f * 0.98, at === 0.36 ? 0.5 : 0.12, 0.12, 'sfx', 0.01);
      this.tone(t + at, 'sawtooth', f * 1.5, f * 1.47, at === 0.36 ? 0.5 : 0.12, 0.06, 'sfx', 0.01);
    }
  }

  applause(duration = 1.4) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 70; i++) {
      const at = Math.random() * duration;
      const fade = 1 - at / duration;
      this.noiseBurst(t + at, 0.03, 'bandpass', 1500 + Math.random() * 2500, 1.2, 0.08 * fade + 0.02);
    }
  }

  /** Short funky loop for the victory dance (150 bpm). Returns a function that stops it early. */
  danceMusic(duration: number): () => void {
    if (!this.ready) return () => {};
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    const bus = ctx.createGain();
    bus.connect(this.buses.sfx);
    const beat = 0.4;
    const bass = [98, 98, 147, 131, 98, 98, 175, 165];
    const lead = [392, 0, 440, 494, 0, 587, 494, 440, 392, 0, 330, 392, 0, 440, 0, 0];
    const osc = (at: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, at);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur);
      const g = ctx.createGain();
      this.env(g, at, peak, 0.004, dur);
      o.connect(g).connect(bus);
      o.start(at);
      o.stop(at + dur + 0.05);
    };
    for (let i = 0; i * beat < duration; i++) {
      const at = t0 + i * beat;
      osc(at, 'sine', 140, 45, 0.18, 0.7); // kick
      osc(at, 'square', bass[i % bass.length], bass[i % bass.length], 0.3, 0.07);
      const hat = ctx.createBufferSource();
      hat.buffer = this.noise;
      const hf = ctx.createBiquadFilter();
      hf.type = 'highpass';
      hf.frequency.value = 7000;
      const hg = ctx.createGain();
      this.env(hg, at + beat / 2, 0.12, 0.002, 0.04);
      hat.connect(hf).connect(hg).connect(bus);
      hat.start(at + beat / 2, Math.random() * 0.5);
      hat.stop(at + beat / 2 + 0.08);
    }
    for (let i = 0; i * (beat / 2) < duration; i++) {
      const f = lead[i % lead.length];
      if (f) osc(t0 + i * (beat / 2), 'triangle', f, f, 0.16, 0.1);
    }
    return () => {
      bus.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      setTimeout(() => bus.disconnect(), 300);
    };
  }

  /** Continuous water hiss (burst hydrant). Volume is set every frame by the caller (distance). */
  hiss(): { setVolume(v: number): void; stop(): void } {
    if (!this.ready) return { setVolume() {}, stop() {} };
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2200;
    f.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.buses.sfx);
    src.start();
    return {
      setVolume: (v) => g.gain.setTargetAtTime(0.1 * v, ctx.currentTime, 0.05),
      stop: () => {
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        src.stop(ctx.currentTime + 0.5);
      },
    };
  }

  splash() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(t, 0.35, 'lowpass', 1800, 0.8, 0.22);
    this.tone(t, 'sine', 300, 120, 0.2, 0.1);
  }

  /** Ambient: a distant bird, now and then. */
  ambientBird() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const base = 2600 + Math.random() * 1200;
    const n = 2 + ((Math.random() * 3) | 0);
    for (let i = 0; i < n; i++) this.tone(t + i * 0.11, 'sine', base, base * 1.25, 0.07, 0.035, 'sfx', 0.004);
  }

  /** Slide: gravelly scrape that fades as the slide slows down. */
  slide(material: SurfaceMaterial) {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.8;
    const base = material === 'grass' ? 700 : material === 'wood' ? 1100 : material === 'metal' ? 2600 : 1600;
    f.frequency.setValueAtTime(base, t);
    f.frequency.exponentialRampToValueAtTime(base * 0.4, t + 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
    src.connect(f).connect(g).connect(this.buses.sfx);
    src.start(t, Math.random() * 0.1);
    src.stop(t + 0.9);
    this.tone(t, 'sine', 120, 60, 0.12, 0.25);
  }

  /** Pin pull: metallic ping plus the spoon clack. */
  pinPull() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'triangle', 3200, 2800, 0.08, 0.12, 'sfx', 0.001);
    this.noiseBurst(t + 0.05, 0.04, 'bandpass', 2400, 4, 0.25);
  }

  grenadeThrow() {
    this.knifeSwing();
  }

  /** Grenade hitting the ground/walls; `strength` 0..1 from the impact speed. */
  grenadeBounce(strength: number) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'triangle', 1500 + Math.random() * 500, 900, 0.06, 0.12 * strength, 'sfx', 0.001);
    this.noiseBurst(t, 0.04, 'bandpass', 2000, 3, 0.18 * strength);
  }

  /** Cooking tick: one short beep per second of fuse, faster pitch as it runs out. */
  fuseBeep(urgency: number) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'square', 900 + urgency * 700, 900 + urgency * 700, 0.05, 0.05, 'ui', 0.002);
  }

  /** Explosion: sub thump, crack, rumble tail. `distance` in meters attenuates it (2D for now). */
  explosion(distance: number) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const v = Math.max(0.15, Math.min(1, 12 / (distance + 6)));
    this.tone(t, 'sine', 90, 30, 0.6, 1.0 * v);
    this.noiseBurst(t, 0.12, 'lowpass', 3000, 0.7, 0.9 * v);
    this.noiseBurst(t + 0.02, 1.2, 'lowpass', 500, 0.8, 0.6 * v);
    this.noiseBurst(t + 0.1, 0.8, 'bandpass', 250, 0.6, 0.3 * v);
  }

  /** Doghouse gag: two cartoon woofs. */
  bark() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    for (const at of [0, 0.22]) {
      this.tone(t + at, 'sawtooth', 420, 180, 0.12, 0.18, 'sfx', 0.005);
      this.noiseBurst(t + at, 0.1, 'bandpass', 900, 2, 0.25);
    }
  }

  /** Swing sound of each knife level (the plain knife uses knifeSwing). */
  meleeSwing(kind: 'faca' | 'madeira' | 'frango' | 'crocante' | 'tapa' | 'boing' | 'sabre') {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    switch (kind) {
      case 'faca':
        return this.knifeSwing();
      case 'madeira': // wooden spoon: hollow knock
        this.tone(t + 0.08, 'triangle', 520, 300, 0.07, 0.35);
        return this.noiseBurst(t, 0.1, 'bandpass', 700, 1.5, 0.15);
      case 'frango': // rubber chicken: the classic squeal
        this.tone(t, 'square', 700, 1500, 0.09, 0.12, 'sfx', 0.004);
        this.tone(t + 0.09, 'square', 1500, 900, 0.22, 0.1, 'sfx', 0.004);
        this.tone(t + 0.09, 'sawtooth', 1480, 880, 0.22, 0.05, 'sfx', 0.004);
        return;
      case 'crocante': // stale baguette: crunch
        this.noiseBurst(t + 0.08, 0.05, 'highpass', 2500, 1, 0.45);
        this.noiseBurst(t + 0.13, 0.04, 'highpass', 3200, 1, 0.3);
        return this.noiseBurst(t, 0.12, 'bandpass', 900, 1, 0.12);
      case 'tapa': // frozen fish: wet slap
        this.noiseBurst(t + 0.09, 0.07, 'lowpass', 1400, 1, 0.6);
        return this.tone(t + 0.09, 'sine', 220, 90, 0.1, 0.3);
      case 'boing':
        return this.boing();
      case 'sabre': // knock-off lightsaber: "vuuum"
        this.tone(t, 'sawtooth', 110, 160, 0.32, 0.14, 'sfx', 0.02);
        this.tone(t, 'sawtooth', 113, 150, 0.32, 0.1, 'sfx', 0.02);
        return this.noiseBurst(t, 0.3, 'bandpass', 400, 3, 0.08);
    }
  }

  /** New weapon level: short fanfare. */
  levelUp() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(t + i * 0.09, 'square', f, f, i === 3 ? 0.35 : 0.1, 0.1, 'ui', 0.004));
    this.tone(t + 0.27, 'triangle', 1568, 1568, 0.4, 0.08, 'ui', 0.004);
  }

  /** Planting a land mine: a metallic clack and a beep. */
  minePlant() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.noiseBurst(t, 0.05, 'bandpass', 2400, 2, 0.35);
    this.tone(t + 0.12, 'sine', 1800, 1800, 0.06, 0.12, 'sfx', 0.002);
  }

  /** Amora's bite: a short growl and a snap of the jaws. */
  bite() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'sawtooth', 120, 85, 0.35, 0.22, 'sfx', 0.01);
    this.tone(t + 0.02, 'square', 240, 170, 0.3, 0.06, 'sfx', 0.01);
    this.tone(t + 0.32, 'sawtooth', 520, 200, 0.1, 0.25, 'sfx', 0.003);
    this.noiseBurst(t + 0.34, 0.07, 'highpass', 1800, 1, 0.5);
    this.noiseBurst(t + 0.35, 0.12, 'lowpass', 700, 1, 0.6);
  }

  ui() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 'triangle', 880, 1320, 0.06, 0.12, 'ui');
  }
}
