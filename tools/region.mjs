// Gemeinsame Gebietsdefinition für alle Daten-Werkzeuge.
// Koordinaten im Spiel: x = Meter nach Osten, z = Meter nach Süden, (0, 0) = Schleching.

export const CENTER = { lat: 47.7225, lon: 12.3936 }; // Schleching
/** Gebietsgrenzen in Metern relativ zu Schleching (Norden = negatives z) */
export const BOUNDS = { west: -10000, east: 13000, north: -26000, south: 10000 };
/** Rasterabstand in Metern */
export const SPACING = 10;
export const COLS = (BOUNDS.east - BOUNDS.west) / SPACING + 1;
export const ROWS = (BOUNDS.south - BOUNDS.north) / SPACING + 1;

const R = 6378137;
export const M_PER_DEG_LAT = (Math.PI / 180) * R;
export const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((CENTER.lat * Math.PI) / 180);

export function toWorld(lat, lon) {
  return [(lon - CENTER.lon) * M_PER_DEG_LON, (CENTER.lat - lat) * M_PER_DEG_LAT];
}

export function toGeo(x, z) {
  return { lat: CENTER.lat - z / M_PER_DEG_LAT, lon: CENTER.lon + x / M_PER_DEG_LON };
}

/** Geografischer Rahmen (mit etwas Rand) für Downloads */
export function geoBox(margin = 300) {
  const nw = toGeo(BOUNDS.west - margin, BOUNDS.north - margin);
  const se = toGeo(BOUNDS.east + margin, BOUNDS.south + margin);
  return { north: nw.lat, west: nw.lon, south: se.lat, east: se.lon };
}
