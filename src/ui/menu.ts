import { getVehicle, UPGRADES, VEHICLES, VehicleStats } from '../vehicles';
import { formatTime, GameMode, resetSave, SaveData, ScoreEntry, Settings, writeSave } from '../game/save';
import type { Mission } from '../game/missions';

const maxSpeed = Math.max(...VEHICLES.map((v) => v.maxSpeed));

const SETTING_LABELS: [keyof Settings, string][] = [
  ['traffic', '✈ Andere Flugzeuge (ausweichen!)'],
  ['beacons', '🔦 Lichtsäulen über den Münzen'],
  ['pointer', '➤ Wegweiser-Pfeil'],
  ['sound', '🔔 Töne'],
  ['engine', '🔊 Motorgeräusch'],
  ['evening', '🌇 Abendstimmung'],
  ['wind', '🌬 Böiger Wind (schwerer)'],
];

const MODES: { id: GameMode; title: string }[] = [
  { id: 'coins', title: '🪙 Münzen sammeln' },
  { id: 'race', title: '⏱ Ringrennen' },
  { id: 'missions', title: '🎯 Missionen' },
  { id: 'free', title: '🕊 Freiflug' },
];

type Tab = 'play' | 'hangar' | 'records' | 'settings';

export type StartHandler = (vehicle: VehicleStats, mode: GameMode, mission: Mission | null) => void;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Hauptmenü mit Spielmodus, Hangar (Shop), Bestenliste und Einstellungen. */
export class PlaneMenu {
  private root: HTMLDivElement;
  private body: HTMLDivElement;
  private startBtn: HTMLButtonElement;
  private tab: Tab = 'play';
  private onStart: StartHandler = () => {};
  private confirmReset = false;
  private flash = '';
  visible = false;

