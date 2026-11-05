import * as THREE from 'three';
import { PlaneStats } from '../vehicles/plane';
import { GroundFn, VehicleControls, VehiclePhysics } from '../vehicles/vehicle';

const G = 9.81;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
/** Höhe der Räder unter dem Rumpf */
const GEAR = 1.4;

/** @deprecated alter Name */
export type PlaneControls = VehicleControls;

/**
 * Arcade-Flugphysik: fühlt sich nach Fliegen an, ist aber bewusst einfach.
 * - Gas erzeugt Schub, Luftwiderstand bremst.
 * - Steigen kostet Geschwindigkeit, Sinken bringt Geschwindigkeit.
 * - Zu langsam = Strömungsabriss: das Flugzeug sackt durch und die Nase fällt.
 * - Schräglage lässt das Flugzeug eine Kurve fliegen.
 * - Landen geht auf flachem Boden: langsam sinken, Flügel waagerecht, Nase nicht nach unten.
 */
export class PlanePhysics implements VehiclePhysics {
  readonly kind = 'plane';
  position = new THREE.Vector3();
  quaternion = new THREE.Quaternion();
  speed = 0; // Fluggeschwindigkeit entlang der Nase (m/s)
  sinkSpeed = 0; // zusätzliches Durchsacken bei Strömungsabriss (m/s)
  verticalSpeed = 0;
  throttle = 0.6; // 0..1
  stalled = false;
  onGround = false;

  private forward = new THREE.Vector3();
  private right = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();

  constructor(public stats: PlaneStats) {}

  reset(position: THREE.Vector3, headingRad: number, speed: number, onGround = false) {
    this.position.copy(position);
    this.quaternion.setFromAxisAngle(WORLD_UP, headingRad);
    this.speed = speed;
    this.sinkSpeed = 0;
    this.verticalSpeed = 0;
    this.throttle = onGround ? 0 : 0.6;
    this.onGround = onGround;
    this.stalled = false;
  }

  getForward(target: THREE.Vector3) {
    return target.set(0, 0, -1).applyQuaternion(this.quaternion);
  }

