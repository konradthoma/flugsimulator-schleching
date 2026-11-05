import * as THREE from 'three';

export type VehicleKind = 'plane' | 'heli';

/** Gemeinsame Werte aller Fluggeräte (für Menü und Hangar). */
export interface VehicleBase {
  id: string;
  kind: VehicleKind;
  name: string;
  description: string;
  /** Preis im Hangar (0 = von Anfang an da) */
  price: number;
  /** Höchstgeschwindigkeit (m/s) */
  maxSpeed: number;
  /** Wendigkeit für die Anzeige im Menü (0..1) */
  agility: number;
  /** Abstand der Verfolgerkamera (m) */
  cameraDistance: number;
  /** Ungefähre Größe (für den Schatten) */
  size: number;
}

export interface VehicleModel {
  model: THREE.Group;
  /** Propeller (dreht sich um z), falls vorhanden */
  propeller?: THREE.Object3D;
  /** Düsenflamme (leuchtet je nach Gas), falls vorhanden */
  flame?: THREE.Mesh;
  /** Hauptrotor (dreht sich um y) */
  rotor?: THREE.Object3D;
  /** Heckrotor (dreht sich um x) */
  tailRotor?: THREE.Object3D;
}

export interface VehicleControls {
  throttle: number; // -1 weniger, +1 mehr (Gas bzw. Steigen)
  pitch: number; // +1 Nase hoch (Hubschrauber: rückwärts)
  roll: number; // +1 nach rechts (Hubschrauber: nach rechts drehen)
  yaw: number; // +1 Seitenruder rechts (Hubschrauber: seitwärts nach rechts)
  assist: boolean; // Flughilfe
}

export type GroundFn = (x: number, z: number) => number;

/** Was Flugzeug- und Hubschrauber-Physik gemeinsam können. */
export interface VehiclePhysics {
  readonly kind: VehicleKind;
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  /** Geschwindigkeit (m/s) */
  readonly speed: number;
  /** Steig- (+) bzw. Sinkgeschwindigkeit (-) in m/s */
  readonly verticalSpeed: number;
  throttle: number;
  readonly stalled: boolean;
  readonly onGround: boolean;
  readonly headingDeg: number;
  getForward(target: THREE.Vector3): THREE.Vector3;
  /** Blickrichtung der Verfolgerkamera */
  getCameraForward(target: THREE.Vector3): THREE.Vector3;
  reset(position: THREE.Vector3, headingRad: number, speed: number, onGround?: boolean): void;
  /** Bewegt das Fluggerät. Gibt bei einem Absturz den Grund zurück, sonst null. */
  update(dt: number, c: VehicleControls, ground: GroundFn, slope: GroundFn): string | null;
}

// ---------- Bausteine für Modelle ----------

export function mat(color: string, roughness = 0.6, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness, metalness });
}

export function adder(model: THREE.Group) {
  return (geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    model.add(mesh);
    return mesh;
  };
}

/** Lackiert alle hellen Teile eines Modells golden (Shop-Extra). */
export function paintGold(model: THREE.Object3D) {
  const gold = new THREE.MeshStandardMaterial({ color: '#f2c230', metalness: 0.35, roughness: 0.3, emissive: '#5a3c00', flatShading: true });
  const hsl = { h: 0, s: 0, l: 0 };
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as THREE.MeshStandardMaterial;
    if (!m.isMeshStandardMaterial || m.transparent) return;
    m.color.getHSL(hsl, THREE.SRGBColorSpace);
    if (hsl.l > 0.3) mesh.material = gold;
  });
}
