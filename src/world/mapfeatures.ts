import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Terrain } from './terrain';

/**
 * Material für Flächen, die auf dem Gelände liegen (Straßen, Flüsse, Seen).
 * Die Punkte werden im Shader ein Stück zur Kamera hin geschoben – je weiter weg,
 * desto mehr. So liegen sie immer sichtbar auf dem Gelände, auch wenn das
 * Geländegitter in der Ferne gröber ist. Auf dem Bildschirm ändert sich dabei nichts.
 */
export function drapeMaterial(material: THREE.Material, lift: number, perMeter: number) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      {
        float camDist = max(length(mvPosition.xyz), 1.0);
        mvPosition.xyz *= max(0.5, 1.0 - (${lift.toFixed(3)} + camDist * ${perMeter.toFixed(5)}) / camDist);
        gl_Position = projectionMatrix * mvPosition;
      }`,
    );
  };
  material.customProgramCacheKey = () => `drape-${lift}-${perMeter}`;
  return material;
}

/** Sammelt Bänder (Straßen, Flüsse) zu einer Geometrie. */
export class RibbonBuilder {
  private positions: number[] = [];
  private colors: number[] = [];
  private indices: number[] = [];

  constructor(
    private terrain: Terrain,
    private skip: (x: number, z: number) => boolean = () => false,
  ) {}

  get empty() {
    return this.indices.length === 0;
  }

  /** pts: [x0, z0, x1, z1, ...] (schon fein genug unterteilt) */
  add(pts: number[], width: number, color: THREE.Color, lift: number, skip = this.skip) {
    const n = pts.length / 2;
    if (n < 2) return;
    const t = this.terrain;
    const half = width / 2;
    let prevBase = -1;
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2];
      const z = pts[i * 2 + 1];
      // Richtung: Mittel aus vorigem und nächstem Abschnitt
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(n - 1, i + 1);
      let dx = pts[i1 * 2] - pts[i0 * 2];
      let dz = pts[i1 * 2 + 1] - pts[i0 * 2 + 1];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      if (skip(x, z)) {
        prevBase = -1;
        continue;
      }
      const base = this.positions.length / 3;
      const lx = x - dz * half;
      const lz = z + dx * half;
      const rx = x + dz * half;
      const rz = z - dx * half;
      this.positions.push(lx, t.heightAt(lx, lz) + lift, lz, rx, t.heightAt(rx, rz) + lift, rz);
      this.colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
      if (prevBase >= 0) this.indices.push(prevBase, base, prevBase + 1, prevBase + 1, base, base + 1);
      prevBase = base;
    }
  }

  build(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const count = this.positions.length / 3;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    const normals = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) normals[i * 3 + 1] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setIndex(this.indices);
    geo.computeBoundingSphere();
    return geo;
  }
}

/** Unterteilt eine Linie so, dass kein Abschnitt länger als maxStep ist. */
export function subdivide(pts: number[], maxStep: number): number[] {
  const out: number[] = [pts[0], pts[1]];
  for (let i = 2; i < pts.length; i += 2) {
    const x0 = pts[i - 2];
    const z0 = pts[i - 1];
    const x1 = pts[i];
    const z1 = pts[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / maxStep));
    for (let k = 1; k <= steps; k++) out.push(x0 + ((x1 - x0) * k) / steps, z0 + ((z1 - z0) * k) / steps);
  }
  return out;
}

/** Teilt eine (unterteilte) Linie in Stücke je Kachel auf. */
export function splitByTile(pts: number[], tileSize: number, visit: (key: string, piece: number[]) => void) {
  let piece: number[] = [];
  let currentKey = '';
  for (let i = 0; i + 2 < pts.length; i += 2) {
    const mx = (pts[i] + pts[i + 2]) / 2;
    const mz = (pts[i + 1] + pts[i + 3]) / 2;
    const key = `${Math.floor(mx / tileSize)},${Math.floor(mz / tileSize)}`;
    if (key !== currentKey) {
      if (piece.length >= 4) visit(currentKey, piece);
      piece = [pts[i], pts[i + 1]];
      currentKey = key;
    }
    piece.push(pts[i + 2], pts[i + 3]);
  }
  if (piece.length >= 4) visit(currentKey, piece);
}

export const ROAD_STYLE: { color: THREE.Color; lift: number }[] = [
  { color: new THREE.Color('#68696c'), lift: 0.5 }, // Autobahn
  { color: new THREE.Color('#737476'), lift: 0.45 }, // Bundesstraße
  { color: new THREE.Color('#7c7d7e'), lift: 0.4 }, // Landstraße
  { color: new THREE.Color('#8b8b88'), lift: 0.35 }, // Ortsstraße
  { color: new THREE.Color('#b5a98a'), lift: 0.3 }, // Feldweg
  { color: new THREE.Color('#6d6157'), lift: 0.55 }, // Bahn
];
export const RIVER_COLOR = new THREE.Color('#4f8ab0');
export const RIVER_LIFT = 0.2;

/** Ist die Linie wichtig genug, um sie im ganzen Gebiet zu zeigen? */
export const isMajorRoad = (k: number) => k <= 2 || k === 5;
export const isMajorRiver = (w: number) => w >= 8;

export const ribbonMaterial = () =>
  drapeMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), 0.15, 0.0012);

/**
 * Seen, große Flüsse und Hauptstraßen: werden einmal beim Start gebaut und sind
 * im ganzen Gebiet sichtbar. (Kleine Straßen und Bäche baut die Umgebung, siehe scenery.ts.)
 */
export function createMajorFeatures(terrain: Terrain, skip: (x: number, z: number) => boolean): THREE.Group {
  const group = new THREE.Group();
  const f = terrain.features;

  // --- Seen: ebene Wasserflächen auf Höhe des Wasserspiegels ---
  const lakeGeos: THREE.BufferGeometry[] = [];
  for (const lake of f.lakes) {
    const toV2 = (ring: number[]) => {
      const v: THREE.Vector2[] = [];
      for (let i = 0; i < ring.length - 2; i += 2) v.push(new THREE.Vector2(ring[i], -ring[i + 1]));
      return v;
    };
    const shape = new THREE.Shape(toV2(lake.rings[0]));
    for (const hole of lake.rings.slice(1)) shape.holes.push(new THREE.Path(toV2(hole)));
    const geo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, lake.level, 0);
    geo.deleteAttribute('uv');
    lakeGeos.push(geo);
  }
  if (lakeGeos.length) {
    const lakes = new THREE.Mesh(
      mergeGeometries(lakeGeos),
      drapeMaterial(new THREE.MeshStandardMaterial({ color: '#3f7fa8', roughness: 0.22, metalness: 0.1 }), 0.05, 0.0005),
    );
    lakes.name = 'lakes';
    group.add(lakes);
  }

  // --- Flüsse und Hauptstraßen, in große Kacheln aufgeteilt (für die Sichtbarkeitsprüfung) ---
  const TILE = 5000;
  const builders = new Map<string, RibbonBuilder>();
  const skipLines = (x: number, z: number) => skip(x, z) || !terrain.isInside(x, z);
  const builder = (key: string) => {
    let b = builders.get(key);
    if (!b) builders.set(key, (b = new RibbonBuilder(terrain, skipLines)));
    return b;
  };
  const skipRiver = (x: number, z: number) => skipLines(x, z) || terrain.isLake(x, z);
  for (const r of f.rivers) {
    if (!isMajorRiver(r.w)) continue;
    splitByTile(subdivide(r.pts, 10), TILE, (key, piece) => builder(key).add(piece, r.w, RIVER_COLOR, RIVER_LIFT, skipRiver));
  }
  for (const r of f.roads) {
    if (!isMajorRoad(r.k)) continue;
    const style = ROAD_STYLE[r.k];
    splitByTile(subdivide(r.pts, 10), TILE, (key, piece) => builder(key).add(piece, r.w, style.color, style.lift));
  }
  const material = ribbonMaterial();
  for (const b of builders.values()) if (!b.empty) group.add(new THREE.Mesh(b.build(), material));
  return group;
}
