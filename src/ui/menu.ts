import { PLANES, PlaneStats } from '../vehicles/plane';

const maxSpeed = Math.max(...PLANES.map((p) => p.maxSpeed));
const maxRoll = Math.max(...PLANES.map((p) => p.rollRate));

/** Auswahlmenü für das Flugzeug. */
export class PlaneMenu {
  private root: HTMLDivElement;
  private selected: number;
  private onStart: (plane: PlaneStats) => void = () => {};
  visible = false;

  constructor(selectedId: string) {
    this.selected = Math.max(0, PLANES.findIndex((p) => p.id === selectedId));
    this.root = document.createElement('div');
    this.root.id = 'menu';
    this.root.hidden = true;
    this.root.innerHTML = `
      <h1>Flugsimulator Schleching</h1>
      <p class="coins">🪙 Gesammelte Punkte: <span id="menu-coins">0</span> · Bester Flug: <span id="menu-best">0</span></p>
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
      <button class="start">Los geht's! ✈</button>
      <p class="hint">Sammle Münzen: gold = 1 Punkt, blau = 5 Punkte.<br />Bald kannst du mit deinen Punkten im Hangar einkaufen.</p>`;
    document.body.appendChild(this.root);

    this.root.querySelectorAll<HTMLButtonElement>('.card').forEach((card) =>
      card.addEventListener('click', () => {
        this.selected = Number(card.dataset.index);
        this.render();
      }),
    );
    this.root.querySelector('.start')!.addEventListener('click', () => this.start());
    window.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      if (e.code === 'ArrowLeft') this.selected = (this.selected + PLANES.length - 1) % PLANES.length;
      else if (e.code === 'ArrowRight') this.selected = (this.selected + 1) % PLANES.length;
      else if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        this.start();
        return;
      } else return;
      this.render();
    });
    this.render();
  }

  show(coins: number, best: number, onStart: (plane: PlaneStats) => void) {
    this.onStart = onStart;
    this.root.querySelector('#menu-coins')!.textContent = String(coins);
    this.root.querySelector('#menu-best')!.textContent = String(best);
    this.root.hidden = false;
    this.visible = true;
    this.render();
  }

  private start() {
    this.root.hidden = true;
    // erst im nächsten Bild als geschlossen melden, damit die Leertaste nicht gleich "Neustart" auslöst
    requestAnimationFrame(() => (this.visible = false));
    this.onStart(PLANES[this.selected]);
  }

  private render() {
    this.root.querySelectorAll('.card').forEach((card, i) => card.classList.toggle('selected', i === this.selected));
  }
}
