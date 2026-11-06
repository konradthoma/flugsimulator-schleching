// Lädt Karteninhalte aus OpenStreetMap (Gewässer, Wald, Ortschaften, Straßen, Gebäude)
// und bereitet sie für das Spiel auf.
//
// Ergebnis in public/terrain/:
//   schleching-land.bin.gz      Bodenbedeckung als Raster (gleiches Gitter wie die Höhen)
//   schleching-features.json.gz Seen, Flüsse, Straßen, Bahn
//   schleching-buildings.bin.gz Gebäude (Lage, Größe, Ausrichtung, Höhe, Art)
//
// Daten: © OpenStreetMap-Mitwirkende, Lizenz ODbL (https://www.openstreetmap.org/copyright)
// Aufruf: npm run osm   (lädt nur, was noch nicht im Cache tools/.osm-cache liegt)

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { BOUNDS, COLS, ROWS, SPACING, geoBox, toWorld } from './region.mjs';

const OUT_DIR = path.resolve('public/terrain');
const CACHE_DIR = path.resolve('tools/.osm-cache');
// Mehrere Server: ist einer überlastet, wird der nächste versucht
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const UA = 'flugsimulator-schleching/0.2 (Hobbyprojekt, einmaliger Download)';

// Bodenbedeckung (muss zu src/world/landcover.ts passen)
export const LAND = {
  meadow: 0,
  forest: 1,
  water: 2,
  settlement: 3,
  rock: 4,
  wetland: 5,
  scrub: 6,
  clearing: 7,
  farmland: 8,
  industrial: 9,
  scree: 10,
};
const LAKE_SHORE = 32; // 32 + Seenummer: im See, nah am Ufer
const LAKE_DEEP = 144; // 144 + Seenummer: im See
const MAX_LAKES = 112;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(CACHE_DIR, { recursive: true });

const box = geoBox(400);
const BBOX = `(${box.south.toFixed(5)},${box.west.toFixed(5)},${box.north.toFixed(5)},${box.east.toFixed(5)})`;

const QUERIES = {
  water: `
    way["natural"="water"]${BBOX}; relation["natural"="water"]${BBOX};
    way["waterway"="riverbank"]${BBOX}; relation["waterway"="riverbank"]${BBOX};
    way["landuse"~"^(reservoir|basin)$"]${BBOX};
    way["waterway"~"^(river|stream|canal)$"]${BBOX};`,
  land: `
    way["landuse"~"^(forest|residential|commercial|industrial|retail|farmyard|farmland|quarry|construction|military)$"]${BBOX};
    relation["landuse"~"^(forest|residential|commercial|industrial|retail|farmyard|farmland|quarry)$"]${BBOX};
    way["natural"~"^(wood|scrub|heath|bare_rock|scree|wetland|shingle)$"]${BBOX};
    relation["natural"~"^(wood|scrub|heath|bare_rock|scree|wetland)$"]${BBOX};`,
  roads: `
    way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|track)$"]${BBOX};
    way["railway"~"^(rail|narrow_gauge)$"]${BBOX};`,
  places: `
    node["place"~"^(town|village|hamlet|island|islet)$"]["name"]${BBOX};
    way["place"~"^(island|islet)$"]["name"]${BBOX};
    node["natural"="peak"]["name"]${BBOX};`,
  aero: `
    way["aeroway"="runway"]${BBOX};`,
  buildings: `
    way["building"]${BBOX};
    relation["building"]${BBOX};`,
};

