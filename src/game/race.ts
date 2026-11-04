import * as THREE from 'three';
import { Terrain } from '../world/terrain';

interface Ring {
  center: THREE.Vector3;
  normal: THREE.Vector3; // Durchflugrichtung
  mesh: THREE.Mesh;
}

export type RaceEvent = { type: 'start' } | { type: 'ring'; index: number } | { type: 'finish'; time: number };

const RING_COUNT = 16;
const RING_SPACING = 650;
const RING_RADIUS = 28;

/**
 * Ringrennen: Ein Kurs aus Ringen, der den Tälern folgt.
 * Die Zeit läuft ab dem ersten Ring und stoppt am letzten.
 * Es zählt immer nur der nächste Ring – wer einen verpasst, muss umdrehen.
 */
export class Race {
  readonly group = new THREE.Group();
  readonly rings: Ring[] = [];
  /** Startposition und -richtung (ein Stück vor dem ersten Ring) */
  readonly startPosition = new THREE.Vector3();
  startHeading = 0;

  nextIndex = 0;
  elapsed = 0;
  running = false;
  finished = false;

  private materials = {
    next: new THREE.MeshStandardMaterial({ color: '#ff8a1f', emissive: '#ff6a00', emissiveIntensity: 0.9, roughness: 0.4 }),
    start: new THREE.MeshStandardMaterial({ color: '#3ddc5a', emissive: '#16a333', emissiveIntensity: 0.9, roughness: 0.4 }),
    finish: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#bbbbbb', emissiveIntensity: 0.7, roughness: 0.4 }),
    upcoming: new THREE.MeshStandardMaterial({ color: '#ffd23a', emissive: '#a07000', emissiveIntensity: 0.5, roughness: 0.4, transparent: true, opacity: 0.55 }),
    done: new THREE.MeshStandardMaterial({ color: '#4fc3ff', transparent: true, opacity: 0.18, roughness: 0.4, depthWrite: false }),
  };
  private pulse = 0;
  private tmp = new THREE.Vector3();
  private hit = new THREE.Vector3();

  constructor(private terrain: Terrain) {
    const points = this.planCourse();
    const geo = new THREE.TorusGeometry(RING_RADIUS, 2.6, 10, 40);
    points.forEach((center, i) => {
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      const normal = new THREE.Vector3().subVectors(next, prev).normalize();
      const mesh = new THREE.Mesh(geo, this.materials.upcoming);
      mesh.position.copy(center);
      mesh.lookAt(this.tmp.copy(center).add(normal)); // Torus-Öffnung zeigt in Flugrichtung
      this.group.add(mesh);
      this.rings.push({ center, normal, mesh });
    });

    const first = this.rings[0];
    const dir = first.normal.clone().setY(0).normalize();
    this.startPosition.copy(first.center).addScaledVector(dir, -700);
    this.startPosition.y = Math.max(first.center.y + 20, terrain.heightAt(this.startPosition.x, this.startPosition.z) + 120);
    this.startHeading = Math.atan2(-dir.x, -dir.z);
    this.reset();
  }

  get total() {
    return this.rings.length;
  }

  get nextRing(): Ring | undefined {
    return this.rings[this.nextIndex];
  }

  reset() {
    this.nextIndex = 0;
    this.elapsed = 0;
    this.running = false;
    this.finished = false;
    this.updateMaterials();
  }

