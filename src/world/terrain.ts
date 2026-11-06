import * as THREE from 'three';
import { hash2, smoothstep, valueNoise } from '../util/noise';

export interface TerrainMeta {
  name: string;
  center: { lat: number; lon: number };
  /** Grenzen in Metern relativ zu Schleching (Norden = negatives z) */
  bounds: { west: number; east: number; north: number; south: number };
  spacing: number;
  cols: number;
  rows: number;
  format: string;
  minHeight: number;
  maxHeight: number;
}

/** Seen, Flüsse, Straßen und Landebahnen aus OpenStreetMap */
export interface MapFeatures {
  attribution: string;
  lakes: { name: string; level: number; rings: number[][] }[];
  rivers: { w: number; pts: number[] }[];
  /** k: 0 Autobahn, 1 Bundesstraße, 2 Landstraße, 3 Ortsstraße, 4 Feldweg, 5 Bahn */
  roads: { k: number; w: number; pts: number[] }[];
  /** Orte, Inseln und Gipfel (kann bei älteren Daten fehlen) */
  places?: { name: string; kind: string; x: number; z: number; ele?: number }[];
  runways: { ref: string; width: number; surface: string; a: [number, number]; b: [number, number] }[];
}

/** Bodenbedeckung (wie in tools/fetch-osm.mjs) */
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
} as const;
const LAKE_SHORE = 32;
const LAKE_DEEP = 144;

/** Breite des Randstreifens, in dem die Berge sanft zum Flachland abfallen. */
const EDGE_FADE = 800;

