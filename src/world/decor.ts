import * as THREE from 'three';
import { Terrain } from './terrain';
import { seededRandom, valueNoise } from '../util/noise';

/** Nadelwald: Bäume an Hängen, Wiesen in den flachen Tälern. */
export function createForest(terrain: Terrain, maxTrees = 45000): THREE.InstancedMesh {
  const geo = new THREE.ConeGeometry(5, 18, 6).translate(0, 8, 0);
  const mat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1 });
  const mesh = new THREE.InstancedMesh(geo, mat, maxTrees);

  const rand = seededRandom(42);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const size = terrain.meta.sizeMeters;
  let count = 0;

  for (let tries = 0; tries < maxTrees * 8 && count < maxTrees; tries++) {
    const x = (rand() - 0.5) * size;
    const z = (rand() - 0.5) * size;
    const h = terrain.heightAt(x, z);
    if (h < 620 || h > 1550) continue;
    const slope = terrain.slopeAt(x, z);
    if (slope < 0.12 || slope > 1.0) continue; // flach = Wiese, sehr steil = Fels
    const forest = valueNoise(x / 500, z / 500) * 0.7 + valueNoise(x / 120, z / 120) * 0.3;
    if (forest < 0.33) continue;

    const s = 0.7 + rand() * 0.7;
    pos.set(x, h - 1, z);
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rand() * Math.PI);
    scale.set(s, s * (0.9 + rand() * 0.3), s);
    m.compose(pos, q, scale);
    mesh.setMatrixAt(count, m);
    color.setHSL(0.3 + rand() * 0.05, 0.45, 0.2 + rand() * 0.08);
    mesh.setColorAt(count, color);
    count++;
  }
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

/** Das Dorf Schleching: Häuser rund um die Mitte und eine Kirche. */
export function createVillage(terrain: Terrain): THREE.Group {
  const group = new THREE.Group();
  const rand = seededRandom(1234);

  const roofShape = new THREE.Shape([new THREE.Vector2(-6.5, 0), new THREE.Vector2(6.5, 0), new THREE.Vector2(0, 4.5)]);
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 14, bevelEnabled: false }).translate(0, 7, -7);
  const wallGeo = new THREE.BoxGeometry(11, 7, 12).translate(0, 3.5, 0);
  const wallMat = new THREE.MeshStandardMaterial({ color: '#f4efe4', roughness: 1 });
  const roofMat = new THREE.MeshStandardMaterial({ color: '#8a4b32', roughness: 1, flatShading: true });

  const maxHouses = 90;
  const walls = new THREE.InstancedMesh(wallGeo, wallMat, maxHouses);
  const roofs = new THREE.InstancedMesh(roofGeo, roofMat, maxHouses);
  const placed: THREE.Vector2[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  let count = 0;

  for (let tries = 0; tries < 4000 && count < maxHouses; tries++) {
    const r = 45 + Math.sqrt(rand()) * 900; // Platz für die Kirche in der Mitte lassen
    const a = rand() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (terrain.slopeAt(x, z) > 0.08) continue;
    if (placed.some((p) => p.distanceTo(new THREE.Vector2(x, z)) < 30)) continue;
    placed.push(new THREE.Vector2(x, z));
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rand() * Math.PI);
    m.compose(new THREE.Vector3(x, terrain.heightAt(x, z) - 0.5, z), q, one);
    walls.setMatrixAt(count, m);
    roofs.setMatrixAt(count, m);
    count++;
  }
  walls.count = roofs.count = count;
  group.add(walls, roofs);

  // Kirche mit Turm in der Ortsmitte
  const church = new THREE.Group();
  const nave = new THREE.Mesh(new THREE.BoxGeometry(14, 10, 28).translate(0, 5, 0), wallMat);
  const naveRoof = new THREE.Mesh(
    new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-8, 0), new THREE.Vector2(8, 0), new THREE.Vector2(0, 6)]), {
      depth: 28,
      bevelEnabled: false,
    }).translate(0, 10, -14),
    roofMat,
  );
  const tower = new THREE.Mesh(new THREE.BoxGeometry(7, 28, 7).translate(0, 14, -17), wallMat);
  const spire = new THREE.Mesh(
    new THREE.ConeGeometry(5, 12, 4).rotateY(Math.PI / 4).translate(0, 34, -17),
    new THREE.MeshStandardMaterial({ color: '#4d6b5a', flatShading: true }),
  );
  church.add(nave, naveRoof, tower, spire);
  church.position.set(0, terrain.heightAt(0, 0) - 0.5, 0);
  group.add(church);
  return group;
}
