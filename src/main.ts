import * as THREE from 'three';
import { Terrain, TerrainRenderer } from './world/terrain';
import { createSky } from './world/sky';
import { createForest, createVillage } from './world/decor';
import { getPlane, PlaneModel, PlaneStats } from './vehicles/plane';
import { PlanePhysics } from './physics/planePhysics';
import { CoinField } from './game/coins';
import { loadSave, writeSave } from './game/save';
import { Sound } from './game/sound';
import { Input } from './input';
import { Hud } from './ui/hud';
import { TouchControls } from './ui/touch';
import { PlaneMenu } from './ui/menu';

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

const START = new THREE.Vector3(0, 0, 3000); // südlich von Schleching, Blick nach Norden

const skyDome = createSky(scene);
const terrain = await Terrain.load('schleching');
const terrainRenderer = new TerrainRenderer(terrain);
terrainRenderer.buildAll(START);
scene.add(terrainRenderer.group);
scene.add(createForest(terrain));
scene.add(createVillage(terrain));
const coins = new CoinField(terrain);
scene.add(coins.group);

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

// ---------- Spielzustand ----------
const save = loadSave();
const input = new Input();
const touch = new TouchControls();
const sound = new Sound();
const hud = new Hud();
const menu = new PlaneMenu(save.plane);
hud.show();

type State = 'menu' | 'flying' | 'crashed';
let state: State = 'menu';
let cameraMode: 'chase' | 'cockpit' = 'chase';
let invertPitch = false;
let assist = true;
let outsideTime = 0;
let flightScore = 0;

const plane = new PlanePhysics(getPlane(save.plane));
let planeModel: PlaneModel = plane.stats.build();
scene.add(planeModel.model);

function setPlane(stats: PlaneStats) {
  scene.remove(planeModel.model);
  planeModel = stats.build();
  scene.add(planeModel.model);
  plane.stats = stats;
}

function openMenu() {
  state = 'menu';
  hud.setMessage('');
  menu.show(save.coins, save.bestFlight, (stats) => {
    setPlane(stats);
    save.plane = stats.id;
    writeSave(save);
    startFlight();
  });
}

function startFlight() {
  const y = Math.max(terrain.heightAt(START.x, START.z) + 450, 1100);
  plane.reset(new THREE.Vector3(START.x, y, START.z), 0, plane.stats.stallSpeed * 1.8);
  coins.reset();
  flightScore = 0;
  state = 'flying';
  outsideTime = 0;
  planeModel.model.visible = cameraMode === 'chase';
  hud.setMessage('');
  snapCamera();
}

function crash() {
  state = 'crashed';
  planeModel.model.visible = false;
  sound.crash();
  const record = flightScore > save.bestFlight;
  if (record) {
    save.bestFlight = flightScore;
    writeSave(save);
  }
  const again = touch.enabled ? 'Tippe auf ↻ für einen neuen Flug' : 'Leertaste: neuer Flug · M: Flugzeug wählen';
  hud.setMessage(`💥 Abgestürzt!\n${flightScore} ${flightScore === 1 ? 'Punkt' : 'Punkte'} in diesem Flug${record ? ' – neuer Rekord! 🏆' : ''}\n${again}`);
}

// ---------- Kamera ----------
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const fwd = new THREE.Vector3();
const tmp = new THREE.Vector3();

function chaseTarget(out: THREE.Vector3) {
  plane.getForward(fwd);
  out.copy(plane.position).addScaledVector(fwd, -plane.stats.cameraDistance);
  out.y += plane.stats.cameraDistance * 0.3;
  return out;
}