  getCameraForward(target: THREE.Vector3) {
    return this.getForward(target);
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

  private get headingRad(): number {
    this.getForward(this.forward);
    return Math.atan2(-this.forward.x, -this.forward.z);
  }

  /** Flügel waagerecht stellen, Nase auf den gegebenen Winkel. */
  private level(pitch: number) {
    const heading = this.headingRad;
    this.quaternion.setFromAxisAngle(WORLD_UP, heading);
    this.rotateLocal(1, 0, 0, pitch);
  }

  update(dt: number, c: VehicleControls, ground: GroundFn, slope: GroundFn): string | null {
    const s = this.stats;

    // --- Gas ---
    this.throttle = THREE.MathUtils.clamp(this.throttle + c.throttle * 0.5 * dt, 0, 1);

    // --- Geschwindigkeit ---
    this.getForward(this.forward);
    const dragK = s.thrust / (s.maxSpeed * s.maxSpeed);
    let accel = this.throttle * s.thrust - dragK * this.speed * this.speed - G * this.forward.y;
    if (this.onGround) accel -= 0.6 + Math.max(0, 0.3 - this.throttle) * 25; // Rollwiderstand, bei wenig Gas bremsen
    this.speed = Math.max(0, this.speed + accel * dt);

    // --- Auftrieb / Strömungsabriss ---
    const lift = THREE.MathUtils.clamp((this.speed - s.stallSpeed * 0.6) / (s.stallSpeed * 0.4), 0, 1);
    this.stalled = !this.onGround && lift < 1;
    if (this.onGround) this.sinkSpeed = 0;
    else if (this.stalled) this.sinkSpeed += G * (1 - lift) * dt;
    else this.sinkSpeed = Math.max(0, this.sinkSpeed - 15 * dt);

    const effect = THREE.MathUtils.clamp(this.speed / s.stallSpeed, 0.25, 1); // Ruder wirken nur mit Fahrtwind

    if (this.onGround) {
      // --- Rollen am Boden: lenken mit dem Bugrad, Nase hoch erst ab Abhebegeschwindigkeit ---
      const steer = THREE.MathUtils.clamp(c.yaw + c.roll, -1, 1) * 0.7 * THREE.MathUtils.clamp(this.speed / 8, 0.2, 1);
      this.tmpQ.setFromAxisAngle(WORLD_UP, -steer * dt);
      this.quaternion.premultiply(this.tmpQ);
      let pitch = this.pitchAngle;
      if (this.speed > s.stallSpeed * 0.85) pitch += Math.max(0, c.pitch) * s.pitchRate * 0.6 * dt;
      pitch -= 0.3 * dt; // Nase senkt sich von selbst
      this.level(THREE.MathUtils.clamp(pitch, 0, 0.3));
    } else {
      // --- Drehen in der Luft ---
      let rollInput = c.roll * s.rollRate * effect;
      let pitchInput = c.pitch * s.pitchRate * effect;

      if (c.assist) {
        // Wenn nicht gesteuert wird, sanft zurück in die Waagerechte
        if (c.roll === 0) rollInput += -this.bank * 1.2;
        // Nicht weiter als 60° kippen
        if (Math.abs(this.bank) > 1.05 && Math.sign(c.roll) === Math.sign(this.bank)) rollInput = 0;
        // wenig Gas = sanfter Sinkflug (zum Landen), sonst geradeaus
        const target = this.throttle < 0.3 ? -0.06 : 0;
        if (c.pitch === 0 && !this.stalled) pitchInput += (target - this.pitchAngle) * 0.5;
      }

      this.rotateLocal(1, 0, 0, pitchInput * dt);
      this.rotateLocal(0, 0, -1, rollInput * dt);
      this.rotateLocal(0, -1, 0, c.yaw * s.yawRate * effect * dt);

      // Schräglage -> Kurve (wie bei einer echten Kurve: g * tan(Schräglage) / v)
      const bank = THREE.MathUtils.clamp(this.bank, -1.3, 1.3);
      // (Geschwindigkeit nach oben begrenzt, damit auch schnelle Jets im kleinen Gebiet wenden können)
      const turnRate = (G * Math.tan(bank)) / THREE.MathUtils.clamp(this.speed, 15, 70);
      this.tmpQ.setFromAxisAngle(WORLD_UP, -turnRate * dt);
      this.quaternion.premultiply(this.tmpQ);

      // Bei Strömungsabriss kippt die Nase nach unten
      if (this.stalled && this.pitchAngle > -1.2) this.rotateLocal(1, 0, 0, -(1 - lift) * 0.9 * dt);
    }
    this.quaternion.normalize();

    // --- Bewegen ---
    this.getForward(this.forward);
    this.verticalSpeed = this.forward.y * this.speed - this.sinkSpeed;
    this.position.addScaledVector(this.forward, this.speed * dt);
    this.position.y -= this.sinkSpeed * dt;

    // --- Boden ---
    const floor = ground(this.position.x, this.position.z) + GEAR;
    if (this.onGround) {
      if (lift >= 1 && this.pitchAngle > 0.05 && this.position.y >= floor) {
        this.onGround = false; // abgehoben
      } else {
        this.position.y = floor;
        if (this.speed > 12 && slope(this.position.x, this.position.z) > 0.35) return 'In den Hang gerollt!';
      }
    } else if (this.position.y <= floor) {
      const steep = slope(this.position.x, this.position.z) > 0.2;
      if (steep) return 'Abgestürzt!';
      if (Math.abs(this.bank) > 0.3) return 'Mit der Tragfläche den Boden gestreift!';
      if (this.pitchAngle < -0.2) return 'Mit der Nase voraus aufgeschlagen!';
      if (this.verticalSpeed < -5.5) return 'Zu hart aufgesetzt!';
      this.onGround = true;
      this.position.y = floor;
      this.sinkSpeed = 0;
      this.level(THREE.MathUtils.clamp(this.pitchAngle, 0, 0.3));
    }
    return null;
  }

  private rotateLocal(x: number, y: number, z: number, angle: number) {
    if (angle === 0) return;
    this.tmpQ.setFromAxisAngle(this.tmpV.set(x, y, z), angle);
    this.quaternion.multiply(this.tmpQ);
  }
}