/** Lädt eine gzip-Datei (entpackt sie selbst, falls der Server es nicht schon getan hat). */
export async function fetchGz(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Konnte ${url} nicht laden (${res.status})`);
  const buf = await res.arrayBuffer();
  const head = new Uint8Array(buf, 0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) return buf;
  if (typeof DecompressionStream === 'undefined') throw new Error('Dieser Browser ist zu alt für den Flugsimulator.');
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

/**
 * Die echte Landschaft von Schleching bis zum Chiemsee.
 * Koordinaten: x = Meter nach Osten, z = Meter nach Süden, y = Höhe über NN.
 * Die Mitte (0, 0) ist Schleching.
 */
export class Terrain {
  /** Halbe Kantenlänge des Kerngebiets um Schleching (für Münzen, Rennen, Verkehr) */
  readonly half: number;
  readonly baseHeight: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  private lakeLevels: Float32Array;

  constructor(
    /** Höhen in Dezimetern */
    private heights: Int16Array,
    private land: Uint8Array,
    readonly meta: TerrainMeta,
    readonly features: MapFeatures,
  ) {
    const b = meta.bounds;
    this.minX = b.west;
    this.maxX = b.east;
    this.minZ = b.north;
    this.maxZ = b.south;
    this.half = Math.min(-b.west, b.east, -b.north, b.south);
    this.baseHeight = meta.minHeight - 20;
    this.lakeLevels = Float32Array.from(features.lakes, (l) => l.level);
  }

  static async load(name: string): Promise<Terrain> {
    const base = `${import.meta.env.BASE_URL}terrain/${name}`;
    const [meta, heightBuf, landBuf, featureBuf] = await Promise.all([
      fetch(`${base}.json`).then((r) => r.json() as Promise<TerrainMeta>),
      fetchGz(`${base}-height.bin.gz`),
      fetchGz(`${base}-land.bin.gz`),
      fetchGz(`${base}-features.json.gz`),
    ]);
    const features = JSON.parse(new TextDecoder().decode(featureBuf)) as MapFeatures;
    return new Terrain(decodeHeights(heightBuf, meta), new Uint8Array(landBuf), meta, features);
  }

  get width() {
    return this.maxX - this.minX;
  }

  get depth() {
    return this.maxZ - this.minZ;
  }

  /** Echte Höhe aus den Daten (ohne Randabfall). */
  private rawHeight(x: number, z: number): number {
    const { cols, rows, spacing } = this.meta;
    const fx = Math.min(cols - 1.001, Math.max(0, (x - this.minX) / spacing));
    const fz = Math.min(rows - 1.001, Math.max(0, (z - this.minZ) / spacing));
    const c = Math.floor(fx);
    const r = Math.floor(fz);
    const tx = fx - c;
    const tz = fz - r;
    const h = this.heights;
    const i = r * cols + c;
    const top = h[i] * (1 - tx) + h[i + 1] * tx;
    const bottom = h[i + cols] * (1 - tx) + h[i + cols + 1] * tx;
    return (top * (1 - tz) + bottom * tz) * 0.1;
  }

  /** Rohwert der Bodenbedeckung an der nächsten Rasterzelle */
  private landRaw(x: number, z: number): number {
    const { cols, rows, spacing } = this.meta;
    const c = Math.round((x - this.minX) / spacing);
    const r = Math.round((z - this.minZ) / spacing);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return LAND.meadow;
    return this.land[r * cols + c];
  }

  /** Bodenbedeckung (Seen zählen als Wasser) */
  landAt(x: number, z: number): number {
    const v = this.landRaw(x, z);
    return v >= LAKE_SHORE ? LAND.water : v;
  }

  /** Liegt die Stelle in einem See? */
  isLake(x: number, z: number): boolean {
    return this.landRaw(x, z) >= LAKE_SHORE;
  }

  /** Name des Sees an dieser Stelle (oder leer) */
  lakeName(x: number, z: number): string {
    const v = this.landRaw(x, z);
    if (v < LAKE_SHORE) return '';
    return this.features.lakes[v - (v >= LAKE_DEEP ? LAKE_DEEP : LAKE_SHORE)]?.name ?? '';
  }

  /** Steht hier Wasser (See oder breiter Fluss)? */
  isWater(x: number, z: number): boolean {
    const v = this.landRaw(x, z);
    return v === LAND.water || v >= LAKE_SHORE;
  }

  /**
   * Geländehöhe an einer Stelle (Seeboden liegt unter dem Wasserspiegel).
   * Zu den echten Daten kommen kleine Unebenheiten an den Berghängen (nicht im Tal),
   * und zum Rand hin flacht alles sanft ab.
   */
  heightAt(x: number, z: number): number {
    let h = this.rawHeight(x, z);
    const v = this.landRaw(x, z);
    if (v >= LAKE_SHORE) {
      const deep = v >= LAKE_DEEP;
      const level = this.lakeLevels[v - (deep ? LAKE_DEEP : LAKE_SHORE)];
      h = Math.min(h, level - (deep ? 2.5 : 0.4));
    } else if (h > 620) {
      const bumps = (valueNoise(x / 70, z / 70) - 0.5) * 7 + (valueNoise(x / 28, z / 28) - 0.5) * 3;
      h += bumps * smoothstep(620, 850, h);
    }
    const edgeDist = Math.min(x - this.minX, this.maxX - x, z - this.minZ, this.maxZ - z);
    const fade = smoothstep(0, EDGE_FADE, edgeDist);
    return this.baseHeight + (h - this.baseHeight) * fade;
  }

  /** Oberfläche zum Landen und für Abstände: Gelände oder Wasserspiegel. */
  surfaceAt(x: number, z: number): number {
    const h = this.heightAt(x, z);
    const v = this.landRaw(x, z);
    if (v < LAKE_SHORE) return h;
    return Math.max(h, this.lakeLevels[v - (v >= LAKE_DEEP ? LAKE_DEEP : LAKE_SHORE)]);
  }

  /** Steilheit (Höhenunterschied pro Meter). */
  slopeAt(x: number, z: number, d = 20): number {
    const gx = (this.heightAt(x + d, z) - this.heightAt(x - d, z)) / (2 * d);
    const gz = (this.heightAt(x, z + d) - this.heightAt(x, z - d)) / (2 * d);
    return Math.hypot(gx, gz);
  }

  isInside(x: number, z: number): boolean {
    return x > this.minX && x < this.maxX && z > this.minZ && z < this.maxZ;
  }

  /** Wie weit liegt die Stelle außerhalb des Gebiets (m)? Negativ = innen. */
  outsideDistance(x: number, z: number): number {
    return Math.max(this.minX - x, x - this.maxX, this.minZ - z, z - this.maxZ);
  }
}

function decodeHeights(buf: ArrayBuffer, meta: TerrainMeta): Int16Array {
  if (meta.format !== 'int16-decimeter-delta-gz') throw new Error(`Unbekanntes Höhenformat: ${meta.format}`);
  const { cols, rows } = meta;
  const deltas = new Int16Array(buf);
  const out = new Int16Array(deltas.length);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      out[i] = (col > 0 ? out[i - 1] : row > 0 ? out[i - cols] : 0) + deltas[i];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Darstellung: Die Landschaft ist in Kacheln (Chunks) aufgeteilt. Kacheln nahe
// am Flugzeug bekommen ein feines Gitter, weit entfernte ein grobes.
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 1000;
/** Gitterabschnitte pro Kachel je Detailstufe (128 = alle 7,8 m ein Punkt) */
const LEVEL_SEGMENTS = [128, 64, 32, 16, 8];
/** Bis zu dieser Entfernung (m) wird die jeweilige Detailstufe verwendet */
const LEVEL_DISTANCE = [1600, 3200, 5500, 9000, Infinity];
/** Weiter weg verschwinden Kacheln im Dunst */
const HIDE_DISTANCE = 23000;

const C = (hex: string) => new THREE.Color(hex);
const COLORS = {
  meadow: C('#86b85c'),
  meadowDark: C('#6fa04a'),
  forest: C('#4b7a37'),
  alpine: C('#a7b86e'),
  rock: C('#8f8b84'),
  scree: C('#aaa59b'),
  snow: C('#f3f5f7'),
  water: C('#4f86a6'),
  lakeBed: C('#3c6d8a'),
  settlement: C('#9fab7a'),
  industrial: C('#a9a79f'),
  wetland: C('#8c8d5a'),
  scrub: C('#557a3c'),
  farm: [C('#b3bb68'), C('#9db759'), C('#c4b878'), C('#8fb35a')],
};

interface Chunk {
  x0: number;
  z0: number;
  level: number;
  mesh?: THREE.Mesh;
}

export class TerrainRenderer {
  readonly group = new THREE.Group();
  private chunks: Chunk[] = [];
  private material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  private tmpColor = new THREE.Color();

  constructor(private terrain: Terrain) {
    for (let z0 = terrain.minZ; z0 < terrain.maxZ - 1; z0 += CHUNK_SIZE) {
      for (let x0 = terrain.minX; x0 < terrain.maxX - 1; x0 += CHUNK_SIZE) {
        this.chunks.push({ x0, z0, level: -1 });
      }
    }

    // Flachland außerhalb des Gebiets, damit die Welt nicht im Nichts endet
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200000, 200000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: COLORS.meadow, roughness: 1 }),
    );
    ground.position.y = terrain.baseHeight - 0.5;
    this.group.add(ground);
  }

  /**
   * Passt die Detailstufen an die Kameraposition an.
   * maxBuilds begrenzt, wie viele Kacheln pro Bild neu gebaut werden (gegen Ruckeln).
   */
  update(camera: THREE.Vector3, maxBuilds = 2) {
    const todo: { chunk: Chunk; level: number; dist: number }[] = [];
    for (const chunk of this.chunks) {
      const dx = Math.max(chunk.x0 - camera.x, 0, camera.x - (chunk.x0 + CHUNK_SIZE));
      const dz = Math.max(chunk.z0 - camera.z, 0, camera.z - (chunk.z0 + CHUNK_SIZE));
      const dist = Math.hypot(dx, dz);
      if (chunk.mesh) chunk.mesh.visible = dist < HIDE_DISTANCE;
      const level = LEVEL_DISTANCE.findIndex((d) => dist < d);
      if (level !== chunk.level) todo.push({ chunk, level, dist });
    }
    todo.sort((a, b) => a.dist - b.dist);
    for (const { chunk, level } of todo.slice(0, maxBuilds)) {
      const mesh = new THREE.Mesh(this.buildGeometry(chunk, level), this.material);
      if (chunk.mesh) {
        this.group.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
      }
      chunk.mesh = mesh;
      chunk.level = level;
      this.group.add(mesh);
    }
    return todo.length;
  }

  /** Baut alle Kacheln sofort (beim Start). */
  buildAll(camera: THREE.Vector3) {
    while (this.update(camera, 1000) > 0);
  }

  private colorAt(x: number, z: number, y: number, slope: number, out: THREE.Color) {
    const jitter = (hash2(Math.round(x / 9), Math.round(z / 9)) - 0.5) * 50;
    const patch = valueNoise(x / 180, z / 180);
    const h = y + jitter + (patch - 0.5) * 80;
    const land = this.terrain.landAt(x, z);
    let natural = true; // Fels und Schnee nur auf natürlichem Boden

    switch (land) {
      case LAND.forest:
        out.copy(COLORS.forest);
        break;
      case LAND.water:
        out.copy(this.terrain.surfaceAt(x, z) > y + 0.2 ? COLORS.lakeBed : COLORS.water);
        natural = false;
        break;
      case LAND.settlement:
        out.copy(COLORS.settlement).lerp(COLORS.meadow, patch * 0.4);
        natural = false;
        break;
      case LAND.industrial:
        out.copy(COLORS.industrial);
        natural = false;
        break;
      case LAND.rock:
        out.copy(COLORS.rock);
        break;
      case LAND.scree:
        out.copy(COLORS.scree);
        break;
      case LAND.wetland:
        out.copy(COLORS.wetland).lerp(COLORS.meadowDark, patch * 0.5);
        break;
      case LAND.scrub:
        out.copy(COLORS.scrub);
        break;
      case LAND.farmland:
        // Felder: große Flecken in verschiedenen Farben
        out.copy(COLORS.farm[Math.floor(hash2(Math.floor(x / 140 + patch), Math.floor(z / 110)) * 4)]);
        break;
      default:
        out.copy(COLORS.meadow).lerp(COLORS.meadowDark, smoothstep(0.35, 0.75, patch));
        if (h > 1380) out.lerp(COLORS.alpine, smoothstep(1380, 1560, h));
    }

    if (natural) {
      out.lerp(COLORS.rock, smoothstep(0.62, 0.95, slope + jitter * 0.002));
      if (h > 1680) out.lerp(COLORS.snow, smoothstep(1680, 1740, h) * (1 - smoothstep(0.6, 0.9, slope)));
    }

    const shade = 0.93 + hash2(Math.round(z / 7), Math.round(x / 7)) * 0.14;
    out.multiplyScalar(shade);
  }

  private buildGeometry(chunk: Chunk, level: number): THREE.BufferGeometry {
    const seg = LEVEL_SEGMENTS[level];
    const n = seg + 1;
    const step = CHUNK_SIZE / seg;
    const skirtDepth = step * 1.5 + 4;
    const t = this.terrain;
    const c = this.tmpColor;

    const vertCount = n * n + 4 * n;
    const positions = new Float32Array(vertCount * 3);
    const colors = new Float32Array(vertCount * 3);
    const setVertex = (v: number, x: number, y: number, z: number) => {
      positions[v * 3] = x;
      positions[v * 3 + 1] = y;
      positions[v * 3 + 2] = z;
    };

    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const x = chunk.x0 + col * step;
        const z = chunk.z0 + row * step;
        const y = t.heightAt(x, z);
        const v = row * n + col;
        setVertex(v, x, y, z);
        this.colorAt(x, z, y, t.slopeAt(x, z, Math.max(step, 10)), c);
        colors[v * 3] = c.r;
        colors[v * 3 + 1] = c.g;
        colors[v * 3 + 2] = c.b;
      }
    }

    // "Schürzen": senkrechte Streifen an den Kachelrändern, damit zwischen
    // Kacheln mit unterschiedlicher Detailstufe keine Lücken zu sehen sind.
    const edges = [
      (k: number) => k, // Norden
      (k: number) => (n - 1) * n + k, // Süden
      (k: number) => k * n, // Westen
      (k: number) => k * n + (n - 1), // Osten
    ];
    const indices: number[] = [];
    edges.forEach((edge, e) => {
      const baseV = n * n + e * n;
      for (let k = 0; k < n; k++) {
        const src = edge(k);
        setVertex(baseV + k, positions[src * 3], positions[src * 3 + 1] - skirtDepth, positions[src * 3 + 2]);
        colors.copyWithin((baseV + k) * 3, src * 3, src * 3 + 3);
        if (k < n - 1) {
          const a = src;
          const b = edge(k + 1);
          indices.push(a, baseV + k, b, b, baseV + k, baseV + k + 1);
        }
      }
    });

    for (let row = 0; row < seg; row++) {
      for (let col = 0; col < seg; col++) {
        const a = row * n + col;
        const b = a + 1;
        const d = a + n;
        const e = d + 1;
        indices.push(a, d, b, b, d, e);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }
}
