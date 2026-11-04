import * as THREE from 'three';
import { Terrain } from '../world/terrain';
import { PLANES, PlaneModel } from '../vehicles/plane';
import { seededRandom } from '../util/noise';

interface TrafficPlane {
  model: PlaneModel;
  center: THREE.Vector2;
  radius: number;
  altitude: number;
  speed: number;
  direction: 1 | -1; // 1 = gegen den Uhrzeigersinn (von oben gesehen)
  angle: number;
  bobPhase: number;
  position: THREE.Vector3;
}

const COLLISION_RADIUS = 14;
const WARNING_DISTANCE = 300;

/**
 * Andere Flugzeuge, die auf Kreisbahnen über die Gegend fliegen.
 * Ihre Flughöhe liegt immer über den Bergen auf ihrer Bahn.
 */
export class Traffic {
  readonly group = new THREE.Group();
  private planes: TrafficPlane[] = [];
  private tmpQ = new THREE.Quaternion();
  private tmpE = new THREE.Euler();
  private seg = new THREE.Vector3();
  private closest = new THREE.Vector3();

  constructor(terrain: Terrain, count = 10) {
    const rand = seededRandom(99);
    const limit = terrain.half - 2500;
    const models = PLANES.filter((p) => p.id !== 'blitz');

    for (let i = 0; i < count; i++) {
      // die ersten drei kreisen über Schleching und dem Startgebiet
      const center =
        i < 3
          ? new THREE.Vector2((rand() - 0.5) * 2000, 1500 + (rand() - 0.5) * 2000)
          : new THREE.Vector2((rand() - 0.5) * 2 * limit, (rand() - 0.5) * 2 * limit);
      const radius = 900 + rand() * 2200;

      let maxGround = 0;
      for (let k = 0; k < 48; k++) {
        const a = (k / 48) * Math.PI * 2;
        maxGround = Math.max(maxGround, terrain.heightAt(center.x + Math.cos(a) * radius, center.y + Math.sin(a) * radius));
      }

      const model = models[i % models.length].build();
      this.group.add(model.model);
      this.planes.push({
        model,
        center,
        radius,
        altitude: maxGround + 120 + rand() * 250,
        speed: 40 + rand() * 30,
        direction: rand() < 0.5 ? 1 : -1,
        angle: rand() * Math.PI * 2,
        bobPhase: rand() * Math.PI * 2,
        position: new THREE.Vector3(),
      });
    }
    this.update(0);
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  get visible() {
    return this.group.visible;
  }

  update(dt: number) {
    for (const p of this.planes) {
      p.angle += ((p.speed / p.radius) * p.direction) * dt;
      p.bobPhase += dt * 0.3;
      const x = p.center.x + Math.cos(p.angle) * p.radius;
      const z = p.center.y - Math.sin(p.angle) * p.radius;
      p.position.set(x, p.altitude + Math.sin(p.bobPhase) * 25, z);

      // Flugrichtung = Tangente an den Kreis; Schräglage passend zur Kurve
      const heading = p.angle + (p.direction === 1 ? 0 : Math.PI); // Drehung um die Hochachse
      const bank = Math.atan((p.speed * p.speed) / (9.81 * p.radius)) * p.direction;
      this.tmpE.set(0, heading, bank, 'YXZ');
      this.tmpQ.setFromEuler(this.tmpE);
      p.model.model.position.copy(p.position);
      p.model.model.quaternion.copy(this.tmpQ);
      if (p.model.propeller) p.model.propeller.rotation.z += dt * 50;
    }
  }

  /** true, wenn das Flugzeug auf dem Weg von `from` nach `to` ein anderes Flugzeug rammt. */
  collides(from: THREE.Vector3, to: THREE.Vector3): boolean {
    if (!this.visible) return false;
    this.seg.subVectors(to, from);
    const len2 = this.seg.lengthSq();
    for (const p of this.planes) {
      const t = len2 > 0 ? THREE.MathUtils.clamp(this.closest.subVectors(p.position, from).dot(this.seg) / len2, 0, 1) : 0;
      this.closest.copy(from).addScaledVector(this.seg, t);
      if (this.closest.distanceTo(p.position) < COLLISION_RADIUS) return true;
    }
    return false;
  }

  /** Das nächste andere Flugzeug, falls es näher als die Warn-Entfernung ist. */
  nearbyThreat(pos: THREE.Vector3): { position: THREE.Vector3; distance: number } | null {
    if (!this.visible) return null;
    let best: TrafficPlane | null = null;
    let bestD = WARNING_DISTANCE;
    for (const p of this.planes) {
      const d = p.position.distanceTo(pos);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best ? { position: best.position, distance: bestD } : null;
  }
}
