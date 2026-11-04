/** Speichert den Spielstand im Browser (bleibt auch nach dem Schließen erhalten). */

export type GameMode = 'coins' | 'race';

export interface Settings {
  /** Andere Flugzeuge, denen man ausweichen muss */
  traffic: boolean;
  /** Lichtsäulen über den Münzgruppen */
  beacons: boolean;
  /** Pfeil zur nächsten Münze bzw. zum nächsten Ring */
  pointer: boolean;
  /** Töne */
  sound: boolean;
}

export interface SaveData {
  /** Alle jemals gesammelten Punkte (damit kann man später im Shop einkaufen) */
  coins: number;
  /** Zuletzt gewähltes Flugzeug */
  plane: string;
  /** Zuletzt gewählter Spielmodus */
  mode: GameMode;
  /** Beste Punktzahl in einem einzigen Münzflug */
  bestFlight: number;
  /** Bestzeit im Ringrennen je Flugzeug (Sekunden) */
  bestTimes: Record<string, number>;
  settings: Settings;
}

const KEY = 'flugsim-schleching-save';
const DEFAULT_SETTINGS: Settings = { traffic: true, beacons: true, pointer: true, sound: true };
const DEFAULTS: SaveData = { coins: 0, plane: 'piccolo', mode: 'coins', bestFlight: 0, bestTimes: {}, settings: DEFAULT_SETTINGS };

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return { ...DEFAULTS, ...data, settings: { ...DEFAULT_SETTINGS, ...data.settings }, bestTimes: { ...data.bestTimes } };
    }
  } catch {
    // privater Modus o. ä.: dann eben ohne Speichern
  }
  return { ...DEFAULTS, settings: { ...DEFAULT_SETTINGS }, bestTimes: {} };
}

export function writeSave(data: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // ignorieren
  }
}

/** Zeit als "1:05.3" */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