function snapCamera() {
  chaseTarget(camPos);
  camera.position.copy(camPos);
  camLook.copy(plane.position);
  camera.lookAt(camLook);
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

// ---------- Münzen ----------
const prevPos = new THREE.Vector3();

function handleCoins() {
  const radius = 16 + plane.speed * 0.03;
  const hits = coins.collect(prevPos, plane.position, radius);
  if (hits.length === 0) return;
  const points = hits.reduce((sum, c) => sum + c.value, 0);
  flightScore += points;
  save.coins += points;
  if (hits.some((c) => c.value > 1)) sound.bigCoin();
  else sound.coin();
  hud.popup(`+${points}`);

  if (coins.remaining === 0) {
    const bonus = 50;
    flightScore += bonus;
    save.coins += bonus;
    sound.allCollected();
    hud.setMessage(`🎉 Alle Münzen gesammelt!\n+${bonus} Bonuspunkte`);
    window.setTimeout(() => state === 'flying' && hud.setMessage(''), 4000);
  }
  writeSave(save);
}

function updateCoinPointer() {
  const target = coins.nearest(plane.position);
  if (!target) return hud.setCoinPointer(null);
  const dx = target.position.x - plane.position.x;
  const dz = target.position.z - plane.position.z;
  const bearing = THREE.MathUtils.radToDeg(Math.atan2(dx, -dz));
  const rel = ((bearing - plane.headingDeg + 540) % 360) - 180;
  hud.setCoinPointer(rel, Math.hypot(dx, dz), target.position.y - plane.position.y);
}

// ---------- Spielschleife ----------
const clock = new THREE.Clock();
plane.reset(new THREE.Vector3(START.x, 1100, START.z), 0, 0);
snapCamera();
openMenu();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);

  if (state !== 'menu' && !menu.visible) {
    if (input.wasPressed('KeyC') || touch.wasPressed('camera')) {
      cameraMode = cameraMode === 'chase' ? 'cockpit' : 'chase';
      planeModel.model.visible = cameraMode === 'chase' && state === 'flying';
      if (cameraMode === 'chase') snapCamera();
    }
    if (input.wasPressed('KeyK')) hud.toggleControls();
    if (input.wasPressed('KeyI')) invertPitch = !invertPitch;
    if (input.wasPressed('KeyH') || touch.wasPressed('assist')) assist = !assist;
    if (input.wasPressed('Space') || touch.wasPressed('restart')) startFlight();
    if (input.wasPressed('KeyM') || touch.wasPressed('menu')) openMenu();
  }
  hud.setOptions(invertPitch, assist);

  if (state === 'flying') {
    const newThrottle = touch.takeThrottle();
    if (newThrottle !== null) plane.throttle = newThrottle;
    const clampAxis = (v: number) => Math.max(-1, Math.min(1, v));
    prevPos.copy(plane.position);
    plane.update(dt, {
      throttle: input.axis('KeyS', 'KeyW'),
      pitch: clampAxis(input.axis('ArrowUp', 'ArrowDown') + touch.pitch) * (invertPitch ? -1 : 1),
      roll: clampAxis(input.axis('ArrowLeft', 'ArrowRight') + touch.roll),
      yaw: input.axis('KeyA', 'KeyD'),
      assist,
    });
    handleCoins();

    const ground = terrain.heightAt(plane.position.x, plane.position.z);
    if (plane.position.y < ground + 1.2) {
      plane.position.y = ground + 1.2;
      crash();
    }

    // Gebietsgrenze
    const margin = Math.max(Math.abs(plane.position.x), Math.abs(plane.position.z)) - terrain.half;
    if (state === 'flying') {
      if (margin > 500) {
        outsideTime += dt;
        hud.setMessage(`Du verlässt das Gebiet – kehre um!\n${Math.ceil(10 - outsideTime)}`);
        if (outsideTime > 10) startFlight();
      } else if (outsideTime > 0) {
        outsideTime = 0;
        hud.setMessage('');
      }
    }

    planeModel.model.position.copy(plane.position);
    planeModel.model.quaternion.copy(plane.quaternion);
    if (planeModel.propeller) planeModel.propeller.rotation.z += dt * (20 + plane.throttle * 60);
    if (planeModel.flame) {
      planeModel.flame.scale.set(1, 1, 0.2 + plane.throttle * (0.9 + Math.random() * 0.25));
    }

    const here = new THREE.Vector2(plane.position.x, plane.position.z);
    hud.setPlace(PLACES.find((p) => p.pos.distanceTo(here) < p.radius)?.name ?? '');
    hud.update({
      speed: plane.speed,
      altitude: plane.position.y,
      aboveGround: plane.position.y - ground,
      heading: plane.headingDeg,
      throttle: plane.throttle,
      stalled: plane.stalled,
    });
    updateCoinPointer();
  }
  hud.setScore(flightScore, save.coins, coins.remaining);

  coins.update(dt);
  updateCamera(dt);
  terrainRenderer.update(camera.position);
  skyDome.position.copy(camera.position);
  renderer.render(scene, camera);
  touch.showThrottle(plane.throttle);
  input.endFrame();
  touch.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Zum Testen in der Browser-Konsole
(window as unknown as Record<string, unknown>).game = { plane, camera, scene, terrain, coins, save, get model() { return planeModel; } };
