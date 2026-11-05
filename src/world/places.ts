import * as THREE from 'three';
import { Terrain } from './terrain';

const M_PER_DEG_LAT = 111319.5;

/** Geokoordinaten -> Spielwelt (x = Osten, z = Süden, Mitte = Schleching). */
export function geoToWorld(terrain: Terrain, lat: number, lon: number) {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((terrain.meta.center.lat * Math.PI) / 180);
  return new THREE.Vector2((lon - terrain.meta.center.lon) * mPerDegLon, (terrain.meta.center.lat - lat) * M_PER_DEG_LAT);
}

export interface Summit {
  name: string;
  position: THREE.Vector3;
}

/** Ungefähre Koordinaten; der Gipfel wird auf den höchsten Punkt in der Nähe gesetzt. */
const SUMMIT_COORDS: [string, number, number][] = [
  ['Geigelstein', 47.7073, 12.3345],
  ['Kampenwand', 47.7547, 12.3484],
  ['Hochplatte', 47.7464, 12.3796],
  ['Hochgern', 47.738, 12.511],
];

/** Höchster Punkt im Umkreis. */
export function highestNear(terrain: Terrain, x: number, z: number, radius: number, step = 15): THREE.Vector3 {
  const best = new THREE.Vector3(x, terrain.heightAt(x, z), z);
  for (let dx = -radius; dx <= radius; dx += step) {
    for (let dz = -radius; dz <= radius; dz += step) {
      if (dx * dx + dz * dz > radius * radius) continue;
      const h = terrain.heightAt(x + dx, z + dz);
      if (h > best.y) best.set(x + dx, h, z + dz);
    }
  }
  return best;
}

export function findSummits(terrain: Terrain): Summit[] {
  return SUMMIT_COORDS.map(([name, lat, lon]) => {
    const p = geoToWorld(terrain, lat, lon);
    return { name, position: highestNear(terrain, p.x, p.y, 700) };
  }).filter((s) => terrain.isInside(s.position.x, s.position.z) && Math.max(Math.abs(s.position.x), Math.abs(s.position.z)) < terrain.half - 900);
}

/** Wie uneben ist ein Platz? (größter Höhenunterschied im Kreis, in m) */
export function unevenness(terrain: Terrain, x: number, z: number, radius: number): number {
  let min = Infinity;
  let max = -Infinity;
  for (let r = 0; r <= radius; r += radius / 2) {
    const n = r === 0 ? 1 : 8;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const h = terrain.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r);
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
  }
  return max - min;
}

/**
 * Sucht den ebensten Platz in einem Ringgebiet um (x, z).
 * `accept` kann Stellen ausschließen (z. B. zu tief gelegene).
 */
export function findFlatSpot(
  terrain: Terrain,
  x: number,
  z: number,
  minDist: number,
  maxDist: number,
  padRadius: number,
  accept: (p: THREE.Vector3) => boolean = () => true,
  step = 20,
): THREE.Vector3 {
  let best: THREE.Vector3 | null = null;
  let bestScore = Infinity;
  for (let dx = -maxDist; dx <= maxDist; dx += step) {
    for (let dz = -maxDist; dz <= maxDist; dz += step) {
      const d = Math.hypot(dx, dz);
      if (d < minDist || d > maxDist) continue;
      const p = new THREE.Vector3(x + dx, terrain.heightAt(x + dx, z + dz), z + dz);
      if (!accept(p)) continue;
      const score = unevenness(terrain, p.x, p.z, padRadius) + d * 0.002;
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
  }
  return best ?? new THREE.Vector3(x, terrain.heightAt(x, z), z);
}
