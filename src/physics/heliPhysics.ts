import * as THREE from 'three';
import { HeliStats } from '../vehicles/heli';
import { GroundFn, VehicleControls, VehiclePhysics } from '../vehicles/vehicle';

const G = 9.81;
const UP = new THREE.Vector3(0, 1, 0);
/** Höhe der Kufen unter der Mitte */
const SKIDS = 1.25;

/**
 * Hubschrauber-Physik (Arcade):
 * - Der Rotor ("Steigen") bestimmt, ob er steigt, schwebt oder sinkt. Mitte = schweben.
 * - Nach vorne neigen = vorwärts fliegen, nach hinten = rückwärts/bremsen.
 * - Links/rechts dreht ihn auf der Stelle, das Seitenruder schiebt ihn seitwärts.
 * - Mit Flughilfe bremst er von selbst ab und bleibt in der Luft stehen.
 * - Landen: langsam sinken, kaum Vorwärtsfahrt, nicht am Steilhang.
 */
export class HeliPhysics implements VehiclePhysics {
  readonly kind = 'heli';
  position = new THREE.Vector3();
  quaternion = new THREE.Quaternion();
  velocity = new THREE.Vector3();
  throttle = 0.5;
  stalled = false;
  onGround = false;
  /** Rotor kehrt ohne Eingabe zur Mitte zurück (Tastatur mit Flughilfe) */
  autoCenter = true;

  private yaw = 0;
  private tiltF = 0; // + = Nase runter (vorwärts)
  private tiltS = 0; // + = nach rechts geneigt
  private turnLean = 0;
  private yawRate = 0;
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();

  constructor(public stats: HeliStats) {}

  get speed() {
    return this.velocity.length();
  }

  get verticalSpeed() {
    return this.velocity.y;
  }

  get headingDeg() {
    const deg = THREE.MathUtils.radToDeg(-this.yaw);
    return ((deg % 360) + 360) % 360;
  }

  reset(position: THREE.Vector3, headingRad: number, speed: number, onGround = false) {
    this.position.copy(position);
    this.yaw = headingRad;
    this.tiltF = this.tiltS = this.turnLean = this.yawRate = 0;
    this.horizontalAxes();
    this.velocity.copy(this.fwd).multiplyScalar(speed);
    this.throttle = onGround ? 0.3 : 0.5;
    this.onGround = onGround;
    this.updateQuaternion();
  }

  getForward(target: THREE.Vector3) {
    return target.set(0, 0, -1).applyQuaternion(this.quaternion);
  }

