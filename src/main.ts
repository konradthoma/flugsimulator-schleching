import * as THREE from 'three';
import { Terrain } from './world/terrain';
import { createSky } from './world/sky';
import { createForest, createVillage } from './world/decor';
import { createPlaneModel, STARTER_PLANE } from './vehicles/plane';
import { PlanePhysics } from './physics/planePhysics';
import { Input } from './input';
import { Hud } from './ui/hud';
import { TouchControls } from './ui/touch';

// ---------- Grundaufbau ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.5, 40000);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const skyDome = createSky(scene);
const terrain = await Terrain.load('schleching');
scene.add(terrain.buildMesh());
scene.add(createForest(terrain));
scene.add(createVillage(terrain));

// ---------- Orte ----------
const M_PER_DEG_LAT = 111319.5;
function geoToWorld(lat: number, lon: number) {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((terrain.meta.center.lat * Math.PI) / 180);
  return new THREE.Vector2((lon - terrain.meta.center.lon) * mPerDegLon, (terrain.meta.center.lat - lat) * M_PER_DEG_LAT);
}
const PLACES = [
  { name: 'Schleching', pos: geoToWorld(47.7225, 12.3936), radius: 1200 },
  { name: 'Geigelstein (1808 m)', pos: geoToWorld(47.7073, 12.3345), radius: 1500 },
];

// ---------- Flugzeug ----------
const { model: planeModel, propeller } = createPlaneModel();
scene.add(planeModel);
const plane = new PlanePhysics(STARTER_PLANE);

const input = new Input();
const touch = new TouchControls();
const hud = new Hud();
hud.show();

let crashed = false;
let cameraMode: 'chase' | 'cockpit' = 'chase';
let invertPitch = false;
let assist = true;
let outsideTime = 0;

function startFlight() {
  // Start südlich von Schleching, Blick nach Norden über das Dorf
  const x = 0;
  const z = 3000;
  const y = Math.max(terrain.heightAt(x, z) + 450, 1100);
  plane.reset(new THREE.Vector3(x, y, z), 0, 45);
  crashed = false;
  outsideTime = 0;
  planeModel.visible = cameraMode === 'chase';
  hud.setMessage('');
  snapCamera();
}

// ---------- Kamera ----------
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const fwd = new THREE.Vector3();
const tmp = new THREE.Vector3();

function chaseTarget(out: THREE.Vector3) {
  plane.getForward(fwd);
  out.copy(plane.position).addScaledVector(fwd, -24);
  out.y += 7;
  return out;
}

function snapCamera() {
  chaseTarget(camPos);
  camera.position.copy(camPos);
  camLook.copy(plane.position);
}

function updateCamera(dt: number) {
  if (cameraMode === 'cockpit') {
    camera.position.copy(plane.position).add(tmp.set(0, 1.0, -0.6).applyQuaternion(plane.quaternion));
    camera.quaternion.copy(plane.quaternion);
    return;
  }
  const k = 1 - Math.exp(-dt * 4);
  chaseTarget(tmp);
  camPos.lerp(tmp, k);
  const minY = terrain.heightAt(camPos.x, camPos.z) + 3;
  if (camPos.y < minY) camPos.y = minY;
  camera.position.copy(camPos);
  plane.getForward(fwd);
  camLook.lerp(tmp.copy(plane.position).addScaledVector(fwd, 15), 1 - Math.exp(-dt * 8));
  camera.up.set(0, 1, 0);
  camera.lookAt(camLook);
}

// ---------- Spielschleife ----------
const clock = new THREE.Clock();
startFlight();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);

  if (input.wasPressed('KeyC') || touch.wasPressed('camera')) {
    cameraMode = cameraMode === 'chase' ? 'cockpit' : 'chase';
    planeModel.visible = cameraMode === 'chase' && !crashed;
    if (cameraMode === 'chase') snapCamera();
  }
  if (input.wasPressed('KeyK')) hud.toggleControls();
  if (input.wasPressed('KeyI')) invertPitch = !invertPitch;
  if (input.wasPressed('KeyH') || touch.wasPressed('assist')) assist = !assist;
  if (input.wasPressed('Space') || touch.wasPressed('restart')) startFlight();
  hud.setOptions(invertPitch, assist);

  if (!crashed) {
    const newThrottle = touch.takeThrottle();
    if (newThrottle !== null) plane.throttle = newThrottle;
    const clampAxis = (v: number) => Math.max(-1, Math.min(1, v));
    const pitch = clampAxis(input.axis('ArrowUp', 'ArrowDown') + touch.pitch) * (invertPitch ? -1 : 1);
    plane.update(dt, {
      throttle: input.axis('KeyS', 'KeyW'),
      pitch,
      roll: clampAxis(input.axis('ArrowLeft', 'ArrowRight') + touch.roll),
      yaw: input.axis('KeyA', 'KeyD'),
      assist,
    });

    const ground = terrain.heightAt(plane.position.x, plane.position.z);
    if (plane.position.y < ground + 1.2) {
      crashed = true;
      plane.position.y = ground + 1.2;
      planeModel.visible = false;
      hud.setMessage(touch.enabled ? '💥 Abgestürzt!\nTippe auf ↻ für einen neuen Flug' : '💥 Abgestürzt!\nDrücke die Leertaste für einen neuen Flug');
    }

    // Gebietsgrenze
    const margin = Math.max(Math.abs(plane.position.x), Math.abs(plane.position.z)) - terrain.half;
    if (!crashed) {
      if (margin > 500) {
        outsideTime += dt;
        const left = Math.ceil(10 - outsideTime);
        hud.setMessage(`Du verlässt das Gebiet – kehre um!\n${left}`);
        if (outsideTime > 10) startFlight();
      } else if (outsideTime > 0) {
        outsideTime = 0;
        hud.setMessage('');
      }
    }

    planeModel.position.copy(plane.position);
    planeModel.quaternion.copy(plane.quaternion);
    propeller.rotation.z += dt * (20 + plane.throttle * 60);

    const place = PLACES.find((p) => p.pos.distanceTo(new THREE.Vector2(plane.position.x, plane.position.z)) < p.radius);
    hud.setPlace(place ? place.name : '');

    hud.update({
      speed: plane.speed,
      altitude: plane.position.y,
      aboveGround: plane.position.y - ground,
      heading: plane.headingDeg,
      throttle: plane.throttle,
      stalled: plane.stalled,
    });
  }

  updateCamera(dt);
  skyDome.position.copy(camera.position);
  renderer.render(scene, camera);
  touch.showThrottle(plane.throttle);
  input.endFrame();
  touch.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Zum Testen in der Browser-Konsole
(window as unknown as Record<string, unknown>).game = { plane, planeModel, camera, scene, terrain };
