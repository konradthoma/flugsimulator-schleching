import * as THREE from 'three';
import { adder, mat, VehicleBase, VehicleModel } from './vehicle';

/** Werte eines Flugzeugs. */
export interface PlaneStats extends VehicleBase {
  kind: 'plane';
  /** Beschleunigung bei Vollgas (m/s²) */
  thrust: number;
  /** Unter dieser Geschwindigkeit verliert das Flugzeug Auftrieb (m/s) */
  stallSpeed: number;
  /** Drehgeschwindigkeiten (rad/s) */
  pitchRate: number;
  rollRate: number;
  yawRate: number;
  /** Baut das 3D-Modell */
  build: () => VehicleModel;
}

/** @deprecated alter Name */
export type PlaneModel = VehicleModel;

/** Alle Flugzeuge, die man auswählen kann. */
export const PLANES: PlaneStats[] = [
  {
    id: 'piccolo',
    kind: 'plane',
    price: 0,
    agility: 0.5,
    size: 10,
    name: 'Piccolo',
    description: 'Kleines Propellerflugzeug. Langsam und gutmütig.',
    thrust: 11,
    maxSpeed: 62, // ca. 220 km/h
    stallSpeed: 24,
    pitchRate: 1.0,
    rollRate: 1.3,
    yawRate: 0.4,
    cameraDistance: 24,
    build: buildPiccolo,
  },
  {
    id: 'falke',
    kind: 'plane',
    price: 150,
    agility: 0.85,
    size: 9,
    name: 'Falke',
    description: 'Sportflugzeug. Schnell und wendig, gut für Kunstflug.',
    thrust: 17,
    maxSpeed: 108, // ca. 390 km/h
    stallSpeed: 32,
    pitchRate: 1.35,
    rollRate: 2.2,
    yawRate: 0.5,
    cameraDistance: 26,
    build: buildFalke,
  },
  {
    id: 'blitz',
    kind: 'plane',
    price: 600,
    agility: 1,
    size: 11,
    name: 'Blitz',
    description: 'Düsenjet. Extrem schnell, aber schwer zu beherrschen.',
    thrust: 32,
    maxSpeed: 210, // ca. 750 km/h
    stallSpeed: 50,
    pitchRate: 1.4,
    rollRate: 2.6,
    yawRate: 0.35,
    cameraDistance: 32,
    build: buildBlitz,
  },
];

export function getPlane(id: string): PlaneStats {
  return PLANES.find((p) => p.id === id) ?? PLANES[0];
}

// ---------- Modelle (Nase zeigt in Richtung -z) ----------

function buildPropeller(z: number, dark: THREE.Material, grey: THREE.Material) {
  const propeller = new THREE.Group();
  propeller.position.set(0, 0, z);
  propeller.add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.4, 0.08), dark));
  propeller.add(new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.5, 8).rotateX(-Math.PI / 2), grey));
  return propeller;
}

function buildPiccolo(): VehicleModel {
  const red = mat('#d8362f');
  const white = mat('#f5f5f0');
  const dark = mat('#2b3a4a', 0.3);
  const grey = mat('#555', 0.5);
  const model = new THREE.Group();
  const add = adder(model);

  add(new THREE.BoxGeometry(1.3, 1.3, 4.5), red, 0, 0, -0.3); // Rumpf vorne
  add(new THREE.BoxGeometry(0.9, 0.9, 3.2), red, 0, 0.15, 3.4); // Rumpf hinten
  add(new THREE.BoxGeometry(1.0, 1.0, 0.6), grey, 0, 0, -2.8); // Motor
  add(new THREE.BoxGeometry(1.15, 0.6, 1.6), dark, 0, 0.85, -0.6); // Cockpitfenster
  add(new THREE.BoxGeometry(10.5, 0.18, 1.7), white, 0, 1.2, -0.4); // Flügel (oben)
  add(new THREE.BoxGeometry(0.6, 0.18, 1.72), red, -4.9, 1.21, -0.4); // Flügelspitzen
  add(new THREE.BoxGeometry(0.6, 0.18, 1.72), red, 4.9, 1.21, -0.4);
  add(new THREE.BoxGeometry(3.6, 0.12, 1.0), white, 0, 0.3, 4.6); // Höhenleitwerk
  add(new THREE.BoxGeometry(0.12, 1.5, 1.1), white, 0, 1.0, 4.7); // Seitenleitwerk
  add(new THREE.BoxGeometry(0.15, 0.9, 0.15), grey, -1.2, -0.95, -0.8); // Fahrwerk
  add(new THREE.BoxGeometry(0.15, 0.9, 0.15), grey, 1.2, -0.95, -0.8);

  const propeller = buildPropeller(-3.15, dark, grey);
  model.add(propeller);
  return { model, propeller };
}

