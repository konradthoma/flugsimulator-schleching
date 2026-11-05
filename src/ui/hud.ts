const $ = (id: string) => document.getElementById(id)!;

const DIRECTIONS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];

export interface HudData {
  speed: number; // m/s
  altitude: number; // m ü. NN
  aboveGround: number; // m
  heading: number; // Grad
  throttle: number; // 0..1
  stalled: boolean;
  verticalSpeed: number; // m/s
  onGround: boolean;
}

const KEYS_PLANE = `
  <kbd>W</kbd>/<kbd>S</kbd> Gas geben/wegnehmen<br />
  <kbd>↑</kbd>/<kbd>↓</kbd> Nase runter/hoch<br />
  <kbd>←</kbd>/<kbd>→</kbd> nach links/rechts kippen<br />
  <kbd>A</kbd>/<kbd>D</kbd> Seitenruder (am Boden: lenken)<br />
  <kbd>I</kbd> Höhenruder umkehren: <span class="opt-invert">aus</span><br />`;

const KEYS_HELI = `
  <kbd>W</kbd>/<kbd>S</kbd> steigen/sinken<br />
  <kbd>↑</kbd>/<kbd>↓</kbd> vorwärts/rückwärts<br />
  <kbd>←</kbd>/<kbd>→</kbd> nach links/rechts drehen<br />
  <kbd>A</kbd>/<kbd>D</kbd> seitwärts fliegen<br />`;

/** Die Anzeige über dem Spielbild. */
export class Hud {
  private speed = $('hud-speed');
  private alt = $('hud-alt');
  private agl = $('hud-agl');
  private heading = $('hud-heading');
  private throttle = $('hud-throttle');
  private place = $('hud-place');
  private message = $('hud-message');
  private controls = $('controls');
  private vs = $('hud-vs');
  private throttleLabel = $('hud-throttle-label');

  show() {
    $('loading').remove();
    $('hud').hidden = false;
  }

  update(d: HudData) {
    this.speed.textContent = String(Math.round(d.speed * 3.6));
    this.alt.textContent = String(Math.round(d.altitude));
    this.agl.textContent = String(Math.max(0, Math.round(d.aboveGround)));
    this.agl.style.color = d.aboveGround < 100 ? '#ff6b5b' : '';
    this.heading.textContent = `${DIRECTIONS[Math.round(d.heading / 45) % 8]} ${Math.round(d.heading)}°`;
    this.throttle.style.width = `${Math.round(d.throttle * 100)}%`;
    this.speed.style.color = d.stalled ? '#ff6b5b' : '';
    const vs = Math.round(d.verticalSpeed * 10) / 10;
    this.vs.textContent = d.onGround ? 'am Boden' : `${vs > 0 ? '▲ ' : vs < 0 ? '▼ ' : ''}${Math.abs(vs).toFixed(1)} m/s`;
  }

  /** Zeitraffer-Anzeige (nur sichtbar, wenn schneller als normal) */
  setTimeScale(scale: number) {
    const el = $('hud-timescale');
    el.hidden = scale === 1;
    el.querySelector('b')!.textContent = `${String(scale).replace('.', ',')}×`;
  }

  /** Steuerungshilfe und Beschriftungen passend zum Fluggerät. */
  setVehicleKind(kind: 'plane' | 'heli') {
    this.throttleLabel.textContent = kind === 'heli' ? 'Rotor' : 'Gas';
    this.controls.innerHTML = `<b>Steuerung</b> <small>(K zum Ein-/Ausblenden)</small><br />
      ${kind === 'heli' ? KEYS_HELI : KEYS_PLANE}
      <kbd>C</kbd> Kamera wechseln<br />
      <kbd>H</kbd> Flughilfe: <span class="opt-assist">an</span><br />
      <kbd>P</kbd> Pause<br />
      <kbd>T</kbd> Zeitraffer (1× · 1,5× · 2× · 3×)<br />
      <kbd>Leertaste</kbd> Neustart<br />
      <kbd>M</kbd> Menü und Hangar`;
  }

  private score = $('score');
  private scoreSub = $('score-sub');
  private warning = $('hud-warning');
  private pointer = $('coin-pointer');
  private arrow = $('coin-arrow');
  private dist = $('coin-dist');
  private popupEl = $('hud-popup');
  private popupTimer = 0;

  /** Große Anzeige oben in der Mitte (Punkte oder Zeit) und eine kleine Zeile darunter. */
  setTopInfo(big: string, small: string) {
    if (this.score.textContent !== big) this.score.textContent = big;
    if (this.scoreSub.textContent !== small) this.scoreSub.textContent = small;
  }

  /** Warnung vor einem anderen Flugzeug (null = keine Warnung). */
  setWarning(text: string | null) {
    this.warning.textContent = text ?? '';
    this.warning.style.visibility = text ? 'visible' : 'hidden';
  }

  /** Pfeil zum nächsten Ziel. relDeg: 0 = geradeaus, 90 = rechts. */
  setCoinPointer(relDeg: number | null, distance = 0, heightDiff = 0) {
    if (relDeg === null) {
      this.pointer.style.visibility = 'hidden';
      return;
    }
    this.pointer.style.visibility = '';
    this.arrow.style.transform = `rotate(${relDeg - 90}deg)`;
    const updown = heightDiff > 40 ? ' ▲' : heightDiff < -40 ? ' ▼' : '';
    this.dist.textContent = distance > 1000 ? `${(distance / 1000).toFixed(1)} km${updown}` : `${Math.round(distance)} m${updown}`;
  }

  /** Kurz eingeblendeter Text, z. B. "+5". */
  popup(text: string) {
    this.popupEl.textContent = text;
    this.popupEl.classList.add('show');
    window.clearTimeout(this.popupTimer);
    this.popupTimer = window.setTimeout(() => this.popupEl.classList.remove('show'), text.length > 6 ? 1200 : 350);
  }

  setPlace(text: string) {
    this.place.textContent = text;
  }

  setMessage(text: string) {
    this.message.textContent = text;
  }

  toggleControls() {
    this.controls.classList.toggle('hidden');
  }

  setOptions(invert: boolean, assist: boolean) {
    const i = this.controls.querySelector('.opt-invert');
    const a = this.controls.querySelector('.opt-assist');
    if (i) i.textContent = invert ? 'an' : 'aus';
    if (a) a.textContent = assist ? 'an' : 'aus';
  }
}
