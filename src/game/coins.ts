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

/** Eine Gruppe zusammengehöriger Münzen (z. B. eine Reihe) mit einer Lichtsäule darüber. */
interface CoinGroup {
  coins: Coin[];
  beacon: THREE.Vector3;
  blue: boolean;
}

const GOLD_VALUE = 1;
const BLUE_VALUE = 5;
const COIN_RADIUS = 12;
const BEACON_HEIGHT = 900;

/**
 * Münzen in der Landschaft:
 * - Goldene Münzen (1 Punkt) liegen in langen Reihen ("Münzpfade") über dem Gelände.
 * - Blaue Münzen (5 Punkte) liegen an schwierigen Stellen: dicht über Gipfeln und Graten.
 * Über jeder Gruppe steht eine leuchtende Lichtsäule, die man von Weitem sieht.
 */
export class CoinField {
  readonly coins: Coin[] = [];
  readonly group = new THREE.Group();
  private groups: CoinGroup[] = [];
  private gold: THREE.InstancedMesh;
  private blue: THREE.InstancedMesh;
  private goldBeacons: THREE.InstancedMesh;
  private blueBeacons: THREE.InstancedMesh;
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

    const geo = new THREE.CylinderGeometry(COIN_RADIUS, COIN_RADIUS, 1.6, 24).rotateX(Math.PI / 2);
    const goldMat = new THREE.MeshStandardMaterial({ color: '#ffd23a', metalness: 0.5, roughness: 0.35, emissive: '#c88a00', emissiveIntensity: 0.9 });
    const blueMat = new THREE.MeshStandardMaterial({ color: '#5fd0ff', metalness: 0.5, roughness: 0.35, emissive: '#1a78c8', emissiveIntensity: 1.0 });
    this.gold = new THREE.InstancedMesh(geo, goldMat, this.goldCoins.length);
    this.blue = new THREE.InstancedMesh(geo, blueMat, this.blueCoins.length);

    // Lichtsäulen: leuchten durch den Nebel, damit man sie aus der Ferne sieht
    const beaconGeo = new THREE.CylinderGeometry(6, 10, BEACON_HEIGHT, 10, 1, true).translate(0, BEACON_HEIGHT / 2, 0);
    const beaconMat = (color: string) =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
    const goldGroups = this.groups.filter((g) => !g.blue).length;
    this.goldBeacons = new THREE.InstancedMesh(beaconGeo, beaconMat('#ffc23a'), goldGroups);
    this.blueBeacons = new THREE.InstancedMesh(beaconGeo, beaconMat('#4fb8ff'), this.groups.length - goldGroups);

    for (const mesh of [this.gold, this.blue, this.goldBeacons, this.blueBeacons]) mesh.frustumCulled = false;
    this.group.add(this.gold, this.blue, this.goldBeacons, this.blueBeacons);
    this.updateMatrices();
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

    // Goldene Münzpfade: lange, geschwungene Linien, die dem Gelände folgen
    for (let path = 0; path < 26; path++) {
      let x = (rand() - 0.5) * 2 * limit;
      let z = (rand() - 0.5) * 2 * limit;
      let dir = rand() * Math.PI * 2;
      const curve = (rand() - 0.5) * 0.12;
      const lift = 40 + rand() * 50;
      const count = 14 + Math.floor(rand() * 11);
      const coins: Coin[] = [];
      for (let i = 0; i < count && inside(x, z); i++) {
        coins.push(this.makeCoin(new THREE.Vector3(x, t.heightAt(x, z) + lift, z), GOLD_VALUE));
        x += Math.sin(dir) * 55;
        z -= Math.cos(dir) * 55;
        dir += curve;
      }
      if (coins.length >= 5) this.addGroup(coins, false);
    }

    // Ein Münzkreis rund um die Kirche von Schleching
    const ring: Coin[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const x = Math.cos(a) * 280;
      const z = Math.sin(a) * 280;
      ring.push(this.makeCoin(new THREE.Vector3(x, t.heightAt(x, z) + 70, z), GOLD_VALUE));
    }
    this.addGroup(ring, false, new THREE.Vector3(0, t.heightAt(0, 0) + 70, 0));

    // Blaue Münzen dicht über hohen Punkten, je drei übereinander
    const highSpots: THREE.Vector3[] = [];
    for (let tries = 0; tries < 20000 && highSpots.length < 14; tries++) {
      const x = (rand() - 0.5) * 2 * limit;
      const z = (rand() - 0.5) * 2 * limit;
      const h = t.heightAt(x, z);
      if (h < 1350) continue;
      if (highSpots.some((p) => Math.hypot(p.x - x, p.z - z) < 1200)) continue;
      highSpots.push(new THREE.Vector3(x, h + 25, z));
    }
    for (const p of highSpots) {
      const stack = [0, 1, 2].map((k) => this.makeCoin(p.clone().setY(p.y + k * 30), BLUE_VALUE));
      this.addGroup(stack, true);
    }
  }

  private makeCoin(position: THREE.Vector3, value: number): Coin {
    const coin: Coin = { position, value, collected: false, popTime: 0 };
    this.coins.push(coin);
    (value === BLUE_VALUE ? this.blueCoins : this.goldCoins).push(coin);
    return coin;
  }

  private addGroup(coins: Coin[], blue: boolean, beacon?: THREE.Vector3) {
    this.groups.push({ coins, blue, beacon: beacon ?? coins[0].position.clone() });
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
    this.updateMatrices();
  }

  private updateMatrices() {
    const writeCoins = (mesh: THREE.InstancedMesh, list: Coin[]) => {
      list.forEach((c, i) => {
        // eingesammelte Münzen werden kurz größer und verschwinden dann
        const scale = c.collected ? (c.popTime < 1 ? 1 + c.popTime * 1.5 : 0) : 1;
        this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.spin + i * 0.3);
        this.s.setScalar(scale);
        this.m.compose(c.position, this.q, this.s);
        mesh.setMatrixAt(i, this.m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    writeCoins(this.gold, this.goldCoins);
    writeCoins(this.blue, this.blueCoins);

    // Lichtsäule ausblenden, sobald die ganze Gruppe eingesammelt ist
    const pulse = 1 + Math.sin(this.spin * 1.5) * 0.15;
    const counters = { gold: 0, blue: 0 };
    this.q.identity();
    for (const g of this.groups) {
      const done = g.coins.every((c) => c.collected);
      this.s.set(done ? 0 : pulse, done ? 0 : 1, done ? 0 : pulse);
      this.m.compose(g.beacon, this.q, this.s);
      if (g.blue) this.blueBeacons.setMatrixAt(counters.blue++, this.m);
      else this.goldBeacons.setMatrixAt(counters.gold++, this.m);
    }
    this.goldBeacons.instanceMatrix.needsUpdate = true;
    this.blueBeacons.instanceMatrix.needsUpdate = true;
  }
}
