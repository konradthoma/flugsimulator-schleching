import * as THREE from 'three';
import { Terrain } from '../world/terrain';
import { seededRandom } from '../util/noise';

export interface Coin {
  position: THREE.Vector3;
  value: number; // Gold = 1, Blau = 5
  collected: boolean;
  /** Zeit seit dem Einsammeln (für die kleine "Plopp"-Animation) */
  popTime: number;
}

const GOLD_VALUE = 1;
const BLUE_VALUE = 5;
const COIN_RADIUS = 5;

/**
 * Münzen in der Landschaft:
 * - Goldene Münzen (1 Punkt) liegen in Reihen ("Münzpfade") über dem Gelände.
 * - Blaue Münzen (5 Punkte) liegen an schwierigen Stellen: dicht über Gipfeln und Graten.
 */
export class CoinField {
  readonly coins: Coin[] = [];
  readonly group = new THREE.Group();
  private gold: THREE.InstancedMesh;
  private blue: THREE.InstancedMesh;
  private goldCoins: Coin[] = [];
  private blueCoins: Coin[] = [];
  private spin = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private closest = new THREE.Vector3();
  private seg = new THREE.Vector3();

  constructor(private terrain: Terrain) {
    this.placeCoins();
    const geo = new THREE.CylinderGeometry(COIN_RADIUS, COIN_RADIUS, 0.9, 20).rotateX(Math.PI / 2);
    const goldMat = new THREE.MeshStandardMaterial({ color: '#ffcc33', metalness: 0.7, roughness: 0.3, emissive: '#7a5200', emissiveIntensity: 0.6 });
    const blueMat = new THREE.MeshStandardMaterial({ color: '#4fc3ff', metalness: 0.6, roughness: 0.3, emissive: '#0b4f8a', emissiveIntensity: 0.8 });
    this.gold = new THREE.InstancedMesh(geo, goldMat, this.goldCoins.length);
    this.blue = new THREE.InstancedMesh(geo, blueMat, this.blueCoins.length);
    this.gold.frustumCulled = this.blue.frustumCulled = false;
    this.group.add(this.gold, this.blue);
    this.updateMatrices(0);
  }

  get total() {
    return this.coins.length;
  }

  get remaining() {
    return this.coins.filter((c) => !c.collected).length;
  }

  reset() {
    for (const c of this.coins) {
      c.collected = false;
      c.popTime = 0;
    }
  }

  private placeCoins() {
    const t = this.terrain;
    const rand = seededRandom(2024);
    const limit = t.half - 1200;
    const inside = (x: number, z: number) => Math.abs(x) < limit && Math.abs(z) < limit;

    // Goldene Münzpfade: geschwungene Linien, die dem Gelände folgen
    for (let path = 0; path < 32; path++) {
      let x = (rand() - 0.5) * 2 * limit;
      let z = (rand() - 0.5) * 2 * limit;
      let dir = rand() * Math.PI * 2;
      const curve = (rand() - 0.5) * 0.25;
      const lift = 35 + rand() * 60;
      const count = 6 + Math.floor(rand() * 6);
      for (let i = 0; i < count && inside(x, z); i++) {
        const ground = t.heightAt(x, z);
        this.add(new THREE.Vector3(x, ground + lift, z), GOLD_VALUE);
        x += Math.sin(dir) * 70;
        z -= Math.cos(dir) * 70;
        dir += curve;
      }
    }

    // Ein Münzkreis rund um die Kirche von Schleching
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const x = Math.cos(a) * 250;
      const z = Math.sin(a) * 250;
      this.add(new THREE.Vector3(x, t.heightAt(x, z) + 60, z), GOLD_VALUE);
    }

    // Blaue Münzen dicht über hohen Punkten
    const highSpots: THREE.Vector3[] = [];
    for (let tries = 0; tries < 20000 && highSpots.length < 14; tries++) {
      const x = (rand() - 0.5) * 2 * limit;
      const z = (rand() - 0.5) * 2 * limit;
      const h = t.heightAt(x, z);
      if (h < 1350) continue;
      if (highSpots.some((p) => Math.hypot(p.x - x, p.z - z) < 1200)) continue;
      highSpots.push(new THREE.Vector3(x, h + 18, z));
    }
    for (const p of highSpots) this.add(p, BLUE_VALUE);
  }

  private add(position: THREE.Vector3, value: number) {
    const coin: Coin = { position, value, collected: false, popTime: 0 };
    this.coins.push(coin);
    (value === BLUE_VALUE ? this.blueCoins : this.goldCoins).push(coin);
  }

  /**
   * Prüft, ob das Flugzeug auf dem Weg von `from` nach `to` Münzen berührt hat.
   * (Strecke statt Punkt, damit auch schnelle Jets keine Münze "überspringen".)
   */
  collect(from: THREE.Vector3, to: THREE.Vector3, radius: number): Coin[] {
    const hits: Coin[] = [];
    this.seg.subVectors(to, from);
    const len2 = this.seg.lengthSq();
    for (const c of this.coins) {
      if (c.collected) continue;
      const tt = len2 > 0 ? THREE.MathUtils.clamp(this.closest.subVectors(c.position, from).dot(this.seg) / len2, 0, 1) : 0;
      this.closest.copy(from).addScaledVector(this.seg, tt);
      if (this.closest.distanceToSquared(c.position) < radius * radius) {
        c.collected = true;
        hits.push(c);
      }
    }
    return hits;
  }

  /** Die nächste noch nicht eingesammelte Münze. */
  nearest(pos: THREE.Vector3): Coin | undefined {
    let best: Coin | undefined;
    let bestD = Infinity;
    for (const c of this.coins) {
      if (c.collected) continue;
      const d = c.position.distanceToSquared(pos);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  update(dt: number) {
    this.spin += dt * 2.5;
    for (const c of this.coins) if (c.collected && c.popTime < 1) c.popTime += dt * 3;
    this.updateMatrices(dt);
  }

  private updateMatrices(_dt: number) {
    const write = (mesh: THREE.InstancedMesh, list: Coin[]) => {
      list.forEach((c, i) => {
        // eingesammelte Münzen werden kurz größer und verschwinden dann
        const scale = c.collected ? (c.popTime < 1 ? 1 + c.popTime * 1.5 : 0) : 1;
        this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.spin + i);
        this.s.setScalar(scale);
        this.m.compose(c.position, this.q, this.s);
        mesh.setMatrixAt(i, this.m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    write(this.gold, this.goldCoins);
    write(this.blue, this.blueCoins);
  }
}
