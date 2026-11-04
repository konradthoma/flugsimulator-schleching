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
