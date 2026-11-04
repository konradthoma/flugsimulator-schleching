import { PLANES, PlaneStats } from '../vehicles/plane';
import { formatTime, GameMode, SaveData, Settings } from '../game/save';

const maxSpeed = Math.max(...PLANES.map((p) => p.maxSpeed));
const maxRoll = Math.max(...PLANES.map((p) => p.rollRate));

const SETTING_LABELS: [keyof Settings, string][] = [
  ['traffic', '✈ Andere Flugzeuge (ausweichen!)'],
  ['beacons', '🔦 Lichtsäulen über den Münzen'],
  ['pointer', '➤ Wegweiser-Pfeil'],
  ['sound', '🔊 Töne'],
];

/** Hauptmenü: Spielmodus, Flugzeug und Einstellungen wählen. */
export class PlaneMenu {
  private root: HTMLDivElement;
  private selected: number;
  private mode: GameMode;
  private onStart: (plane: PlaneStats, mode: GameMode) => void = () => {};
  visible = false;

  constructor(
    private save: SaveData,
    private onSettingsChange: () => void,
  ) {
    this.selected = Math.max(0, PLANES.findIndex((p) => p.id === save.plane));
    this.mode = save.mode;
    this.root = document.createElement('div');
    this.root.id = 'menu';
    this.root.hidden = true;
    this.root.innerHTML = `
      <h1>Flugsimulator Schleching</h1>
      <p class="coins">🪙 Gesammelte Punkte: <span id="menu-coins">0</span></p>
      <h2>Was willst du spielen?</h2>
      <div class="modes">
        <button class="mode" data-mode="coins"><b>🪙 Münzen sammeln</b><small>Bester Flug: <span id="menu-best">0</span> Punkte</small></button>
        <button class="mode" data-mode="race"><b>⏱ Ringrennen</b><small>Bestzeit: <span id="menu-time">–</span></small></button>
      </div>
      <h2>Wähle dein Flugzeug</h2>
      <div class="cards">
        ${PLANES.map(
          (p, i) => `
          <button class="card" data-index="${i}">
            <b>${p.name}</b>
            <small>${p.description}</small>
            <span class="stat">Tempo<i style="width:${Math.round((p.maxSpeed / maxSpeed) * 100)}%"></i></span>
            <span class="stat">Wendigkeit<i style="width:${Math.round((p.rollRate / maxRoll) * 100)}%"></i></span>
            <span class="speed">bis ${Math.round(p.maxSpeed * 3.6)} km/h</span>
          </button>`,
        ).join('')}
      </div>
      <h2>Einstellungen</h2>
      <div class="settings">
        ${SETTING_LABELS.map(([key, label]) => `<label><input type="checkbox" data-setting="${key}" /> ${label}</label>`).join('')}
      </div>
      <button class="start">Los geht's! ✈</button>
      <p class="hint" id="menu-hint"></p>`;
    document.body.appendChild(this.root);

    this.root.querySelectorAll<HTMLButtonElement>('.card').forEach((card) =>
      card.addEventListener('click', () => {
        this.selected = Number(card.dataset.index);
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLButtonElement>('.mode').forEach((btn) =>
      btn.addEventListener('click', () => {
        this.mode = btn.dataset.mode as GameMode;
        this.render();
      }),
    );
    this.root.querySelectorAll<HTMLInputElement>('[data-setting]').forEach((box) =>
      box.addEventListener('change', () => {
        this.save.settings[box.dataset.setting as keyof Settings] = box.checked;
        this.onSettingsChange();
      }),
    );
    this.root.querySelector('.start')!.addEventListener('click', () => this.start());
    window.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      if (e.code === 'ArrowLeft') this.selected = (this.selected + PLANES.length - 1) % PLANES.length;
      else if (e.code === 'ArrowRight') this.selected = (this.selected + 1) % PLANES.length;
      else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') this.mode = this.mode === 'coins' ? 'race' : 'coins';
      else if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        this.start();
        return;
      } else return;
      e.preventDefault();
      this.render();
    });
  }

  show(onStart: (plane: PlaneStats, mode: GameMode) => void) {
    this.onStart = onStart;
    this.root.querySelector('#menu-coins')!.textContent = String(this.save.coins);
    this.root.querySelector('#menu-best')!.textContent = String(this.save.bestFlight);
    this.root.querySelectorAll<HTMLInputElement>('[data-setting]').forEach((box) => {
      box.checked = this.save.settings[box.dataset.setting as keyof Settings];
    });
    this.root.hidden = false;
    this.visible = true;
    this.render();
  }

  private start() {
    this.root.hidden = true;
    // erst im nächsten Bild als geschlossen melden, damit die Leertaste nicht gleich "Neustart" auslöst
    requestAnimationFrame(() => (this.visible = false));
    this.onStart(PLANES[this.selected], this.mode);
  }

  private render() {
    this.root.querySelectorAll('.card').forEach((card, i) => card.classList.toggle('selected', i === this.selected));
    this.root.querySelectorAll<HTMLElement>('.mode').forEach((b) => b.classList.toggle('selected', b.dataset.mode === this.mode));
    const best = this.save.bestTimes[PLANES[this.selected].id];
    this.root.querySelector('#menu-time')!.textContent = best ? `${formatTime(best)} (${PLANES[this.selected].name})` : '–';
    this.root.querySelector('#menu-hint')!.innerHTML =
      this.mode === 'coins'
        ? 'Sammle Münzen: gold = 1 Punkt, blau = 5 Punkte.<br />Alle Münzen geschafft = 50 Bonuspunkte.'
        : 'Flieg durch alle Ringe in der richtigen Reihenfolge.<br />Die Zeit startet am grünen Ring und stoppt am weißen Zielring.';
  }
}
