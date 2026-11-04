import * as THREE from 'three';
import { PlaneStats } from '../vehicles/plane';

const G = 9.81;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export interface PlaneControls {
  throttle: number; // -1 weniger Gas, +1 mehr Gas
  pitch: number; // +1 Nase hoch
  roll: number; // +1 nach rechts kippen
  yaw: number; // +1 nach rechts drehen
  assist: boolean; // Flughilfe: richtet das Flugzeug von selbst wieder gerade aus
}

/**
 * Arcade-Flugphysik: fühlt sich nach Fliegen an, ist aber bewusst einfach.
 * - Gas erzeugt Schub, Luftwiderstand bremst.
 * - Steigen kostet Geschwindigkeit, Sinken bringt Geschwindigkeit.
 * - Zu langsam = Strömungsabriss: das Flugzeug sackt durch und die Nase fällt.
 * - Schräglage lässt das Flugzeug eine Kurve fliegen.
 */
export class PlanePhysics {
  position = new THREE.Vector3();
  quaternion = new THREE.Quaternion();
  speed = 0; // Fluggeschwindigkeit entlang der Nase (m/s)
  sinkSpeed = 0; // zusätzliches Durchsacken bei Strömungsabriss (m/s)
  throttle = 0.6; // 0..1
  stalled = false;

  private forward = new THREE.Vector3();
  private right = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();

  constructor(public stats: PlaneStats) {}

  reset(position: THREE.Vector3, headingRad: number, speed: number) {
    this.position.copy(position);
    this.quaternion.setFromAxisAngle(WORLD_UP, headingRad);
    this.speed = speed;
    this.sinkSpeed = 0;
    this.throttle = 0.6;
  }

  getForward(target: THREE.Vector3) {
    return target.set(0, 0, -1).applyQuaternion(this.quaternion);
  }

  /** Schräglage in rad: positiv = rechte Tragfläche zeigt nach unten. */
  get bank(): number {
    this.right.set(1, 0, 0).applyQuaternion(this.quaternion);
    return -Math.asin(THREE.MathUtils.clamp(this.right.y, -1, 1));
  }

  /** Nasenwinkel in rad: positiv = Nase zeigt nach oben. */
  get pitchAngle(): number {
    this.getForward(this.forward);
    return Math.asin(THREE.MathUtils.clamp(this.forward.y, -1, 1));
  }

  /** Kompassrichtung in Grad (0 = Norden, 90 = Osten). */
  get headingDeg(): number {
    this.getForward(this.forward);
    const deg = THREE.MathUtils.radToDeg(Math.atan2(this.forward.x, -this.forward.z));
    return (deg + 360) % 360;
  }

  update(dt: number, c: PlaneControls) {
    const s = this.stats;

    // --- Gas ---
    this.throttle = THREE.MathUtils.clamp(this.throttle + c.throttle * 0.5 * dt, 0, 1);

    // --- Geschwindigkeit ---
    this.getForward(this.forward);
    const dragK = s.thrust / (s.maxSpeed * s.maxSpeed);
    const accel = this.throttle * s.thrust - dragK * this.speed * this.speed - G * this.forward.y;
    this.speed = Math.max(0, this.speed + accel * dt);

    // --- Auftrieb / Strömungsabriss ---
    const lift = THREE.MathUtils.clamp((this.speed - s.stallSpeed * 0.6) / (s.stallSpeed * 0.4), 0, 1);
    this.stalled = lift < 1;
    if (this.stalled) this.sinkSpeed += G * (1 - lift) * dt;
    else this.sinkSpeed = Math.max(0, this.sinkSpeed - 15 * dt);

    // --- Drehen ---
    const effect = THREE.MathUtils.clamp(this.speed / s.stallSpeed, 0.25, 1); // Ruder wirken nur mit Fahrtwind
    let rollInput = c.roll * s.rollRate * effect;
    let pitchInput = c.pitch * s.pitchRate * effect;

    if (c.assist) {
      // Wenn nicht gesteuert wird, sanft zurück in die Waagerechte
      if (c.roll === 0) rollInput += -this.bank * 1.2;
      // Nicht weiter als 60° kippen
      if (Math.abs(this.bank) > 1.05 && Math.sign(c.roll) === Math.sign(this.bank)) rollInput = 0;
      if (c.pitch === 0 && !this.stalled) pitchInput += -this.pitchAngle * 0.5;
    }

    this.rotateLocal(1, 0, 0, pitchInput * dt);
    this.rotateLocal(0, 0, -1, rollInput * dt);
    this.rotateLocal(0, -1, 0, c.yaw * s.yawRate * effect * dt);

    // Schräglage -> Kurve (wie bei einer echten Kurve: g * tan(Schräglage) / v)
    const bank = THREE.MathUtils.clamp(this.bank, -1.3, 1.3);
    const turnRate = (G * Math.tan(bank)) / Math.max(this.speed, 15);
    this.tmpQ.setFromAxisAngle(WORLD_UP, -turnRate * dt);
    this.quaternion.premultiply(this.tmpQ);

    // Bei Strömungsabriss kippt die Nase nach unten
    if (this.stalled && this.pitchAngle > -1.2) this.rotateLocal(1, 0, 0, -(1 - lift) * 0.9 * dt);

    this.quaternion.normalize();

    // --- Bewegen ---
    this.getForward(this.forward);
    this.position.addScaledVector(this.forward, this.speed * dt);
    this.position.y -= this.sinkSpeed * dt;
  }

  private rotateLocal(x: number, y: number, z: number, angle: number) {
    if (angle === 0) return;
    this.tmpQ.setFromAxisAngle(this.tmpV.set(x, y, z), angle);
    this.quaternion.multiply(this.tmpQ);
  }
}
