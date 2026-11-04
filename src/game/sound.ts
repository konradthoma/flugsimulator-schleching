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

  crash() {
    this.tone(110, 0, 0.5, 'sawtooth', 0.2);
    this.tone(70, 0.05, 0.7, 'square', 0.12);
  }
}
