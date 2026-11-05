/** Speichert den Spielstand im Browser (bleibt auch nach dem Schließen erhalten). */

export type GameMode = 'coins' | 'race' | 'missions' | 'free';

export interface Settings {
  /** Andere Flugzeuge, denen man ausweichen muss */
  traffic: boolean;
  /** Lichtsäulen über den Münzgruppen */
  beacons: boolean;
  /** Pfeil zur nächsten Münze bzw. zum nächsten Ziel */
  pointer: boolean;
  /** Töne */
  sound: boolean;
  /** Motorgeräusch */
  engine: boolean;
  /** Abendstimmung statt Mittag */
  evening: boolean;
  /** Böiger Wind */
  wind: boolean;
}

export interface ScoreEntry {
  value: number; // Punkte bzw. Sekunden
  vehicle: string; // Name des Fluggeräts
  date: string; // TT.MM.JJJJ
}

export interface SaveData {
  /** Punkte, mit denen man im Hangar einkaufen kann */
  coins: number;
  /** Zuletzt gewähltes Fluggerät */
  plane: string;
  /** Zuletzt gewählter Spielmodus */
  mode: GameMode;
  /** Zuletzt gewählte Mission */
  mission: string;
  /** Beste Punktzahl in einem einzigen Münzflug */
  bestFlight: number;
  /** Bestzeit im Ringrennen je Fluggerät (Sekunden) */
  bestTimes: Record<string, number>;
  /** Gekaufte Fluggeräte */
  owned: string[];
  /** Gekaufte Extras: true = eingeschaltet */
  upgrades: Record<string, boolean>;
  /** Bestzeit je geschaffter Mission (Sekunden) */
  missions: Record<string, number>;
  /** Bestenlisten (die besten 5) */
  highscores: { coins: ScoreEntry[]; race: ScoreEntry[] };
  settings: Settings;
}

const KEY = 'flugsim-schleching-save';
const DEFAULT_SETTINGS: Settings = { traffic: true, beacons: true, pointer: true, sound: true, engine: true, evening: false, wind: false };

function defaults(): SaveData {
  return {
    coins: 0,
    plane: 'piccolo',
    mode: 'coins',
    mission: 'landung',
    bestFlight: 0,
    bestTimes: {},
    owned: ['piccolo'],
    upgrades: {},
    missions: {},
    highscores: { coins: [], race: [] },
    settings: { ...DEFAULT_SETTINGS },
  };
}

export function loadSave(): SaveData {
  const base = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      const save: SaveData = {
        ...base,
        ...data,
        settings: { ...DEFAULT_SETTINGS, ...data.settings },
        bestTimes: { ...data.bestTimes },
        upgrades: { ...data.upgrades },
        missions: { ...data.missions },
        highscores: { coins: data.highscores?.coins ?? [], race: data.highscores?.race ?? [] },
      };
      // Spielstand von vor dem Hangar: das zuletzt geflogene Flugzeug darf man behalten
      if (!Array.isArray(data.owned)) save.owned = [...new Set(['piccolo', save.plane])];
      if (!save.owned.includes(save.plane)) save.plane = 'piccolo';
      return save;
    }
  } catch {
    // privater Modus o. ä.: dann eben ohne Speichern
  }
  return base;
}

export function writeSave(data: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // ignorieren
  }
}

export function resetSave(): SaveData {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignorieren
  }
  return defaults();
}

/**
 * Trägt ein Ergebnis in eine Bestenliste ein.
 * Gibt den Platz zurück (1 = bester) oder 0, wenn es nicht für die Liste reicht.
 */
export function addHighscore(list: ScoreEntry[], value: number, vehicle: string, lowerIsBetter: boolean): number {
  const d = new Date();
  const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  const entry = { value, vehicle, date };
  list.push(entry);
  list.sort((a, b) => (lowerIsBetter ? a.value - b.value : b.value - a.value));
  list.splice(5);
  return list.indexOf(entry) + 1;
}

/** Zeit als "1:05.3" */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
