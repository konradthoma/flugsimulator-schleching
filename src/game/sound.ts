/**
 * Einfache Geräusche, direkt im Browser erzeugt (keine Sounddateien nötig).
 * Browser erlauben Ton erst nach der ersten Berührung oder Taste.
 */
export class Sound {
  private ctx?: AudioContext;
  enabled = true;

  constructor() {
    const unlock = () => {
      if (!this.ctx) this.ctx = new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
  }

  private tone(freq: number, start: number, duration: number, type: OscillatorType = 'triangle', volume = 0.15) {
    const ctx = this.ctx;
    if (!this.enabled || !ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  coin() {
    this.tone(988, 0, 0.08);
    this.tone(1319, 0.07, 0.22);
  }

  bigCoin() {
    this.tone(784, 0, 0.1);
    this.tone(1047, 0.08, 0.1);
    this.tone(1568, 0.16, 0.35);
  }

  allCollected() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, i * 0.1, 0.3));
  }

  success() {
    [659, 784, 988].forEach((f, i) => this.tone(f, i * 0.09, 0.25));
  }

  fail() {
    this.tone(392, 0, 0.25, 'square', 0.08);
    this.tone(330, 0.2, 0.4, 'square', 0.08);
  }

  buy() {
    [880, 1175, 1568].forEach((f, i) => this.tone(f, i * 0.06, 0.18));
  }

  // ---------- Motorgeräusch ----------
  private engineNodes?: { osc: OscillatorNode; filter: BiquadFilterNode; gain: GainNode; lfo: OscillatorNode; lfoGain: GainNode };
  engineEnabled = true;

  /**
   * Dauerton des Motors. kind 'heli' klingt nach "wop-wop" (lauter/leiser im Rotortakt).
   * active = false schaltet ihn leise.
   */
  engine(kind: 'prop' | 'jet' | 'heli', throttle: number, speed: number, active: boolean) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (!this.engineNodes) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0;
      lfo.connect(lfoGain).connect(gain.gain);
      osc.connect(filter).connect(gain).connect(ctx.destination);
      osc.start();
      lfo.start();
      this.engineNodes = { osc, filter, gain, lfo, lfoGain };
    }
    const n = this.engineNodes;
    const t = ctx.currentTime;
    const on = active && this.enabled && this.engineEnabled;
    let freq: number, cutoff: number, volume: number, wobble = 0, wobbleRate = 1;
    if (kind === 'heli') {
      freq = 48 + throttle * 30;
      cutoff = 420 + throttle * 300;
      volume = 0.035;
      wobble = 0.03;
      wobbleRate = 6 + throttle * 4;
    } else if (kind === 'jet') {
      freq = 90 + throttle * 160 + speed * 0.3;
      cutoff = 900 + throttle * 1800;
      volume = 0.02 + throttle * 0.02;
    } else {
      freq = 55 + throttle * 70 + speed * 0.3;
      cutoff = 380 + throttle * 600;
      volume = 0.025 + throttle * 0.02;
    }
    n.osc.frequency.setTargetAtTime(freq, t, 0.1);
    n.filter.frequency.setTargetAtTime(cutoff, t, 0.1);
    n.lfo.frequency.setTargetAtTime(wobbleRate, t, 0.1);
    n.lfoGain.gain.setTargetAtTime(on ? wobble : 0, t, 0.1);
    n.gain.gain.setTargetAtTime(on ? volume : 0, t, 0.15);
  }

  crash() {
    this.tone(110, 0, 0.5, 'sawtooth', 0.2);
    this.tone(70, 0.05, 0.7, 'square', 0.12);
  }
}
