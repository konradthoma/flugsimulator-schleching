const $ = (id: string) => document.getElementById(id)!;

const DIRECTIONS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];

export interface HudData {
  speed: number; // m/s
  altitude: number; // m ü. NN
  aboveGround: number; // m
  heading: number; // Grad
  throttle: number; // 0..1
  stalled: boolean;
}

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
  private invert = $('hud-invert');
  private assist = $('hud-assist');

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
  }

  private score = $('hud-score');
  private total = $('hud-total');
  private left = $('hud-left');
  private pointer = $('coin-pointer');
  private arrow = $('coin-arrow');
  private dist = $('coin-dist');
  private popupEl = $('hud-popup');
  private popupTimer = 0;

  setScore(flight: number, total: number, left: number) {
    this.score.textContent = String(flight);
    this.total.textContent = String(total);
    this.left.textContent = String(left);
  }

  /** Pfeil zur nächsten Münze. relDeg: 0 = geradeaus, 90 = rechts. */
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
    this.popupTimer = window.setTimeout(() => this.popupEl.classList.remove('show'), 350);
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
    this.invert.textContent = invert ? 'an' : 'aus';
    this.assist.textContent = assist ? 'an' : 'aus';
  }
}
