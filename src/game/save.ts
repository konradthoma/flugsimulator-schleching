/** Speichert den Spielstand im Browser (bleibt auch nach dem Schließen erhalten). */
export interface SaveData {
  /** Alle jemals gesammelten Punkte (damit kann man später im Shop einkaufen) */
  coins: number;
  /** Zuletzt gewähltes Flugzeug */
  plane: string;
  /** Beste Punktzahl in einem einzigen Flug */
  bestFlight: number;
}

const KEY = 'flugsim-schleching-save';
const DEFAULTS: SaveData = { coins: 0, plane: 'piccolo', bestFlight: 0 };

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // privater Modus o. ä.: dann eben ohne Speichern
  }
  return { ...DEFAULTS };
}

export function writeSave(data: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // ignorieren
  }
}