  getCameraForward(target: THREE.Vector3) {
    return target.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  private horizontalAxes() {
    this.fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  update(dt: number, c: VehicleControls, ground: GroundFn, slope: GroundFn): string | null {
    const s = this.stats;

    // --- Rotor (Steigen/Sinken) ---
    this.throttle = THREE.MathUtils.clamp(this.throttle + c.throttle * 0.6 * dt, 0, 1);
    if (c.assist && this.autoCenter && c.throttle === 0 && !this.onGround) {
      this.throttle += (0.5 - this.throttle) * Math.min(1, dt * 2.5);
    }
    const lift = (this.throttle - 0.5) * 2;
    let targetVy = lift * (lift > 0 ? s.climbRate : s.descentRate);
    if (!c.assist) {
      // ohne Hilfe kostet Neigen Auftrieb: wer schnell vorwärts will, muss mehr Rotor geben
      const tiltLoss = 1 / Math.max(0.5, Math.cos(this.tiltF) * Math.cos(this.tiltS)) - 1;
      targetVy -= tiltLoss * G * 2.5;
    } else {
      // Flughilfe: kurz über dem Boden automatisch sanft abbremsen
      const agl = this.position.y - ground(this.position.x, this.position.z) - SKIDS;
      targetVy = Math.max(targetVy, -(1.8 + Math.max(0, agl) * 0.3));
    }
    this.velocity.y += (targetVy - this.velocity.y) * Math.min(1, dt * (c.assist ? 2.5 : 1.8));

    // --- Drehen ---
    // mit Hilfe dreht er sofort, ohne Hilfe mit etwas Schwung (dreht nach)
    const targetYawRate = c.roll * s.yawRate;
    this.yawRate += (targetYawRate - this.yawRate) * Math.min(1, dt * (c.assist ? 10 : 3));
    this.yaw -= this.yawRate * dt;
    this.horizontalAxes();

    // --- Neigen ---
    let vF = this.velocity.dot(this.fwd);
    let vS = this.velocity.dot(this.right);
    const maxT = s.maxTilt;
    if (c.assist) {
      const targetF = c.pitch !== 0 ? -c.pitch * maxT : THREE.MathUtils.clamp((-vF / s.maxSpeed) * maxT * 4, -maxT, maxT);
      const targetS = c.yaw !== 0 ? c.yaw * maxT * 0.7 : THREE.MathUtils.clamp((-vS / s.maxSpeed) * maxT * 6, -maxT, maxT);
      this.tiltF += (targetF - this.tiltF) * Math.min(1, dt * 5);
      this.tiltS += (targetS - this.tiltS) * Math.min(1, dt * 5);
    } else {
      // ohne Hilfe bleibt die Neigung, bis man gegensteuert
      this.tiltF = THREE.MathUtils.clamp(this.tiltF - c.pitch * 1.6 * dt, -maxT * 1.4, maxT * 1.4);
      this.tiltS = THREE.MathUtils.clamp(this.tiltS + c.yaw * 1.6 * dt, -maxT * 1.2, maxT * 1.2);
    }
    if (this.onGround) {
      this.tiltF *= Math.exp(-dt * 6);
      this.tiltS *= Math.exp(-dt * 6);
    }

    // --- Beschleunigen ---
    const dragK = (G * Math.tan(maxT)) / (s.maxSpeed * s.maxSpeed);
    vF += (G * Math.tan(this.tiltF) * 2 - dragK * 2 * vF * Math.abs(vF)) * dt;
    vS += (G * Math.tan(this.tiltS) - dragK * (c.assist ? 4 : 2) * vS * Math.abs(vS)) * dt;
    if (this.onGround) {
      vF *= Math.exp(-dt * 5);
      vS *= Math.exp(-dt * 5);
    }
    const vy = this.velocity.y;
    this.velocity.copy(this.fwd).multiplyScalar(vF).addScaledVector(this.right, vS);
    this.velocity.y = vy;

    // In Kurven neigt er sich ein wenig zur Seite (nur fürs Auge)
    this.turnLean += (c.roll * THREE.MathUtils.clamp(Math.abs(vF) / 30, 0, 1) * 0.35 - this.turnLean) * Math.min(1, dt * 3);
    this.updateQuaternion();

    // --- Bewegen ---
    this.position.addScaledVector(this.velocity, dt);

    // --- Boden ---
    const floor = ground(this.position.x, this.position.z) + SKIDS;
    if (this.onGround) {
      if (this.velocity.y > 0.3) this.onGround = false;
      else {
        this.position.y = floor;
        this.velocity.y = Math.max(0, this.velocity.y);
      }
    } else if (this.position.y <= floor) {
      const horizontal = Math.hypot(this.velocity.x, this.velocity.z);
      if (this.velocity.y < -4.5) return 'Zu hart aufgesetzt!';
      if (horizontal > 12) return 'Zu schnell aufgesetzt – erst abbremsen!';
      if (slope(this.position.x, this.position.z) > 0.38) return 'Am Steilhang umgekippt!';
      this.onGround = true;
      this.position.y = floor;
      this.velocity.y = 0;
    }
    return null;
  }

  private updateQuaternion() {
    this.quaternion.setFromAxisAngle(UP, this.yaw);
    this.tmpQ.setFromAxisAngle(this.tmpV.set(1, 0, 0), -this.tiltF);
    this.quaternion.multiply(this.tmpQ);
    this.tmpQ.setFromAxisAngle(this.tmpV.set(0, 0, -1), this.tiltS + this.turnLean);
    this.quaternion.multiply(this.tmpQ);
  }
}
