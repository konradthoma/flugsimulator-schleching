import * as THREE from 'three';
import { adder, mat, VehicleBase, VehicleModel } from './vehicle';

/** Werte eines Hubschraubers. */
export interface HeliStats extends VehicleBase {
  kind: 'heli';
  /** Steiggeschwindigkeit bei vollem Rotor (m/s) */
  climbRate: number;
  /** Sinkgeschwindigkeit bei wenig Rotor (m/s) */
  descentRate: number;
  /** Größte Neigung nach vorne/hinten (rad) */
  maxTilt: number;
  /** Drehgeschwindigkeit um die Hochachse (rad/s) */
  yawRate: number;
  build: () => VehicleModel;
}

export const HELIS: HeliStats[] = [
  {
    id: 'libelle',
    kind: 'heli',
    name: 'Libelle',
    description: 'Kleiner Hubschrauber. Kann schweben, rückwärts fliegen und überall landen.',
    price: 250,
    maxSpeed: 46, // ca. 165 km/h
    agility: 0.75,
    cameraDistance: 20,
    size: 9,
    climbRate: 9,
    descentRate: 8,
    maxTilt: 0.32,
    yawRate: 1.3,
    build: buildLibelle,
  },
  {
    id: 'bergadler',
    kind: 'heli',
    name: 'Bergadler',
    description: 'Rettungshubschrauber. Schnell, stark und gebaut für Einsätze in den Bergen.',
    price: 900,
    maxSpeed: 74, // ca. 265 km/h
    agility: 0.9,
    cameraDistance: 24,
    size: 13,
    climbRate: 14,
    descentRate: 11,
    maxTilt: 0.38,
    yawRate: 1.5,
    build: buildBergadler,
  },
];

// ---------- Modelle (Nase zeigt in Richtung -z) ----------

function buildRotor(blades: number, length: number, material: THREE.Material, hub: THREE.Material) {
  const rotor = new THREE.Group();
  for (let i = 0; i < blades; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.08, length).translate(0, 0, length / 2), material);
    blade.rotation.y = (i / blades) * Math.PI * 2;
    rotor.add(blade);
  }
  rotor.add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.5, 8), hub));
  return rotor;
}

function buildTailRotor(length: number, material: THREE.Material) {
  const rotor = new THREE.Group();
  rotor.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, length, 0.25), material));
  rotor.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.25, length), material));
  return rotor;
}

function buildSkids(model: THREE.Group, width: number, length: number, y: number, material: THREE.Material) {
  const add = adder(model);
  for (const side of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.09, 0.09, length, 6).rotateX(Math.PI / 2), material, side * width, y, 0);
    add(new THREE.BoxGeometry(0.1, 0.9, 0.1), material, side * width * 0.85, y + 0.45, -length * 0.25);
    add(new THREE.BoxGeometry(0.1, 0.9, 0.1), material, side * width * 0.85, y + 0.45, length * 0.25);
  }
}

function buildLibelle(): VehicleModel {
  const green = mat('#2fa55a', 0.45);
  const glass = new THREE.MeshStandardMaterial({ color: '#9fd4ff', transparent: true, opacity: 0.55, roughness: 0.1, flatShading: true });
  const dark = mat('#2a2f36', 0.5);
  const grey = mat('#8c939a', 0.5);
  const model = new THREE.Group();
  const add = adder(model);

  add(new THREE.SphereGeometry(1.25, 12, 9).scale(1, 0.95, 1.25), glass, 0, 0.3, -0.6); // Glaskanzel
  add(new THREE.BoxGeometry(1.7, 1.1, 1.6), green, 0, 0.1, 0.7); // Kabine hinten
  add(new THREE.BoxGeometry(0.9, 0.5, 1.2), dark, 0, 0.9, 0.7); // Motor
  add(new THREE.CylinderGeometry(0.22, 0.32, 5.2, 6).rotateX(Math.PI / 2), green, 0, 0.45, 3.9); // Heckausleger
  add(new THREE.BoxGeometry(0.1, 1.3, 0.8), green, 0, 1.0, 6.3); // Seitenflosse
  add(new THREE.BoxGeometry(1.6, 0.08, 0.5), green, 0, 0.45, 5.9); // Höhenflosse
  add(new THREE.CylinderGeometry(0.08, 0.08, 0.8, 6), grey, 0, 1.4, 0.4); // Rotormast
  buildSkids(model, 0.95, 3.4, -1.0, grey);

  const rotor = buildRotor(2, 4.6, dark, grey);
  rotor.position.set(0, 1.85, 0.4);
  model.add(rotor);
  const tailRotor = buildTailRotor(1.3, dark);
  tailRotor.position.set(0.2, 0.9, 6.4);
  model.add(tailRotor);
  return { model, rotor, tailRotor };
}

function buildBergadler(): VehicleModel {
  const red = mat('#d6332b', 0.4);
  const white = mat('#f3f3ef', 0.4);
  const glass = mat('#1d2a38', 0.15);
  const dark = mat('#262b31', 0.5);
  const grey = mat('#7d858c', 0.5);
  const model = new THREE.Group();
  const add = adder(model);

  add(new THREE.BoxGeometry(2.2, 1.9, 4.2), red, 0, 0.3, 0); // Kabine
  add(new THREE.BoxGeometry(2.0, 1.3, 1.6).translate(0, 0, -0.8), glass, 0, 0.45, -2.1); // Cockpitscheiben
  add(new THREE.SphereGeometry(1.0, 10, 8).scale(1.05, 0.7, 1), red, 0, -0.1, -2.6); // Nase
  add(new THREE.BoxGeometry(2.22, 0.45, 4.22), white, 0, -0.35, 0); // weißer Streifen
  add(new THREE.BoxGeometry(1.4, 0.7, 2.6), dark, 0, 1.55, 0.5); // Triebwerke
  add(new THREE.CylinderGeometry(0.3, 0.55, 6.5, 8).rotateX(Math.PI / 2), red, 0, 0.75, 5.2); // Heckausleger
  add(new THREE.BoxGeometry(0.15, 1.8, 1.1), white, 0, 1.5, 8.2); // Seitenflosse
  add(new THREE.BoxGeometry(2.4, 0.1, 0.6), white, 0, 0.8, 7.6); // Höhenflosse
  add(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat('#ffffff', 0.2), 0, -0.6, -1.6).scale.set(1, 0.4, 1); // Scheinwerfer
  // weißes Kreuz an der Seite
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.02, 0.9, 0.3), white, side * 1.11, 0.45, 0.8);
    add(new THREE.BoxGeometry(0.02, 0.3, 0.9), white, side * 1.11, 0.45, 0.8);
  }
  buildSkids(model, 1.2, 4.4, -1.15, grey);

  const rotor = buildRotor(4, 6.2, dark, grey);
  rotor.position.set(0, 2.1, 0.3);
  model.add(rotor);
  const tailRotor = buildTailRotor(1.8, dark);
  tailRotor.position.set(0.25, 1.4, 8.4);
  model.add(tailRotor);
  return { model, rotor, tailRotor };
}
