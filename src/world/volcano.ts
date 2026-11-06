import * as THREE from 'three';
import { Terrain } from './terrain';
import { highestNear } from './places';
import { drapeMaterial } from './mapfeatures';
import { seededRandom } from '../util/noise';

/** Hochplatte (aus OpenStreetMap) */
const PEAK = { x: 854, z: -3183 };
const STEP = 12; // Abstand der Punkte entlang eines Lavastroms (m)
const GRID = 60; // Zellgröße für die schnelle Suche nach Lava (m)
const CONE_RIM = 85;
const CONE_OUTER = 300;

interface Flow {
  pts: number[]; // x, z
  width: number[];
  /** Zeitpunkt (s), zu dem die Lava den Punkt erreicht */
  arrive: number[];
  mesh: THREE.Mesh;
  colors: THREE.BufferAttribute;
}

interface Puff {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  grow: number;
  hot: boolean;
}

interface Bomb {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  size: number;
  alive: boolean;
  trail: number;
}

export type VolcanoHazard = { kind: 'crash'; reason: string } | { kind: 'warn'; text: string } | null;

const LAVA_HOT = new THREE.Color('#ffe27a');
const LAVA_ORANGE = new THREE.Color('#ff6a1c');
const LAVA_RED = new THREE.Color('#8f1c0a');
const LAVA_CRUST = new THREE.Color('#2f2320');

/**
 * Die Hochplatte als ausbrechender Vulkan: Krater mit Lavasee, Lavaströme, die den
 * Hang hinunter ins Tal fließen, eine Aschesäule und Lavabomben.
 */
export class Volcano {
  readonly group = new THREE.Group();
  readonly crater: THREE.Vector3;
  /** Kamerawackeln (m), klingt von selbst ab */
  shake = 0;
  /** Ein großer Ausbruch hat gerade begonnen (zum Abspielen des Grollens) */
  onBlast: (distance: number) => void = () => {};

