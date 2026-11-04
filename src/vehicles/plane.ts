import * as THREE from 'three';

/** Werte eines Flugzeugs. Später bekommt jedes Fluggerät im Shop eigene Werte. */
export interface PlaneStats {
  name: string;
  /** Beschleunigung bei Vollgas (m/s²) */
  thrust: number;
  /** Höchstgeschwindigkeit im Geradeausflug (m/s) */
  maxSpeed: number;
  /** Unter dieser Geschwindigkeit verliert das Flugzeug Auftrieb (m/s) */
  stallSpeed: number;
  /** Drehgeschwindigkeiten (rad/s) */
  pitchRate: number;
  rollRate: number;
  yawRate: number;
}

export const STARTER_PLANE: PlaneStats = {
  name: 'Kleines Propellerflugzeug',
  thrust: 11,
  maxSpeed: 62, // ca. 220 km/h
  stallSpeed: 24,
  pitchRate: 1.0,
  rollRate: 1.3,
  yawRate: 0.4,
};

/** Einfaches Flugzeugmodell aus Grundformen. Die Nase zeigt in Richtung -z. */
export function createPlaneModel(): { model: THREE.Group; propeller: THREE.Object3D } {
  const red = new THREE.MeshStandardMaterial({ color: '#d8362f', flatShading: true, roughness: 0.6 });
  const white = new THREE.MeshStandardMaterial({ color: '#f5f5f0', flatShading: true, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: '#2b3a4a', roughness: 0.3 });
  const grey = new THREE.MeshStandardMaterial({ color: '#555', roughness: 0.5 });

  const model = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    model.add(mesh);
    return mesh;
  };

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

  const propeller = new THREE.Group();
  propeller.position.set(0, 0, -3.15);
  propeller.add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.4, 0.08), dark));
  propeller.add(new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.5, 8).rotateX(-Math.PI / 2), grey));
  model.add(propeller);

  return { model, propeller };
}