  /**
   * Plant den Kurs: Von Ring zu Ring wird die Richtung gewählt, in der das Gelände
   * am niedrigsten ist (also durch die Täler), ohne zu scharfe Kurven.
   */
  private planCourse(): THREE.Vector3[] {
    const t = this.terrain;
    const limit = t.half - 1800;
    const pts: THREE.Vector2[] = [new THREE.Vector2(0, 2000)];
    let dir = 0; // 0 = Norden
    const maxAlong = (a: THREE.Vector2, b: THREE.Vector2) => {
      let m = -Infinity;
      for (let k = 0; k <= 10; k++) m = Math.max(m, t.heightAt(a.x + ((b.x - a.x) * k) / 10, a.y + ((b.y - a.y) * k) / 10));
      return m;
    };

    for (let i = 1; i < RING_COUNT; i++) {
      const p = pts[i - 1];
      let best: { pt: THREE.Vector2; dir: number; cost: number } | null = null;
      for (const turnDeg of [-45, -30, -15, 0, 15, 30, 45]) {
        const d = dir + THREE.MathUtils.degToRad(turnDeg);
        const pt = new THREE.Vector2(p.x + Math.sin(d) * RING_SPACING, p.y - Math.cos(d) * RING_SPACING);
        if (Math.abs(pt.x) > limit || Math.abs(pt.y) > limit) continue;
        let cost = maxAlong(p, pt) + Math.abs(turnDeg) * 1.2;
        // nicht über den eigenen Kurs zurückfliegen
        for (const q of pts.slice(0, -1)) if (q.distanceTo(pt) < RING_SPACING * 0.9) cost += 2000;
        if (!best || cost < best.cost) best = { pt, dir: d, cost };
      }
      if (!best) break;
      pts.push(best.pt);
      dir = best.dir;
    }

    // Höhen: knapp über dem Gelände, und die Strecke zwischen zwei Ringen muss frei sein
    const ys = pts.map((p) => t.heightAt(p.x, p.y) + 55);
    for (let iter = 0; iter < 6; iter++) {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        for (let k = 1; k < 10; k++) {
          const f = k / 10;
          const ground = t.heightAt(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f) + 35;
          const line = ys[i] + (ys[i + 1] - ys[i]) * f;
          if (line < ground) {
            ys[i] += ground - line;
            ys[i + 1] += ground - line;
          }
        }
      }
      // nicht zu steil zwischen zwei Ringen
      for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] - RING_SPACING * 0.2);
      for (let i = ys.length - 2; i >= 0; i--) ys[i] = Math.max(ys[i], ys[i + 1] - RING_SPACING * 0.2);
    }
    return pts.map((p, i) => new THREE.Vector3(p.x, ys[i], p.y));
  }

  /** Prüft, ob das Flugzeug von `from` nach `to` durch den nächsten Ring geflogen ist. */
  update(dt: number, from: THREE.Vector3, to: THREE.Vector3): RaceEvent | null {
    this.pulse += dt;
    const s = 1 + Math.sin(this.pulse * 5) * 0.04;
    this.nextRing?.mesh.scale.setScalar(s);

    if (this.running) this.elapsed += dt;
    const ring = this.nextRing;
    if (!ring || this.finished) return null;

    const da = this.tmp.subVectors(from, ring.center).dot(ring.normal);
    const db = this.tmp.subVectors(to, ring.center).dot(ring.normal);
    if (!(da < 0 && db >= 0)) return null;
    const f = da / (da - db);
    this.hit.lerpVectors(from, to, f);
    if (this.hit.distanceTo(ring.center) > RING_RADIUS) return null;

    ring.mesh.scale.setScalar(1);
    this.nextIndex++;
    let event: RaceEvent;
    if (this.nextIndex === 1) {
      this.running = true;
      this.elapsed = 0;
      event = { type: 'start' };
    } else if (this.nextIndex === this.rings.length) {
      this.running = false;
      this.finished = true;
      event = { type: 'finish', time: this.elapsed };
    } else {
      event = { type: 'ring', index: this.nextIndex - 1 };
    }
    this.updateMaterials();
    return event;
  }

  private updateMaterials() {
    const last = this.rings.length - 1;
    this.rings.forEach((r, i) => {
      if (i < this.nextIndex) r.mesh.material = this.materials.done;
      else if (i === this.nextIndex) r.mesh.material = i === 0 ? this.materials.start : i === last ? this.materials.finish : this.materials.next;
      else r.mesh.material = i === last ? this.materials.finish : this.materials.upcoming;
    });
  }
}