async function overpass(name) {
  const file = path.join(CACHE_DIR, `${name}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`Lade ${name} aus OpenStreetMap ...`);
  // Viel Speicher nur für die großen Abfragen anfordern (sonst lehnen volle Server ab)
  const big = name === 'buildings' || name === 'land' ? '[maxsize:1073741824]' : '';
  const query = `[out:json][timeout:${big ? 300 : 120}]${big};(${QUERIES[name]});out geom;`;
  for (let attempt = 1; ; attempt++) {
    const server = OVERPASS[(attempt - 1) % OVERPASS.length];
    const res = await fetch(server, {
      signal: AbortSignal.timeout(240000),
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
    }).catch((e) => ({ ok: false, status: e.name }));
    if (res.ok) {
      const text = await res.text();
      fs.writeFileSync(file, text);
      return JSON.parse(text);
    }
    if (attempt >= 6) throw new Error(`Overpass-Fehler ${res.status} bei ${name}`);
    console.log(`  ${new URL(server).host} antwortet ${res.status}, nächster Versuch ...`);
    await new Promise((r) => setTimeout(r, 10000));
  }
}

// ---------- Geometrie ----------

const key = (p) => p.k;
function wayPoints(geometry) {
  return geometry.map((g) => {
    const [x, z] = toWorld(g.lat, g.lon);
    return { x, z, k: `${g.lat.toFixed(7)},${g.lon.toFixed(7)}` };
  });
}

/** Setzt Wegstücke zu geschlossenen Ringen zusammen. */
function assembleRings(ways) {
  const pool = ways.filter((w) => w.length >= 2).map((w) => w.slice());
  const rings = [];
  while (pool.length) {
    let cur = pool.pop();
    let changed = true;
    while (key(cur[0]) !== key(cur[cur.length - 1]) && changed) {
      changed = false;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i];
        const a = key(cur[0]);
        const b = key(cur[cur.length - 1]);
        if (key(w[0]) === b) cur = cur.concat(w.slice(1));
        else if (key(w[w.length - 1]) === b) cur = cur.concat(w.slice(0, -1).reverse());
        else if (key(w[w.length - 1]) === a) cur = w.concat(cur.slice(1));
        else if (key(w[0]) === a) cur = w.slice().reverse().concat(cur.slice(1));
        else continue;
        pool.splice(i, 1);
        changed = true;
        break;
      }
    }
    if (key(cur[0]) === key(cur[cur.length - 1]) && cur.length >= 4) rings.push(cur);
  }
  return rings;
}

/** Flächen eines OSM-Elements: [{ outer: Ring, inners: Ring[] }] */
function areasOf(el) {
  if (el.type === 'way') {
    if (!el.geometry) return [];
    const ring = wayPoints(el.geometry);
    if (key(ring[0]) !== key(ring[ring.length - 1]) || ring.length < 4) return [];
    return [{ outer: ring, inners: [] }];
  }
  if (el.type === 'relation' && el.members) {
    const outers = assembleRings(el.members.filter((m) => m.type === 'way' && m.geometry && m.role !== 'inner').map((m) => wayPoints(m.geometry)));
    const inners = assembleRings(el.members.filter((m) => m.type === 'way' && m.geometry && m.role === 'inner').map((m) => wayPoints(m.geometry)));
    return outers.map((outer) => ({ outer, inners: inners.filter((r) => pointInRing(r[0], outer)) }));
  }
  return [];
}

function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j].x + r[i].x) * (r[j].z - r[i].z);
  return Math.abs(a / 2);
}

function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Douglas-Peucker-Vereinfachung */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const a = pts[s];
    const b = pts[e];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs((pts[i].x - a.x) * dz - (pts[i].z - a.z) * dx) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const flat = (pts) => pts.flatMap((p) => [Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10]);

// ---------- Raster ----------

const land = new Uint8Array(COLS * ROWS);
const colOf = (x) => (x - BOUNDS.west) / SPACING;
const rowOf = (z) => (z - BOUNDS.north) / SPACING;

/** Füllt Flächen (gerade-ungerade-Regel über alle Ringe). fn(i) wird für jede Zelle aufgerufen. */
function fillRings(rings, fn) {
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const r of rings) for (const p of r) (zMin = Math.min(zMin, p.z)), (zMax = Math.max(zMax, p.z));
  const r0 = Math.max(0, Math.ceil(rowOf(zMin)));
  const r1 = Math.min(ROWS - 1, Math.floor(rowOf(zMax)));
  const xs = [];
  for (let row = r0; row <= r1; row++) {
    const z = BOUNDS.north + row * SPACING;
    xs.length = 0;
    for (const r of rings) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const a = r[i];
        const b = r[j];
        if (a.z > z !== b.z > z) xs.push(a.x + ((z - a.z) / (b.z - a.z)) * (b.x - a.x));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(colOf(xs[k])));
      const c1 = Math.min(COLS - 1, Math.floor(colOf(xs[k + 1])));
      for (let col = c0; col <= c1; col++) fn(row * COLS + col);
    }
  }
}

/** Markiert alle Zellen, deren Mitte näher als halfWidth an der Linie liegt. */
function strokeLine(pts, halfWidth, fn) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const c0 = Math.max(0, Math.floor(colOf(Math.min(a.x, b.x) - halfWidth)));
    const c1 = Math.min(COLS - 1, Math.ceil(colOf(Math.max(a.x, b.x) + halfWidth)));
    const r0 = Math.max(0, Math.floor(rowOf(Math.min(a.z, b.z) - halfWidth)));
    const r1 = Math.min(ROWS - 1, Math.ceil(rowOf(Math.max(a.z, b.z) + halfWidth)));
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const x = BOUNDS.west + col * SPACING;
        const z = BOUNDS.north + row * SPACING;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
        if (Math.hypot(x - a.x - t * dx, z - a.z - t * dz) <= halfWidth) fn(row * COLS + col);
      }
    }
  }
}

// ---------- Höhen (für die Wasserspiegel der Seen) ----------

const meta = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'schleching.json'), 'utf8'));
if (meta.cols !== COLS || meta.rows !== ROWS) throw new Error('Erst "npm run terrain" ausführen (Gitter passt nicht).');
const heights = (() => {
  const d = new Int16Array(new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(OUT_DIR, 'schleching-height.bin.gz')))).buffer);
  const dm = new Int32Array(d.length);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const i = row * COLS + col;
      dm[i] = (col > 0 ? dm[i - 1] : row > 0 ? dm[i - COLS] : 0) + d[i];
    }
  }
  return Float32Array.from(dm, (v) => v / 10);
})();
function heightAt(x, z) {
  const c = Math.min(COLS - 1, Math.max(0, Math.round(colOf(x))));
  const r = Math.min(ROWS - 1, Math.max(0, Math.round(rowOf(z))));
  return heights[r * COLS + c];
}

// ---------- Verarbeitung ----------

const tagsOf = (el) => el.tags ?? {};

function landClass(t) {
  if (t.landuse === 'forest' || t.natural === 'wood') return LAND.forest;
  if (t.natural === 'scrub' || t.natural === 'heath') return LAND.scrub;
  if (t.natural === 'bare_rock') return LAND.rock;
  if (t.natural === 'scree' || t.natural === 'shingle' || t.landuse === 'quarry') return LAND.scree;
  if (t.natural === 'wetland') return LAND.wetland;
  if (t.landuse === 'farmland') return LAND.farmland;
  if (['commercial', 'industrial', 'retail', 'construction', 'military'].includes(t.landuse)) return LAND.industrial;
  if (t.landuse === 'residential' || t.landuse === 'farmyard') return LAND.settlement;
  return -1;
}
// Reihenfolge beim Zeichnen: später gezeichnet = gewinnt
const PRIORITY = [LAND.farmland, LAND.wetland, LAND.scrub, LAND.forest, LAND.scree, LAND.rock, LAND.settlement, LAND.industrial];

const landData = await overpass('land');
const waterData = await overpass('water');
const roadData = await overpass('roads');
const buildingData = await overpass('buildings');
const aeroData = await overpass('aero');
const placeData = await overpass('places');

// 1) Bodenbedeckung
const byClass = new Map(PRIORITY.map((c) => [c, []]));
for (const el of landData.elements) {
  const c = landClass(tagsOf(el));
  if (c < 0) continue;
  for (const a of areasOf(el)) byClass.get(c).push(a);
}
for (const c of PRIORITY) {
  for (const a of byClass.get(c)) {
    fillRings([a.outer, ...a.inners], (i) => {
      land[i] = c;
    });
  }
}
console.log('Bodenbedeckung:', [...byClass].map(([c, l]) => `${Object.keys(LAND).find((k) => LAND[k] === c)} ${l.length}`).join(', '));

// 2) Gewässer
const RIVER_WATER = new Set(['river', 'stream', 'canal', 'ditch', 'drain', 'stream_pool', 'rapids']);
const lakes = [];
const rivers = [];
const insideBounds = (p, m = 0) => p.x > BOUNDS.west - m && p.x < BOUNDS.east + m && p.z > BOUNDS.north - m && p.z < BOUNDS.south + m;

for (const el of waterData.elements) {
  const t = tagsOf(el);
  if (t.waterway && el.type === 'way' && el.geometry && !t.natural) {
    if (t.tunnel === 'yes' || t.tunnel === 'culvert' || t.layer?.startsWith('-')) continue;
    const pts = wayPoints(el.geometry);
    if (!pts.some((p) => insideBounds(p, 100))) continue;
    const tagged = parseFloat(t.width);
    const width = Number.isFinite(tagged) && tagged > 0 ? Math.min(tagged, 80) : t.waterway === 'river' ? 18 : t.waterway === 'canal' ? 7 : 3;
    rivers.push({ w: width, name: t.name ?? '', pts: simplify(pts, 1.5) });
    continue;
  }
  for (const a of areasOf(el)) {
    const area = ringArea(a.outer) - a.inners.reduce((s, r) => s + ringArea(r), 0);
    const isRiver = t.waterway === 'riverbank' || RIVER_WATER.has(t.water);
    if (isRiver || area < 1500) {
      fillRings([a.outer, ...a.inners], (i) => {
        land[i] = LAND.water;
      });
    } else {
      lakes.push({ ...a, area, name: t.name ?? '' });
    }
  }
}

// Flüsse (ab ca. 8 m Breite) auch ins Raster, damit sie aus der Ferne zu sehen sind
for (const r of rivers) if (r.w >= 8) strokeLine(r.pts, r.w / 2, (i) => (land[i] = LAND.water));

// Seen: größte zuerst, mit Wasserspiegel aus den Uferhöhen
lakes.sort((a, b) => b.area - a.area);
const lakeOut = [];
for (const lake of lakes) {
  if (lake.outer.filter((p) => insideBounds(p, -800)).length < lake.outer.length * 0.6) {
    fillRings([lake.outer, ...lake.inners], (i) => (land[i] = LAND.water));
    continue;
  }
  const id = lakeOut.length;
  if (id >= MAX_LAKES) {
    fillRings([lake.outer, ...lake.inners], (i) => (land[i] = LAND.water));
    continue;
  }
  // Uferhöhen alle 10 m entlang des Ufers
  const shore = [];
  for (let i = 0; i + 1 < lake.outer.length; i++) {
    const a = lake.outer[i];
    const b = lake.outer[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 10));
    for (let k = 0; k < n; k++) {
      const p = { x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n };
      if (insideBounds(p)) shore.push(heightAt(p.x, p.z));
    }
  }
  if (shore.length < 4) continue;
  shore.sort((a, b) => a - b);
  const level = shore[Math.floor(shore.length * 0.15)] + 0.2;

  const cells = [];
  fillRings([lake.outer, ...lake.inners], (i) => cells.push(i));
  const inLake = new Set(cells);
  for (const i of cells) {
    const r = Math.floor(i / COLS);
    const c = i % COLS;
    let deep = true;
    for (let dr = -1; dr <= 1 && deep; dr++) for (let dc = -1; dc <= 1; dc++) if (!inLake.has((r + dr) * COLS + c + dc)) deep = false;
    land[i] = (deep ? LAKE_DEEP : LAKE_SHORE) + id;
  }
  const tol = lake.area > 1e6 ? 4 : 1.5;
  lakeOut.push({
    name: lake.name,
    level: Math.round(level * 10) / 10,
    rings: [lake.outer, ...lake.inners].map((r) => flat(simplify(r, tol))),
  });
}
console.log(`Seen: ${lakeOut.length} (größte: ${lakeOut.slice(0, 4).map((l) => `${l.name || '?'} ${l.level} m`).join(', ')}), Flüsse/Bäche: ${rivers.length}`);

// 3) Straßen und Bahn
const ROAD_KIND = {
  motorway: [0, 11], motorway_link: [0, 6], trunk: [1, 9], trunk_link: [1, 6], primary: [1, 7.5], primary_link: [1, 6],
  secondary: [2, 6.5], secondary_link: [2, 5.5], tertiary: [2, 6], tertiary_link: [2, 5],
  unclassified: [3, 4.5], residential: [3, 5], living_street: [3, 4], track: [4, 3],
};
const roads = [];
for (const el of roadData.elements) {
  const t = tagsOf(el);
  if (!el.geometry || t.tunnel === 'yes' || t.tunnel === 'building_passage' || t.area === 'yes') continue;
  let kind;
  let width;
  if (t.railway) [kind, width] = [5, 4];
  else if (ROAD_KIND[t.highway]) [kind, width] = ROAD_KIND[t.highway];
  else continue;
  if (kind === 4 && t.tracktype && t.tracktype !== 'grade1' && t.tracktype !== 'grade2') continue; // nur befestigte Feldwege
  const pts = wayPoints(el.geometry);
  if (!pts.some((p) => insideBounds(p, 50))) continue;
  const s = simplify(pts, kind <= 1 ? 1 : 1.5);
  roads.push({ k: kind, w: width, pts: s });
  // Schneise durch den Wald
  strokeLine(s, width / 2 + 3, (i) => {
    if (land[i] === LAND.forest || land[i] === LAND.scrub) land[i] = LAND.clearing;
  });
}
console.log(`Straßen/Bahn: ${roads.length} Abschnitte, ${(roads.reduce((s, r) => s + r.pts.length, 0) / 1000).toFixed(0)}k Punkte`);

// 4) Gebäude
const TYPE = { house: 0, barn: 1, industrial: 2, church: 3, small: 4, apartments: 5 };
function buildingType(t, area) {
  const b = t.building;
  if (['church', 'chapel', 'cathedral', 'basilica', 'monastery'].includes(b) || (t.amenity === 'place_of_worship' && area > 60)) return TYPE.church;
  if (['garage', 'garages', 'shed', 'carport', 'hut', 'cabin', 'kiosk', 'roof', 'transformer_tower', 'service', 'toilets', 'bunker', 'container'].includes(b) || area < 35) return TYPE.small;
  if (['industrial', 'warehouse', 'commercial', 'retail', 'supermarket', 'office', 'manufacture', 'hangar', 'sports_hall', 'train_station', 'parking'].includes(b)) return TYPE.industrial;
  if (['barn', 'farm_auxiliary', 'stable', 'cowshed', 'greenhouse', 'agricultural', 'sty', 'riding_hall'].includes(b)) return TYPE.barn;
  if (['apartments', 'hotel', 'school', 'hospital', 'public', 'civic', 'university', 'dormitory', 'government', 'kindergarten', 'castle', 'palace'].includes(b)) return TYPE.apartments;
  if (b === 'farm' || b === 'yes') return area > 450 ? TYPE.barn : area > 300 ? TYPE.apartments : TYPE.house;
  return TYPE.house;
}
const DEFAULT_HEIGHT = [6, 6.5, 8, 11, 2.8, 9];

function convexHull(pts) {
  const p = pts.map((q) => [q.x, q.z]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p[i]) <= 0) upper.pop();
    upper.push(p[i]);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Kleinstes umschließendes Rechteck: Mitte, lange Seite, kurze Seite, Winkel der langen Seite */
function minRect(ring) {
  const hull = convexHull(ring);
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const q of hull) {
      const u = q[0] * c + q[1] * s;
      const v = -q[0] * s + q[1] * c;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) {
      const um = (u0 + u1) / 2;
      const vm = (v0 + v1) / 2;
      best = { area, cx: um * c - vm * s, cz: um * s + vm * c, du: u1 - u0, dv: v1 - v0, ang };
    }
  }
  if (best.du < best.dv) return { cx: best.cx, cz: best.cz, len: best.dv, wid: best.du, ang: best.ang + Math.PI / 2, area: best.area };
  return { cx: best.cx, cz: best.cz, len: best.du, wid: best.dv, ang: best.ang, area: best.area };
}

const buildings = [];
for (const el of buildingData.elements) {
  const t = tagsOf(el);
  if (t.building === 'no' || t.building === 'construction' || t.building === 'ruins') continue;
  if (t.location === 'underground' || t.layer?.startsWith('-')) continue;
  for (const a of areasOf(el)) {
    if (!insideBounds(a.outer[0])) continue;
    const area = ringArea(a.outer);
    if (area < 12) continue;
    const r = minRect(a.outer);
    const type = buildingType(t, area);
    let h = parseFloat(t.height);
    const levels = parseFloat(t['building:levels']);
    if (!Number.isFinite(h)) h = Number.isFinite(levels) ? levels * 2.9 + 0.6 : DEFAULT_HEIGHT[type] * (type === 2 && area > 3000 ? 1.3 : 1);
    else if (type !== TYPE.church) h *= 0.75; // Gesamthöhe -> Traufhöhe (ungefähr)
    h = Math.min(Math.max(h, 2.4), type === TYPE.church ? 30 : 40);
    const flatRoof = t['roof:shape'] === 'flat' || (type === TYPE.industrial && r.wid > 25) ? 1 : 0;
    // Bäume weg vom Haus
    fillRings([a.outer], (i) => {
      if (land[i] === LAND.forest || land[i] === LAND.scrub) land[i] = LAND.clearing;
    });
    buildings.push([Math.round(r.cx), Math.round(r.cz), Math.round(r.len * 10), Math.round(r.wid * 10), Math.round(((r.ang % Math.PI) + Math.PI) % Math.PI * 10000) - 15708, Math.round(h * 10), type | (flatRoof << 4), 0]);
  }
}
console.log(`Gebäude: ${buildings.length}`);

// ---------- Speichern ----------

const bBuf = new Int16Array(buildings.length * 8);
buildings.forEach((b, i) => bBuf.set(b, i * 8));
fs.writeFileSync(path.join(OUT_DIR, 'schleching-buildings.bin.gz'), zlib.gzipSync(Buffer.from(bBuf.buffer), { level: 9 }));
fs.writeFileSync(path.join(OUT_DIR, 'schleching-land.bin.gz'), zlib.gzipSync(Buffer.from(land.buffer), { level: 9 }));
const runways = aeroData.elements
  .filter((el) => el.geometry && el.geometry.length >= 2)
  .map((el) => {
    const pts = wayPoints(el.geometry);
    const a = pts[0];
    const b = pts[pts.length - 1];
    return { ref: el.tags?.ref ?? '', width: parseFloat(el.tags?.width) || 20, surface: el.tags?.surface ?? '', a: [a.x, a.z].map(Math.round), b: [b.x, b.z].map(Math.round) };
  })
  .filter((r) => insideBounds({ x: r.a[0], z: r.a[1] }, -1000));
console.log('Landebahnen:', runways.map((r) => `${r.ref || '?'} ${Math.round(Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]))} m`).join(', '));
// Ortsnamen, Gipfel und Inseln (für die Anzeige "Wo bin ich?")
const PLACE_RANK = { town: 0, village: 1, island: 2, islet: 4, hamlet: 3, peak: 2 };
const places = [];
for (const el of placeData.elements) {
  const t = tagsOf(el);
  const kind = t.natural === 'peak' ? 'peak' : t.place;
  let lat = el.lat;
  let lon = el.lon;
  if (el.type === 'way' && el.geometry) {
    lat = el.geometry.reduce((s, g) => s + g.lat, 0) / el.geometry.length;
    lon = el.geometry.reduce((s, g) => s + g.lon, 0) / el.geometry.length;
  }
  if (lat === undefined) continue;
  const [x, z] = toWorld(lat, lon);
  if (!insideBounds({ x, z }, -300)) continue;
  const ele = parseFloat(t.ele);
  if (kind === 'peak' && !(ele > 900)) continue; // nur richtige Berge
  places.push({ name: t.name, kind, x: Math.round(x), z: Math.round(z), ele: Number.isFinite(ele) ? Math.round(ele) : undefined, rank: PLACE_RANK[kind] ?? 5 });
}
places.sort((a, b) => a.rank - b.rank);
console.log(`Orte: ${places.length} (${places.slice(0, 8).map((p) => p.name).join(', ')} ...)`);

const features = {
  attribution: '© OpenStreetMap-Mitwirkende (ODbL)',
  places: places.map(({ rank, ...p }) => p),
  runways,
  lakes: lakeOut,
  rivers: rivers.map((r) => ({ w: r.w, pts: flat(r.pts) })),
  roads: roads.map((r) => ({ k: r.k, w: r.w, pts: flat(r.pts) })),
};
fs.writeFileSync(path.join(OUT_DIR, 'schleching-features.json.gz'), zlib.gzipSync(JSON.stringify(features), { level: 9 }));
for (const f of ['schleching-land.bin.gz', 'schleching-features.json.gz', 'schleching-buildings.bin.gz']) {
  console.log(`${f}: ${(fs.statSync(path.join(OUT_DIR, f)).size / 1e6).toFixed(2)} MB`);
}
