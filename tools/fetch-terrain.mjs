// Lädt echte Höhendaten rund um Schleching herunter und speichert sie als
// Höhengitter für das Spiel (public/terrain/).
//
// Quelle: AWS Terrain Tiles (Terrarium-Format), frei nutzbar.
// Aufruf: npm run terrain

import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';

const CENTER = { lat: 47.7225, lon: 12.3936 }; // Schleching
const SIZE_M = 20000; // Kantenlänge des Gebiets in Metern
const GRID = 2048; // Anzahl Höhenpunkte pro Kante (ca. 10 m Abstand)
const ZOOM = 14; // ca. 6,5 m pro Pixel in dieser Breite

const OUT_DIR = path.resolve('public/terrain');
const CACHE_DIR = path.resolve('tools/.tile-cache');

const R = 6378137; // Erdradius (WGS84)
const mPerDegLat = (Math.PI / 180) * R;
const mPerDegLon = mPerDegLat * Math.cos((CENTER.lat * Math.PI) / 180);

// Geo-Koordinate -> globale Pixel-Koordinate (Web-Mercator) bei ZOOM
function lonLatToPixel(lon, lat) {
  const n = 2 ** ZOOM * 256;
  const x = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

const half = SIZE_M / 2;
const north = CENTER.lat + half / mPerDegLat;
const south = CENTER.lat - half / mPerDegLat;
const west = CENTER.lon - half / mPerDegLon;
const east = CENTER.lon + half / mPerDegLon;

const pNW = lonLatToPixel(west, north);
const pSE = lonLatToPixel(east, south);
const tx0 = Math.floor(pNW.x / 256) - 1;
const ty0 = Math.floor(pNW.y / 256) - 1;
const tx1 = Math.floor(pSE.x / 256) + 1;
const ty1 = Math.floor(pSE.y / 256) + 1;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(CACHE_DIR, { recursive: true });

async function loadTile(x, y) {
  const file = path.join(CACHE_DIR, `${ZOOM}_${x}_${y}.png`);
  if (!fs.existsSync(file)) {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${x}/${y}.png`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download fehlgeschlagen: ${url} (${res.status})`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return PNG.sync.read(fs.readFileSync(file));
}

console.log(`Lade Kacheln x ${tx0}..${tx1}, y ${ty0}..${ty1} ...`);
const tiles = new Map();
for (let ty = ty0; ty <= ty1; ty++) {
  for (let tx = tx0; tx <= tx1; tx++) {
    tiles.set(`${tx},${ty}`, await loadTile(tx, ty));
  }
}

function elevAtPixel(px, py) {
  const tx = Math.floor(px / 256);
  const ty = Math.floor(py / 256);
  const png = tiles.get(`${tx},${ty}`);
  const ix = Math.floor(px) - tx * 256;
  const iy = Math.floor(py) - ty * 256;
  const i = (iy * 256 + ix) * 4;
  const d = png.data;
  return d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
}

function elevBilinear(px, py) {
  const x0 = Math.floor(px - 0.5);
  const y0 = Math.floor(py - 0.5);
  const fx = px - 0.5 - x0;
  const fy = py - 0.5 - y0;
  const a = elevAtPixel(x0, y0);
  const b = elevAtPixel(x0 + 1, y0);
  const c = elevAtPixel(x0, y0 + 1);
  const d = elevAtPixel(x0 + 1, y0 + 1);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

// Gitter: Zeile 0 = Norden, Spalte 0 = Westen
// Gespeichert als ganze Dezimeter (Int16): halb so groß wie Float32, 10 cm genau
const heights = new Int16Array(GRID * GRID);
let min = Infinity;
let max = -Infinity;
for (let row = 0; row < GRID; row++) {
  const zM = -half + (row / (GRID - 1)) * SIZE_M; // Meter nach Süden
  const lat = CENTER.lat - zM / mPerDegLat;
  for (let col = 0; col < GRID; col++) {
    const xM = -half + (col / (GRID - 1)) * SIZE_M; // Meter nach Osten
    const lon = CENTER.lon + xM / mPerDegLon;
    const p = lonLatToPixel(lon, lat);
    const h = elevBilinear(p.x, p.y);
    heights[row * GRID + col] = Math.round(h * 10);
    if (h < min) min = h;
    if (h > max) max = h;
  }
}

// Delta-Kodierung: jeder Wert wird als Unterschied zum linken Nachbarn gespeichert
// (am Zeilenanfang: zum Anfang der Zeile darüber). Das lässt sich viel besser komprimieren.
const deltas = new Int16Array(heights.length);
for (let row = 0; row < GRID; row++) {
  for (let col = 0; col < GRID; col++) {
    const i = row * GRID + col;
    const prev = col > 0 ? heights[i - 1] : row > 0 ? heights[i - GRID] : 0;
    deltas[i] = heights[i] - prev;
  }
}
fs.writeFileSync(path.join(OUT_DIR, 'schleching.bin'), Buffer.from(deltas.buffer));
fs.writeFileSync(
  path.join(OUT_DIR, 'schleching.json'),
  JSON.stringify(
    {
      name: 'Schleching / Chiemgau',
      center: CENTER,
      sizeMeters: SIZE_M,
      grid: GRID,
      format: 'int16-decimeter-delta',
      minHeight: Math.round(min),
      maxHeight: Math.round(max),
      source: 'AWS Terrain Tiles (Terrarium), Mapzen / Copernicus / SRTM u.a.',
    },
    null,
    2,
  ),
);
console.log(`Fertig: ${GRID}x${GRID} Punkte, Höhe ${min.toFixed(0)} m bis ${max.toFixed(0)} m`);