  private time = 0;
  private flowTime = 0;
  private nextBlast = 6;
  private flows: Flow[] = [];
  private grid = new Map<string, { flow: number; i: number }[]>();
  private puffs: Puff[] = [];
  private puffMesh: THREE.InstancedMesh;
  private trails: Puff[] = [];
  private trailMesh: THREE.InstancedMesh;
  private bombs: Bomb[] = [];
  private bombMesh: THREE.InstancedMesh;
  private lavaMaterial: THREE.MeshBasicMaterial;
  private lakeMaterial: THREE.MeshBasicMaterial;
  private glow: THREE.Sprite;
  private light: THREE.PointLight;
  private rand = seededRandom(1586);
  private ashTime = 0;
  private colorTimer = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(private terrain: Terrain) {
    this.crater = highestNear(terrain, PEAK.x, PEAK.z, 350, 10);
    this.group.visible = false;

    this.lavaMaterial = drapeMaterial(new THREE.MeshBasicMaterial({ vertexColors: true }), 0.6, 0.0014) as THREE.MeshBasicMaterial;
    this.lakeMaterial = new THREE.MeshBasicMaterial({ color: '#ffb23a' });
    this.buildCrater();
    this.traceFlows();

    // Lichtschein über dem Krater
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff8a3a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.glow.scale.setScalar(420);
    this.glow.position.copy(this.crater).y += 40;
    this.group.add(this.glow);
    // Das Licht bleibt immer in der Szene (sonst müssten alle Shader neu gebaut werden)
    this.light = new THREE.PointLight('#ff7a30', 0, 3500, 0);
    this.light.position.copy(this.crater).y += 120;

    // Aschesäule
    const puffGeo = new THREE.IcosahedronGeometry(1, 0);
    this.puffMesh = new THREE.InstancedMesh(puffGeo, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1 }), 170);
    this.puffMesh.frustumCulled = false;
    this.trailMesh = new THREE.InstancedMesh(puffGeo, new THREE.MeshStandardMaterial({ color: '#8a8480', flatShading: true, roughness: 1 }), 500);
    this.trailMesh.frustumCulled = false;
    this.bombMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#ff9a3c' }), 60);
    this.bombMesh.frustumCulled = false;
    for (let i = 0; i < 60; i++) this.bombs.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 4, alive: false, trail: 0 });
    for (const mesh of [this.puffMesh, this.trailMesh, this.bombMesh]) {
      mesh.count = 0;
      this.group.add(mesh);
    }
  }

  /** Muss zur Szene, auch wenn der Vulkan unsichtbar ist (siehe oben). */
  get lightObject() {
    return this.light;
  }

  set visible(on: boolean) {
    this.group.visible = on;
    this.light.intensity = on ? 2.2 : 0;
  }

  get visible() {
    return this.group.visible;
  }

  /** Lavaströme (für den Wald: dort stehen keine Bäume mehr) */
  isLava(x: number, z: number, margin = 6): boolean {
    for (const { flow, i } of this.near(x, z)) {
      const f = this.flows[flow];
      if (Math.hypot(f.pts[i * 2] - x, f.pts[i * 2 + 1] - z) < f.width[i] / 2 + margin) return true;
    }
    return false;
  }

  /** Neuer Ausbruch: die Lava ist schon ein Stück den Hang hinunter geflossen. */
  reset() {
    this.time = 0;
    this.flowTime = 70;
    this.nextBlast = 5;
    this.ashTime = 0;
    this.shake = 0;
    this.puffs.length = 0;
    this.trails.length = 0;
    for (const b of this.bombs) b.alive = false;
    // Säule vorab aufbauen, damit sie gleich zu sehen ist
    for (let k = 0; k < 300; k++) this.simulatePlume(0.1, 0.3);
    this.updateFlows(true);
  }

  /** Wie stark der Vulkan gerade ist (0,3 am Anfang, steigt in 4 Minuten auf 1) */
  get intensity() {
    return Math.min(1, 0.3 + this.time / 340);
  }

  /** Entfernung (waagerecht) zum Krater */
  distanceTo(p: THREE.Vector3) {
    return Math.hypot(p.x - this.crater.x, p.z - this.crater.z);
  }

  update(dt: number, player: THREE.Vector3) {
    this.time += dt;
    this.flowTime += dt;
    const intensity = this.intensity;

    // Große Ausbrüche in unregelmäßigen Abständen
    this.nextBlast -= dt;
    let blast = false;
    if (this.nextBlast <= 0) {
      blast = true;
      this.nextBlast = (9 + this.rand() * 9) / (0.6 + intensity * 0.6);
      const n = Math.round(5 + intensity * 9);
      for (let k = 0; k < n; k++) this.launchBomb(1.15);
      for (let k = 0; k < 18; k++) this.spawnPuff(1.4);
      const d = this.distanceTo(player);
      this.shake = Math.max(this.shake, THREE.MathUtils.clamp(1 - d / 9000, 0, 1) * 2.2);
      this.onBlast(d);
    }
    // Dazwischen einzelne Bomben
    if (this.rand() < dt * (0.25 + intensity * 1.1)) this.launchBomb(1);

    this.simulatePlume(dt, intensity);
    this.simulateBombs(dt);
    this.shake *= Math.exp(-dt * 1.6);

    // Flackern
    const flicker = 0.85 + Math.sin(this.time * 11) * 0.06 + Math.sin(this.time * 4.3) * 0.07 + (blast ? 0.3 : 0);
    this.light.intensity = (1.6 + intensity * 1.4) * flicker;
    this.lakeMaterial.color.copy(LAVA_HOT).lerp(LAVA_ORANGE, 0.5 - flicker * 0.3);
    (this.glow.material as THREE.SpriteMaterial).opacity = 0.55 + flicker * 0.3;
    this.lavaMaterial.color.setScalar(0.92 + flicker * 0.1);

    this.colorTimer -= dt;
    if (this.colorTimer <= 0) {
      this.colorTimer = 0.4;
      this.updateFlows(false);
    }
  }

  /**
   * Gefahr für das Fluggerät: Bombe, Asche, Lava, Krater.
   * agl = Höhe über Grund.
   */
  hazard(prev: THREE.Vector3, pos: THREE.Vector3, size: number, agl: number, dt: number): VolcanoHazard {
    // Lavabomben
    let nearest = Infinity;
    for (const b of this.bombs) {
      if (!b.alive) continue;
      const d = distToSegment(b.pos, prev, pos);
      if (d < b.size + size * 0.5 + 3) return { kind: 'crash', reason: 'Von einer Lavabombe getroffen!' };
      if (b.vel.y < 0 || d < 150) nearest = Math.min(nearest, d);
    }

    // Krater
    const dCrater = this.distanceTo(pos);
    if (dCrater < 95 && pos.y < this.crater.y + 60) return { kind: 'crash', reason: 'In den Krater gestürzt – heißer geht es nicht!' };

    // Lava am Boden
    if (agl < 25 && this.isRevealedLava(pos.x, pos.z)) return { kind: 'crash', reason: 'Zu tief über der Lava – sie ist über 1000 °C heiß!' };

    // Aschewolke
    let inAsh = false;
    for (const p of this.puffs) {
      const r = p.size * (0.4 + Math.min(1, p.age / 1.5) * 0.6) * 0.85;
      if (pos.distanceToSquared(p.pos) < r * r) {
        inAsh = true;
        break;
      }
    }
    this.ashTime = inAsh ? this.ashTime + dt : Math.max(0, this.ashTime - dt * 0.5);
    if (this.ashTime > 2.5) return { kind: 'crash', reason: 'Zu lange in der Aschewolke – der Motor ist voller Asche!' };
    if (inAsh) return { kind: 'warn', text: `⚠ Aschewolke! Raus hier – noch ${Math.max(0, 2.5 - this.ashTime).toFixed(1).replace(".", ",")} s` };
    if (nearest < 220) return { kind: 'warn', text: `⚠ Lavabombe in der Nähe – ${Math.round(nearest)} m` };
    if (dCrater < 260 && pos.y < this.crater.y + 250) return { kind: 'warn', text: '⚠ Direkt über dem Krater – sehr heiß!' };
    return null;
  }

  // ---------- Aufbau ----------

  /** Höhe des Kraterkegels (oder -Infinity außerhalb) */
  private coneHeight(x: number, z: number): number {
    const d = Math.hypot(x - this.crater.x, z - this.crater.z);
    if (d > CONE_OUTER) return -Infinity;
    const ground = this.terrain.heightAt(x, z);
    const f = Math.max(0, (d - CONE_RIM) / (CONE_OUTER - CONE_RIM));
    const rim = this.crater.y + 28;
    return Math.max(ground - 2, rim + (ground - 3 - rim) * Math.pow(f, 0.6));
  }

  /** Oberfläche für Lava: Gelände oder Kegel */
  private lavaGround(x: number, z: number) {
    return Math.max(this.terrain.heightAt(x, z), this.coneHeight(x, z));
  }

  private buildCrater() {
    const c = this.crater;
    // Kegel aus dunklem Gestein, oben offen; der Rand liegt auf dem Gelände auf
    const rings = 7;
    const seg = 22;
    const positions: number[] = [];
    const indices: number[] = [];
    const rand = seededRandom(42);
    for (let r = 0; r <= rings; r++) {
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const jitter = r === 0 || r === rings ? 1 : 1 + (rand() - 0.5) * 0.15;
        const rad = (CONE_RIM + ((CONE_OUTER - CONE_RIM) * r) / rings) * jitter;
        const x = c.x + Math.cos(a) * rad;
        const z = c.z + Math.sin(a) * rad;
        positions.push(x, this.coneHeight(x, z) + (r > 0 && r < rings ? (rand() - 0.5) * 6 : 0), z);
        if (r > 0) {
          const i0 = (r - 1) * seg + k;
          const i1 = (r - 1) * seg + ((k + 1) % seg);
          const j0 = r * seg + k;
          const j1 = r * seg + ((k + 1) % seg);
          indices.push(i0, i1, j0, i1, j1, j0);
        }
      }
    }
    // Innenwand des Kraters
    const inner = positions.length / 3;
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      positions.push(c.x + Math.cos(a) * (CONE_RIM - 6), c.y + 4, c.z + Math.sin(a) * (CONE_RIM - 6));
      indices.push(inner + k, inner + ((k + 1) % seg), k, inner + ((k + 1) % seg), (k + 1) % seg, k);
    }
    const cone = new THREE.BufferGeometry();
    cone.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    cone.setIndex(indices);
    const flat = cone.toNonIndexed();
    flat.computeVertexNormals();
    const rock = new THREE.MeshStandardMaterial({ color: '#3b302c', flatShading: true, roughness: 1, side: THREE.DoubleSide });
    this.group.add(new THREE.Mesh(flat, rock));

    // Lavasee im Krater
    const lake = new THREE.Mesh(new THREE.CircleGeometry(CONE_RIM - 4, 24).rotateX(-Math.PI / 2), this.lakeMaterial);
    lake.position.set(c.x, c.y + 10, c.z);
    this.group.add(lake);
  }

  /** Lavaströme: folgen vom Krater aus dem steilsten Gefälle ins Tal. */
  private traceFlows() {
    const t = this.terrain;
    const c = this.crater;
    const rand = seededRandom(7);
    const count = 6;
    for (let k = 0; k < count; k++) {
      const a0 = (k / count) * Math.PI * 2 + rand() * 0.6;
      let dx = Math.cos(a0);
      let dz = Math.sin(a0);
      let x = c.x + dx * (CONE_RIM - 5);
      let z = c.z + dz * (CONE_RIM - 5);
      let time = k * 14; // nicht alle gleichzeitig
      const pts: number[] = [];
      const width: number[] = [];
      const arrive: number[] = [];
      let flat = 0;
      for (let step = 0; step < 520; step++) {
        if (!t.isInside(x, z) || t.isWater(x, z)) break;
        pts.push(x, z);
        const w = Math.min(14 + step * 0.12, 46) + flat * 0.4;
        width.push(w);
        arrive.push(time);
        // Gefälle
        const e = 15;
        const gx = (t.heightAt(x + e, z) - t.heightAt(x - e, z)) / (2 * e);
        const gz = (t.heightAt(x, z + e) - t.heightAt(x, z - e)) / (2 * e);
        const g = Math.hypot(gx, gz);
        // Die ersten Meter gerade weg vom Krater, danach bergab
        const follow = step < 6 ? 0 : g < 0.03 ? 0.08 : 0.45;
        if (g > 0) {
          dx = dx * (1 - follow) - (gx / g) * follow;
          dz = dz * (1 - follow) - (gz / g) * follow;
        }
        const wobble = (rand() - 0.5) * 0.25;
        const ndx = dx - dz * wobble;
        const ndz = dz + dx * wobble;
        const len = Math.hypot(ndx, ndz) || 1;
        dx = ndx / len;
        dz = ndz / len;
        x += dx * STEP;
        z += dz * STEP;
        // steil = schnell
        time += STEP / (3 + Math.min(g, 1.2) * 14);
        if (g < 0.04) flat++;
        if (flat > 55) break; // im flachen Tal ausgelaufen
      }
      if (pts.length < 8) continue;
      this.addFlow(pts, width, arrive);
    }
  }

  private addFlow(pts: number[], width: number[], arrive: number[]) {
    const index = this.flows.length;
    const n = pts.length / 2;
    // Band: je Punkt zwei Ecken (links, rechts)
    const positions = new Float32Array(n * 6);
    const normals = new Float32Array(n * 6);
    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(n - 1, i + 1);
      let dx = pts[i1 * 2] - pts[i0 * 2];
      let dz = pts[i1 * 2 + 1] - pts[i0 * 2 + 1];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const half = width[i] / 2;
      const x = pts[i * 2];
      const z = pts[i * 2 + 1];
      const lx = x - dz * half;
      const lz = z + dx * half;
      const rx = x + dz * half;
      const rz = z - dx * half;
      positions.set([lx, this.lavaGround(lx, lz) + 1.2, lz, rx, this.lavaGround(rx, rz) + 1.2, rz], i * 6);
      normals[i * 6 + 1] = normals[i * 6 + 4] = 1;
      if (i > 0) {
        const p = (i - 1) * 2;
        const q = i * 2;
        indices.push(p, q, p + 1, p + 1, q, q + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    const colors = new THREE.BufferAttribute(new Float32Array(n * 6), 3);
    geo.setAttribute('color', colors);
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.lavaMaterial);
    mesh.renderOrder = 1;
    this.group.add(mesh);
    this.flows.push({ pts, width, arrive, mesh, colors });
    for (let i = 0; i < n; i++) {
      const key = `${Math.floor(pts[i * 2] / GRID)},${Math.floor(pts[i * 2 + 1] / GRID)}`;
      let list = this.grid.get(key);
      if (!list) this.grid.set(key, (list = []));
      list.push({ flow: index, i });
    }
  }

  /** Lavapunkte in der Umgebung */
  private near(x: number, z: number) {
    const out: { flow: number; i: number }[] = [];
    const gi = Math.floor(x / GRID);
    const gj = Math.floor(z / GRID);
    for (let j = gj - 1; j <= gj + 1; j++) for (let i = gi - 1; i <= gi + 1; i++) out.push(...(this.grid.get(`${i},${j}`) ?? []));
    return out;
  }

  private isRevealedLava(x: number, z: number) {
    for (const { flow, i } of this.near(x, z)) {
      const f = this.flows[flow];
      if (f.arrive[i] <= this.flowTime && Math.hypot(f.pts[i * 2] - x, f.pts[i * 2 + 1] - z) < f.width[i] / 2 + 4) return true;
    }
    return false;
  }

  /** Wie weit ist die Lava schon? Farbe je nach Alter: vorne hell, hinten abgekühlt. */
  private updateFlows(force: boolean) {
    for (const f of this.flows) {
      const n = f.pts.length / 2;
      let revealed = 0;
      while (revealed < n && f.arrive[revealed] <= this.flowTime) revealed++;
      f.mesh.geometry.setDrawRange(0, Math.max(0, revealed - 1) * 6);
      f.mesh.visible = revealed > 1;
      if (!f.mesh.visible && !force) continue;
      for (let i = 0; i < revealed; i++) {
        const age = this.flowTime - f.arrive[i];
        const c = this.c;
        if (age < 15) c.copy(LAVA_HOT).lerp(LAVA_ORANGE, age / 15);
        else if (age < 90) c.copy(LAVA_ORANGE).lerp(LAVA_RED, (age - 15) / 75);
        else c.copy(LAVA_RED).lerp(LAVA_CRUST, Math.min(1, (age - 90) / 240));
        // Glühende Risse in der Kruste
        if (age > 90 && hash(i * 13 + f.pts.length) > 0.7) c.lerp(LAVA_ORANGE, 0.45);
        f.colors.setXYZ(i * 2, c.r, c.g, c.b);
        f.colors.setXYZ(i * 2 + 1, c.r, c.g, c.b);
      }
      f.colors.needsUpdate = true;
    }
  }

  // ---------- Asche und Bomben ----------

  private spawnPuff(power = 1) {
    if (this.puffs.length >= this.puffMesh.instanceMatrix.count) this.puffs.shift();
    const r = this.rand;
    const a = r() * Math.PI * 2;
    const off = r() * 40;
    this.puffs.push({
      pos: new THREE.Vector3(this.crater.x + Math.cos(a) * off, this.crater.y + 20, this.crater.z + Math.sin(a) * off),
      vel: new THREE.Vector3((r() - 0.5) * 20, (70 + r() * 60) * power, (r() - 0.5) * 20),
      age: 0,
      life: 32 + r() * 14,
      size: 45 + r() * 35,
      grow: 7 + r() * 5,
      hot: true,
    });
  }

  private simulatePlume(dt: number, intensity: number) {
    if (this.rand() < dt * (3 + intensity * 3)) this.spawnPuff();
    const mesh = this.puffMesh;
    let n = 0;
    for (let k = this.puffs.length - 1; k >= 0; k--) {
      const p = this.puffs[k];
      p.age += dt;
      if (p.age > p.life) {
        this.puffs.splice(k, 1);
        continue;
      }
      const h = p.pos.y - this.crater.y;
      // Auftrieb lässt nach, oben treibt der Wind die Asche nach Osten
      p.vel.y *= Math.exp(-dt / 14);
      p.vel.x += (Math.min(h, 2500) / 2500) * 6 * dt - p.vel.x * 0.05 * dt;
      p.vel.z += (Math.min(h, 2500) / 2500) * -2 * dt - p.vel.z * 0.05 * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.size += p.grow * dt;
      const fade = Math.min(1, (p.life - p.age) / 6);
      const s = p.size * (0.4 + Math.min(1, p.age / 1.5) * 0.6) * fade;
      this.q.setFromEuler(new THREE.Euler(k * 0.7, k * 1.3 + p.age * 0.05, 0));
      this.m.compose(p.pos, this.q, this.s.set(s, s * 0.8, s));
      mesh.setMatrixAt(n, this.m);
      // erst glühend, dann dunkel, oben heller grau
      const c = this.c;
      if (p.age < 2.5) c.set('#ff7a2a').lerp(new THREE.Color('#3a302c'), p.age / 2.5);
      else c.set('#3a302c').lerp(new THREE.Color('#9a928c'), Math.min(1, h / 2200));
      mesh.setColorAt(n++, c);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    // Rauchspuren der Bomben
    const tm = this.trailMesh;
    let t = 0;
    for (let k = this.trails.length - 1; k >= 0; k--) {
      const p = this.trails[k];
      p.age += dt;
      if (p.age > p.life) {
        this.trails.splice(k, 1);
        continue;
      }
      p.pos.addScaledVector(p.vel, dt);
      const s = (p.size + p.age * p.grow) * Math.min(1, (p.life - p.age) / 1.5);
      this.m.compose(p.pos, this.q.identity(), this.s.setScalar(s));
      tm.setMatrixAt(t++, this.m);
    }
    tm.count = t;
    tm.instanceMatrix.needsUpdate = true;
  }

  private launchBomb(power: number) {
    const b = this.bombs.find((x) => !x.alive);
    if (!b) return;
    const r = this.rand;
    const a = r() * Math.PI * 2;
    const tilt = r() * 0.6 + 0.12; // vom Senkrechten weg
    const speed = (85 + r() * 80) * power;
    b.pos.copy(this.crater).y += 25;
    b.vel.set(Math.cos(a) * Math.sin(tilt) * speed, Math.cos(tilt) * speed, Math.sin(a) * Math.sin(tilt) * speed);
    b.size = 5 + r() * 5;
    b.alive = true;
    b.trail = 0;
  }

  private addTrail(pos: THREE.Vector3, size: number, life: number, vel?: THREE.Vector3) {
    if (this.trails.length >= this.trailMesh.instanceMatrix.count) this.trails.shift();
    this.trails.push({ pos: pos.clone(), vel: vel ?? new THREE.Vector3(0, 2, 0), age: 0, life, size, grow: size * 0.9, hot: false });
  }

  private simulateBombs(dt: number) {
    const mesh = this.bombMesh;
    let n = 0;
    for (const b of this.bombs) {
      if (!b.alive) continue;
      b.vel.y -= 9.81 * dt;
      b.vel.multiplyScalar(Math.exp(-dt * 0.02));
      b.pos.addScaledVector(b.vel, dt);
      b.trail -= dt;
      if (b.trail <= 0) {
        b.trail = 0.1;
        this.addTrail(b.pos, b.size * 0.7, 2.2);
      }
      const ground = this.terrain.surfaceAt(b.pos.x, b.pos.z);
      if (b.pos.y < ground || !this.terrain.isInside(b.pos.x, b.pos.z)) {
        b.alive = false;
        // Einschlag: Staub
        for (let k = 0; k < 6; k++) {
          const v = new THREE.Vector3((this.rand() - 0.5) * 14, 6 + this.rand() * 10, (this.rand() - 0.5) * 14);
          this.addTrail(new THREE.Vector3(b.pos.x, ground + 2, b.pos.z), b.size * 1.6, 4, v);
        }
        continue;
      }
      this.m.compose(b.pos, this.q.identity(), this.s.setScalar(b.size));
      mesh.setMatrixAt(n++, this.m);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }
}

function distToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a.x + abx * t - p.x, a.y + aby * t - p.y, a.z + abz * t - p.z);
}

function hash(n: number) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,220,150,1)');
  grad.addColorStop(0.3, 'rgba(255,130,50,0.6)');
  grad.addColorStop(1, 'rgba(255,80,20,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}