function buildFalke(): VehicleModel {
  const blue = mat('#1f6fd1', 0.4);
  const white = mat('#f5f5f0', 0.4);
  const yellow = mat('#ffc928', 0.4);
  const dark = mat('#1b2633', 0.2);
  const grey = mat('#666', 0.5);
  const model = new THREE.Group();
  const add = adder(model);

  // schlanker, spitz zulaufender Rumpf
  add(new THREE.CylinderGeometry(0.75, 0.55, 4.2, 8).rotateX(Math.PI / 2), blue, 0, 0, -0.6);
  add(new THREE.CylinderGeometry(0.55, 0.2, 3.6, 8).rotateX(Math.PI / 2), blue, 0, 0.1, 3.2);
  add(new THREE.CylinderGeometry(0.4, 0.75, 0.9, 8).rotateX(Math.PI / 2), grey, 0, 0, -3.1);
  add(new THREE.SphereGeometry(0.7, 8, 6).scale(0.9, 0.7, 1.8), dark, 0, 0.6, -0.6); // Kanzel
  add(new THREE.BoxGeometry(9.0, 0.16, 1.6), white, 0, -0.45, -0.3); // Flügel (unten)
  add(new THREE.BoxGeometry(1.2, 0.17, 1.62), yellow, -3.9, -0.44, -0.3);
  add(new THREE.BoxGeometry(1.2, 0.17, 1.62), yellow, 3.9, -0.44, -0.3);
  add(new THREE.BoxGeometry(3.4, 0.1, 0.9), white, 0, 0.15, 4.6); // Höhenleitwerk
  const fin = add(new THREE.BoxGeometry(0.1, 1.6, 1.2), yellow, 0, 0.9, 4.5); // Seitenleitwerk
  fin.rotation.x = -0.3;

  const propeller = buildPropeller(-3.65, dark, yellow);
  model.add(propeller);
  return { model, propeller };
}

function buildBlitz(): VehicleModel {
  const body = mat('#9aa4ad', 0.35, 0.4);
  const darkGrey = mat('#4b545c', 0.4, 0.3);
  const glass = mat('#1c2a38', 0.15);
  const accent = mat('#e04a2a', 0.4);
  const model = new THREE.Group();
  const add = adder(model);

  add(new THREE.CylinderGeometry(0.85, 0.85, 7, 10).rotateX(Math.PI / 2), body, 0, 0, 0.5); // Rumpf
  add(new THREE.ConeGeometry(0.85, 3.2, 10).rotateX(-Math.PI / 2), body, 0, 0, -4.6); // Nase
  add(new THREE.SphereGeometry(0.6, 10, 6).scale(1, 0.8, 2.6), glass, 0, 0.65, -2.2); // Kanzel

  // Deltaflügel als flaches Dreieck
  const wingShape = new THREE.Shape([new THREE.Vector2(0, -2.5), new THREE.Vector2(5.2, 2.8), new THREE.Vector2(0, 3.4)]);
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.15, bevelEnabled: false }).rotateX(Math.PI / 2);
  add(wingGeo, body, 0, -0.1, 0.6);
  add(wingGeo.clone().scale(-1, 1, 1), body, 0, -0.1, 0.6);
  add(new THREE.BoxGeometry(0.4, 0.17, 0.8), accent, 4.8, -0.16, 3.2); // Flügelspitzen
  add(new THREE.BoxGeometry(0.4, 0.17, 0.8), accent, -4.8, -0.16, 3.2);

  // Seitenleitwerk
  const finShape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(2.4, 0), new THREE.Vector2(2.6, 2.4), new THREE.Vector2(1.6, 2.4)]);
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.12, bevelEnabled: false }).rotateY(-Math.PI / 2);
  add(finGeo, accent, 0.06, 0.6, 1.6);

  add(new THREE.CylinderGeometry(0.75, 0.6, 0.8, 10).rotateX(Math.PI / 2), darkGrey, 0, 0, 4.4); // Düse

  const flame = add(
    new THREE.ConeGeometry(0.55, 3, 10).rotateX(Math.PI / 2).translate(0, 0, 1.5),
    new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.85 }),
    0,
    0,
    4.8,
  );
  return { model, flame };
}