  constructor(
    private save: SaveData,
    private missions: Mission[],
    private onSettingsChange: () => void,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'menu';
    this.root.hidden = true;
    this.root.innerHTML = `
      <h1>Flugsimulator Schleching</h1>
      <p class="coins">🪙 <b id="menu-coins">0</b> Punkte</p>
      <nav class="tabs">
        <button data-tab="play">Spielen</button>
        <button data-tab="hangar">Hangar</button>
        <button data-tab="records">Rekorde</button>
        <button data-tab="settings">Einstellungen</button>
      </nav>
      <div class="menu-body"></div>
      <button class="start">Los geht's! ✈</button>`;
    document.body.appendChild(this.root);
    this.body = this.root.querySelector('.menu-body')!;
    this.startBtn = this.root.querySelector('.start')!;

    this.root.addEventListener('click', (e) => this.handleClick(e));
    this.root.addEventListener('change', (e) => {
      const box = e.target as HTMLInputElement;
      if (box.dataset.setting) {
        this.save.settings[box.dataset.setting as keyof Settings] = box.checked;
        this.onSettingsChange();
      } else if (box.dataset.upgrade) {
        this.save.upgrades[box.dataset.upgrade] = box.checked;
        writeSave(this.save);
      }
    });
    window.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      const owned = this.ownedVehicles();
      const i = owned.findIndex((v) => v.id === this.save.plane);
      if (e.code === 'ArrowLeft') this.save.plane = owned[(i + owned.length - 1) % owned.length].id;
      else if (e.code === 'ArrowRight') this.save.plane = owned[(i + 1) % owned.length].id;
      else if (e.code === 'Enter') {
        e.preventDefault();
        this.start();
        return;
      } else return;
      e.preventDefault();
      this.render();
    });
  }

  show(onStart: StartHandler) {
    this.onStart = onStart;
    this.root.hidden = false;
    this.visible = true;
    this.flash = '';
    this.render();
  }

  private ownedVehicles() {
    return VEHICLES.filter((v) => this.save.owned.includes(v.id));
  }

  private get mission(): Mission {
    return this.missions.find((m) => m.id === this.save.mission) ?? this.missions[0];
  }

  /** Warum man (noch) nicht starten kann – oder null */
  private blocker(): string | null {
    const v = getVehicle(this.save.plane);
    if (!this.save.owned.includes(v.id)) return 'Erst im Hangar kaufen';
    if (this.save.mode === 'missions' && this.mission.heliOnly && v.kind !== 'heli') return 'Dafür brauchst du einen Hubschrauber 🚁';
    return null;
  }

  private handleClick(e: Event) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tab],[data-mode],[data-mission],[data-vehicle],[data-buy],[data-buy-upgrade],[data-action]');
    if (!el || !this.root.contains(el)) return;
    const d = el.dataset;
    if (d.tab) this.tab = d.tab as Tab;
    else if (d.mode) this.save.mode = d.mode as GameMode;
    else if (d.mission) this.save.mission = d.mission;
    else if (d.vehicle) this.save.plane = d.vehicle;
    else if (d.buy) this.buyVehicle(d.buy);
    else if (d.buyUpgrade) this.buyUpgrade(d.buyUpgrade);
    else if (d.action === 'start') return this.start();
    else if (d.action === 'reset') {
      if (!this.confirmReset) this.confirmReset = true;
      else {
        Object.assign(this.save, resetSave());
        this.confirmReset = false;
        this.onSettingsChange();
        this.flash = 'Spielstand gelöscht.';
      }
    }
    if (d.action !== 'reset') this.confirmReset = false;
    writeSave(this.save);
    this.render();
  }

  private buyVehicle(id: string) {
    const v = getVehicle(id);
    if (this.save.owned.includes(id) || this.save.coins < v.price) return;
    this.save.coins -= v.price;
    this.save.owned.push(id);
    this.save.plane = id;
    this.flash = `🎉 ${v.name} gehört jetzt dir!`;
  }

  private buyUpgrade(id: string) {
    const u = UPGRADES.find((x) => x.id === id);
    if (!u || id in this.save.upgrades || this.save.coins < u.price) return;
    this.save.coins -= u.price;
    this.save.upgrades[id] = true;
    this.flash = `🎉 ${u.name} gekauft!`;
  }

  private start() {
    if (this.blocker()) return;
    this.root.hidden = true;
    // erst im nächsten Bild als geschlossen melden, damit die Leertaste nicht gleich "Neustart" auslöst
    requestAnimationFrame(() => (this.visible = false));
    this.onStart(getVehicle(this.save.plane), this.save.mode, this.save.mode === 'missions' ? this.mission : null);
  }

  private render() {
    const s = this.save;
    if (!s.owned.includes(s.plane)) s.plane = 'piccolo';
    this.root.querySelector('#menu-coins')!.textContent = String(s.coins);
    this.root.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('selected', b.dataset.tab === this.tab));
    const scroll = this.root.scrollTop;
    this.body.innerHTML =
      (this.flash ? `<p class="flash">${esc(this.flash)}</p>` : '') +
      { play: () => this.renderPlay(), hangar: () => this.renderHangar(), records: () => this.renderRecords(), settings: () => this.renderSettings() }[this.tab]();
    this.root.scrollTop = scroll;
    const blocker = this.blocker();
    this.startBtn.dataset.action = 'start';
    this.startBtn.disabled = !!blocker;
    this.startBtn.textContent = blocker ?? `Los geht's mit ${getVehicle(s.plane).name}! ${getVehicle(s.plane).kind === 'heli' ? '🚁' : '✈'}`;
  }

  private renderPlay(): string {
    const s = this.save;
    const v = getVehicle(s.plane);
    const best = s.bestTimes[v.id];
    const missionsDone = this.missions.filter((m) => m.id in s.missions).length;
    const sub: Record<GameMode, string> = {
      coins: `Bester Flug: ${s.bestFlight} Punkte`,
      race: best ? `Bestzeit: ${formatTime(best)}` : 'Noch keine Zeit',
      missions: `${missionsDone} von ${this.missions.length} geschafft`,
      free: 'Starte vom Flugplatz',
    };
    let html = `<h2>Was willst du spielen?</h2><div class="modes">${MODES.map(
      (m) => `<button class="mode${m.id === s.mode ? ' selected' : ''}" data-mode="${m.id}"><b>${m.title}</b><small>${sub[m.id]}</small></button>`,
    ).join('')}</div>`;

    if (s.mode === 'missions') {
      html += `<h2>Wähle eine Mission</h2><div class="missions">${this.missions
        .map((m) => {
          const done = s.missions[m.id];
          const reward = done !== undefined ? `+${Math.max(5, Math.round(m.reward / 4))} 🪙 (nochmal)` : `+${m.reward} 🪙`;
          return `<button class="mission${m.id === s.mission ? ' selected' : ''}" data-mission="${m.id}">
            <b>${m.name}${done !== undefined ? ' ✅' : ''}</b>
            <small>${esc(m.description)}</small>
            <span class="tags">${m.heliOnly ? '<i>🚁 nur Hubschrauber</i>' : ''}<i>${reward}</i>${done !== undefined ? `<i>Bestzeit ${formatTime(done)}</i>` : ''}</span>
          </button>`;
        })
        .join('')}</div>`;
    }

    html += `<h2>Dein Fluggerät</h2><div class="cards">${this.ownedVehicles()
      .map((x) => this.vehicleCard(x, x.id === v.id, false))
      .join('')}</div>`;
    const locked = VEHICLES.length - s.owned.length;
    if (locked > 0) html += `<p class="hint"><button class="link" data-tab="hangar">🔒 ${locked} weitere im Hangar – mit Punkten freischalten</button></p>`;

    const hints: Record<GameMode, string> = {
      coins: 'Sammle Münzen: gold = 1 Punkt, blau = 5 Punkte. Alle Münzen geschafft = 50 Bonuspunkte.',
      race: 'Flieg durch alle Ringe in der richtigen Reihenfolge. Die Zeit startet am grünen Ring und stoppt am weißen Zielring.',
      missions: 'Für jede Mission gibt es Punkte – beim ersten Mal die volle Belohnung.',
      free: 'Kein Ziel, keine Zeit: einfach fliegen. Du startest auf dem Flugplatz bei Schleching.',
    };
    html += `<p class="hint">${hints[s.mode]}</p>`;
    return html;
  }

  private vehicleCard(v: VehicleStats, selected: boolean, shop: boolean): string {
    const owned = this.save.owned.includes(v.id);
    let action = '';
    if (shop) {
      if (owned) action = `<span class="owned">✅ Gehört dir</span>`;
      else if (this.save.coins >= v.price) action = `<span class="buy" data-buy="${v.id}">Kaufen für ${v.price} 🪙</span>`;
      else action = `<span class="price">🔒 ${v.price} 🪙 <small>(dir fehlen ${v.price - this.save.coins})</small></span>`;
    }
    const attr = shop ? (owned ? `data-vehicle="${v.id}"` : '') : `data-vehicle="${v.id}"`;
    return `<div role="button" tabindex="0" class="card${selected ? ' selected' : ''}${!owned ? ' locked' : ''}" ${attr}>
      <b>${v.kind === 'heli' ? '🚁' : '✈'} ${v.name}</b>
      <small>${esc(v.description)}</small>
      <span class="stat">Tempo<i style="width:${Math.round((v.maxSpeed / maxSpeed) * 100)}%"></i></span>
      <span class="stat">Wendigkeit<i style="width:${Math.round(v.agility * 100)}%"></i></span>
      <span class="speed">bis ${Math.round(v.maxSpeed * 3.6)} km/h</span>
      ${action}
    </div>`;
  }

  private renderHangar(): string {
    const s = this.save;
    return `<h2>Fluggeräte</h2>
      <div class="cards">${VEHICLES.map((v) => this.vehicleCard(v, v.id === s.plane, true)).join('')}</div>
      <h2>Extras</h2>
      <div class="cards">${UPGRADES.map((u) => {
        const owned = u.id in s.upgrades;
        const action = owned
          ? `<label class="toggle"><input type="checkbox" data-upgrade="${u.id}" ${s.upgrades[u.id] ? 'checked' : ''}/> eingeschaltet</label>`
          : s.coins >= u.price
            ? `<span class="buy" data-buy-upgrade="${u.id}">Kaufen für ${u.price} 🪙</span>`
            : `<span class="price">🔒 ${u.price} 🪙 <small>(dir fehlen ${u.price - s.coins})</small></span>`;
        return `<div class="card upgrade${owned ? '' : ' locked'}"><b>${u.name}</b><small>${esc(u.description)}</small>${action}</div>`;
      }).join('')}</div>
      <p class="hint">Punkte bekommst du für Münzen, Ringrennen und Missionen.</p>`;
  }

  private renderRecords(): string {
    const s = this.save;
    const table = (title: string, list: ScoreEntry[], fmt: (v: number) => string) =>
      `<h2>${title}</h2>${
        list.length
          ? `<table class="scores">${list.map((e, i) => `<tr><td>${['🥇', '🥈', '🥉', '4.', '5.'][i]}</td><td>${fmt(e.value)}</td><td>${esc(e.vehicle)}</td><td>${e.date}</td></tr>`).join('')}</table>`
          : '<p class="hint">Noch keine Einträge – flieg los!</p>'
      }`;
    const missionRows = this.missions
      .map((m) => `<tr><td>${m.name}</td><td>${m.id in s.missions ? formatTime(s.missions[m.id]) : '–'}</td></tr>`)
      .join('');
    return (
      table('🪙 Meiste Münzen in einem Flug', s.highscores.coins, (v) => `${v} Punkte`) +
      table('⏱ Schnellste Ringrennen', s.highscores.race, formatTime) +
      `<h2>🎯 Missionen</h2><table class="scores">${missionRows}</table>`
    );
  }

  private renderSettings(): string {
    const s = this.save;
    return `<h2>Einstellungen</h2>
      <div class="settings">${SETTING_LABELS.map(
        ([key, label]) => `<label><input type="checkbox" data-setting="${key}" ${s.settings[key] ? 'checked' : ''}/> ${label}</label>`,
      ).join('')}</div>
      <h2>Spielstand</h2>
      <p><button class="danger" data-action="reset">${this.confirmReset ? 'Wirklich alles löschen? Nochmal tippen' : 'Spielstand zurücksetzen'}</button></p>
      <h2>Kartendaten</h2>
      <p class="hint">Gelände, Gewässer, Wald, Straßen und Gebäude: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap-Mitwirkende</a> (ODbL). Höhen: AWS Terrain Tiles (Copernicus, SRTM, data.gv.at u. a.).</p>`;
  }
}
