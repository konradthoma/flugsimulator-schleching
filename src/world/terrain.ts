import * as THREE from 'three';
import { hash2, smoothstep, valueNoise } from '../util/noise';

export interface TerrainMeta {
  name: string;
  center: { lat: number; lon: number };
  sizeMeters: number;
  grid: number;
  format: string;
  minHeight: number;
  maxHeight: number;
}

/** Breite des Randstreifens, in dem die Berge sanft zum Flachland abfallen. */
const EDGE_FADE = 800;

/**
 * Die echte Berglandschaft rund um Schleching.
 * Koordinaten: x = Meter nach Osten, z = Meter nach Süden, y = Höhe über NN.
 * Die Mitte (0, 0) ist Schleching.
 */
export class Terrain {
  readonly half: number;
  readonly baseHeight: number;

  constructor(
    private heights: Float32Array,
    readonly meta: TerrainMeta,
  ) {
    this.half = meta.sizeMeters / 2;
    this.baseHeight = meta.minHeight - 20;
  }

  static async load(name: string): Promise<Terrain> {
    const base = import.meta.env.BASE_URL;
    const [meta, buf] = await Promise.all([
      fetch(`${base}terrain/${name}.json`).then((r) => r.json() as Promise<TerrainMeta>),
      fetch(`${base}terrain/${name}.bin`).then((r) => r.arrayBuffer()),
    ]);
    return new Terrain(decodeHeights(buf, meta), meta);
  }

  /** Echte Höhe aus den Daten (ohne Randabfall). */
  private rawHeight(x: number, z: number): number {
    const g = this.meta.grid;
    const fx = Math.min(g - 1.001, Math.max(0, ((x + this.half) / this.meta.sizeMeters) * (g - 1)));
    const fz = Math.min(g - 1.001, Math.max(0, ((z + this.half) / this.meta.sizeMeters) * (g - 1)));
    const c = Math.floor(fx);
    const r = Math.floor(fz);
    const tx = fx - c;
    const tz = fz - r;
    const h = this.heights;
    const i = r * g + c;
    const top = h[i] * (1 - tx) + h[i + 1] * tx;
    const bottom = h[i + g] * (1 - tx) + h[i + g + 1] * tx;
    return top * (1 - tz) + bottom * tz;
  }

  /**
   * Geländehöhe an einer Stelle.
   * Zu den echten Daten kommen kleine Unebenheiten an den Berghängen (nicht im Tal),
   * und zum Rand hin flacht alles sanft ab.
   */
  heightAt(x: number, z: number): number {
    let h = this.rawHeight(x, z);
    const bumps = (valueNoise(x / 70, z / 70) - 0.5) * 7 + (valueNoise(x / 28, z / 28) - 0.5) * 3;
    h += bumps * smoothstep(620, 850, h);
    const edgeDist = Math.min(this.half - Math.abs(x), this.half - Math.abs(z));
    const fade = smoothstep(0, EDGE_FADE, edgeDist);
    return this.baseHeight + (h - this.baseHeight) * fade;
  }

  /** Steilheit (Höhenunterschied pro Meter). */
  slopeAt(x: number, z: number, d = 20): number {
    const gx = (this.heightAt(x + d, z) - this.heightAt(x - d, z)) / (2 * d);
    const gz = (this.heightAt(x, z + d) - this.heightAt(x, z - d)) / (2 * d);
    return Math.hypot(gx, gz);
  }

  isInside(x: number, z: number): boolean {
    return Math.abs(x) < this.half && Math.abs(z) < this.half;
  }
}

function decodeHeights(buf: ArrayBuffer, meta: TerrainMeta): Float32Array {
  if (meta.format !== 'int16-decimeter-delta') throw new Error(`Unbekanntes Höhenformat: ${meta.format}`);
  const g = meta.grid;
  const deltas = new Int16Array(buf);
  const dm = new Int32Array(deltas.length);
  for (let row = 0; row < g; row++) {
    for (let col = 0; col < g; col++) {
      const i = row * g + col;
      const prev = col > 0 ? dm[i - 1] : row > 0 ? dm[i - g] : 0;
      dm[i] = prev + deltas[i];
    }
  }
  const out = new Float32Array(dm.length);
  for (let i = 0; i < dm.length; i++) out[i] = dm[i] / 10;
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

const COLORS = {
  meadow: new THREE.Color('#86b85c'),
  meadowDark: new THREE.Color('#6fa04a'),
  forestFloor: new THREE.Color('#5c9444'),
  alpine: new THREE.Color('#a7b86e'),
  rock: new THREE.Color('#8f8b84'),
  snow: new THREE.Color('#f3f5f7'),
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
    const n = Math.round(terrain.meta.sizeMeters / CHUNK_SIZE);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        this.chunks.push({ x0: -terrain.half + i * CHUNK_SIZE, z0: -terrain.half + j * CHUNK_SIZE, level: -1 });
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

    out.copy(COLORS.meadow).lerp(COLORS.meadowDark, smoothstep(0.35, 0.75, patch));
    out.lerp(COLORS.forestFloor, smoothstep(650, 820, h));
    if (h > 1380) out.lerp(COLORS.alpine, smoothstep(1380, 1560, h));

    out.lerp(COLORS.rock, smoothstep(0.62, 0.95, slope + jitter * 0.002));
    if (h > 1680) out.lerp(COLORS.snow, smoothstep(1680, 1740, h) * (1 - smoothstep(0.6, 0.9, slope)));

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
