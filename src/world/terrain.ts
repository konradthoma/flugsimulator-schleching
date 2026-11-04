import * as THREE from 'three';
import { hash2, smoothstep } from '../util/noise';

export interface TerrainMeta {
  name: string;
  center: { lat: number; lon: number };
  sizeMeters: number;
  grid: number;
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
    const [meta, buf] = await Promise.all([
      fetch(`${import.meta.env.BASE_URL}terrain/${name}.json`).then((r) => r.json() as Promise<TerrainMeta>),
      fetch(`${import.meta.env.BASE_URL}terrain/${name}.bin`).then((r) => r.arrayBuffer()),
    ]);
    return new Terrain(new Float32Array(buf), meta);
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

  /** Geländehöhe an einer Stelle (zum Rand hin sanft abgeflacht). */
  heightAt(x: number, z: number): number {
    const edgeDist = Math.min(this.half - Math.abs(x), this.half - Math.abs(z));
    const fade = smoothstep(0, EDGE_FADE, edgeDist);
    return this.baseHeight + (this.rawHeight(x, z) - this.baseHeight) * fade;
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

  buildMesh(resolution = 512): THREE.Group {
    const n = resolution;
    const size = this.meta.sizeMeters;
    const step = size / (n - 1);
    const positions = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);

    const meadow = new THREE.Color('#86b85c');
    const forestFloor = new THREE.Color('#5c9444');
    const alpine = new THREE.Color('#a7b86e');
    const rock = new THREE.Color('#8f8b84');
    const snow = new THREE.Color('#f3f5f7');
    const c = new THREE.Color();

    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const x = -this.half + col * step;
        const z = -this.half + row * step;
        const y = this.heightAt(x, z);
        const i = (row * n + col) * 3;
        positions[i] = x;
        positions[i + 1] = y;
        positions[i + 2] = z;

        const slope = this.slopeAt(x, z, step);
        const jitter = (hash2(col, row) - 0.5) * 60; // macht die Farbgrenzen etwas unruhiger
        const h = y + jitter;

        if (h < 800) c.copy(meadow).lerp(forestFloor, smoothstep(650, 800, h));
        else if (h < 1400) c.copy(forestFloor);
        else c.copy(forestFloor).lerp(alpine, smoothstep(1400, 1550, h));

        c.lerp(rock, smoothstep(0.65, 1.0, slope + jitter * 0.002));
        if (h > 1680) c.lerp(snow, smoothstep(1680, 1740, h) * (1 - smoothstep(0.6, 0.9, slope)));

        const shade = 0.94 + hash2(row, col) * 0.12;
        colors[i] = c.r * shade;
        colors[i + 1] = c.g * shade;
        colors[i + 2] = c.b * shade;
      }
    }

    const indices = new Uint32Array((n - 1) * (n - 1) * 6);
    let k = 0;
    for (let row = 0; row < n - 1; row++) {
      for (let col = 0; col < n - 1; col++) {
        const a = row * n + col;
        const b = a + 1;
        const d = a + n;
        const e = d + 1;
        indices[k++] = a;
        indices[k++] = d;
        indices[k++] = b;
        indices[k++] = b;
        indices[k++] = d;
        indices[k++] = e;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 });
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geo, mat));

    // Flachland außerhalb des Gebiets, damit die Welt nicht im Nichts endet
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200000, 200000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: meadow, roughness: 1 }),
    );
    ground.position.y = this.baseHeight - 0.5;
    group.add(ground);
    return group;
  }
}
