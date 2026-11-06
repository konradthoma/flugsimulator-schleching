import * as THREE from 'three';
import { Terrain, TerrainRenderer } from './world/terrain';
import { createSky } from './world/sky';
import { Scenery } from './world/scenery';
import { createMajorFeatures } from './world/mapfeatures';
import { Airfield } from './world/airfield';
import { geoToWorld } from './world/places';
import { Explosion, Shadow, Wind } from './world/effects';
import { createPhysics, getVehicle, VehicleStats, withTurbo } from './vehicles';
import { paintGold, VehicleModel, VehiclePhysics } from './vehicles/vehicle';
import { HeliPhysics } from './physics/heliPhysics';
import { CoinField } from './game/coins';
import { Race } from './game/race';
import { Traffic } from './game/traffic';
import { Mission, Missions } from './game/missions';
import { addHighscore, formatTime, GameMode, loadSave, writeSave } from './game/save';
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

const sky = createSky(scene);
const terrain = await Terrain.load('schleching');
const terrainRenderer = new TerrainRenderer(terrain);
terrainRenderer.buildAll(START);
scene.add(terrainRenderer.group);
const airfield = new Airfield(terrain);
scene.add(airfield.group);
const missions = new Missions(terrain, airfield);
scene.add(missions.group, missions.decor);
const keepFree = (x: number, z: number) => airfield.blocks(x, z) || missions.blocks(x, z);
scene.add(createMajorFeatures(terrain, keepFree));
// Auf Handy und Tablet: Häuser und Bäume nicht ganz so weit zeigen
const lowDetail = window.matchMedia('(pointer: coarse)').matches;
const scenery = await Scenery.load(terrain, 'schleching', keepFree, lowDetail);
scenery.buildAll(START);
scene.add(scenery.group);
const coins = new CoinField(terrain);
scene.add(coins.group);
const race = new Race(terrain);
scene.add(race.group);
const traffic = new Traffic(terrain);
scene.add(traffic.group);
const shadow = new Shadow();
scene.add(shadow.mesh);
const explosion = new Explosion();
scene.add(explosion.group);
const wind = new Wind();

// ---------- Orte ----------
// Echte Orte, Inseln und Gipfel aus OpenStreetMap; angezeigt wird der nächstgelegene
const PLACE_RADIUS: Record<string, number> = { town: 1500, village: 1000, hamlet: 350, island: 600, islet: 250, peak: 700 };
const PLACES = [
  { name: 'Flugplatz Unterwössen', pos: new THREE.Vector2(airfield.center.x, airfield.center.z), radius: 500 },
  ...(terrain.features.places ?? []).map((p) => ({
    name: p.kind === 'peak' && p.ele ? `${p.name} (${p.ele} m)` : p.name,
    pos: new THREE.Vector2(p.x, p.z),
    radius: PLACE_RADIUS[p.kind] ?? 500,
  })),
];
if (!terrain.features.places) PLACES.push({ name: 'Schleching', pos: geoToWorld(terrain, 47.7225, 12.3936), radius: 1200 });

function placeName(x: number, z: number): string {
  const here = new THREE.Vector2(x, z);
  if (PLACES[0].pos.distanceTo(here) < PLACES[0].radius) return PLACES[0].name;
  let best = '';
  let bestScore = 1;
  for (const p of PLACES) {
    const score = p.pos.distanceTo(here) / p.radius;
    if (score < bestScore) {
      bestScore = score;
      best = p.name;
    }
  }
  return best || terrain.lakeName(x, z);
}

// ---------- Spielzustand ----------
const save = loadSave();
const input = new Input();
const touch = new TouchControls();
const sound = new Sound();
const hud = new Hud();
const menu = new PlaneMenu(save, missions.list, applySettings);
hud.show();

type State = 'menu' | 'flying' | 'crashed' | 'finished';
let state: State = 'menu';
let mode: GameMode = save.mode;
let mission: Mission | null = null;
let cameraMode: 'chase' | 'cockpit' = 'chase';
let invertPitch = false;
let assist = true;
let paused = false;
let pauseShown = false;
let hintShown = false;
/** Zeitraffer: 1 = normal, 1.5, 2 oder 3 = schneller */
let timeScale = [1, 1.5, 2, 3].includes(save.timeScale) ? save.timeScale : 1;

function showTimeScale() {
  hud.setTimeScale(timeScale);
  touch.setSpeedLabel(`${String(timeScale).replace('.', ',')}×`);
}
let outsideTime = 0;
let flightScore = 0;
let wasOnGround = false;

let stats: VehicleStats = getVehicle(save.plane);
let vehicle: VehiclePhysics = createPhysics(stats);
let model: VehicleModel = stats.build();
scene.add(model.model);

/** Fluggerät wechseln (mit Extras aus dem Hangar). */
function setVehicle(base: VehicleStats) {
  scene.remove(model.model);
  stats = save.upgrades.turbo ? withTurbo(base) : base;
  vehicle = createPhysics(stats);
  if (vehicle instanceof HeliPhysics) vehicle.autoCenter = !touch.enabled;
  model = base.build();
  if (save.upgrades.gold) paintGold(model.model);
  scene.add(model.model);
  hud.setVehicleKind(stats.kind);
  touch.setVehicleKind(stats.kind);
}

/** Einstellungen aus dem Menü übernehmen. */
function applySettings() {
  const s = save.settings;
  traffic.visible = s.traffic;
  coins.beaconsVisible = s.beacons;
  sound.enabled = s.sound;
  sound.engineEnabled = s.engine;
  sky.setEvening(s.evening);
  if (!s.pointer) hud.setCoinPointer(null);
  writeSave(save);
}

function openMenu() {
  state = 'menu';
  paused = false;
  hud.setMessage('');
  hud.setWarning(null);
  menu.show((chosen, chosenMode, chosenMission) => {
    mode = chosenMode;
    mission = chosenMission;
    save.plane = chosen.id;
    save.mode = chosenMode;
    writeSave(save);
    setVehicle(chosen);
    startFlight();
  });
}

function startFlight() {
  coins.group.visible = mode === 'coins';
  race.group.visible = mode === 'race';
  const airSpeed = stats.kind === 'plane' ? stats.stallSpeed * 1.8 : 15;
  const onGroundAt = (p: THREE.Vector3, heading: number) =>
    vehicle.reset(new THREE.Vector3(p.x, terrain.heightAt(p.x, p.z), p.z), heading, 0, true);

  if (mode === 'missions' && mission) {
    missions.begin(mission);
    const st = mission.start;
    if (st.onGround) onGroundAt(st.position, st.heading);
    else vehicle.reset(st.position, st.heading, airSpeed);
  } else {
    missions.stop();
    if (mode === 'race') {
      race.reset();
      vehicle.reset(race.startPosition, race.startHeading, airSpeed);
    } else if (mode === 'free') {
      if (stats.kind === 'heli') onGroundAt(airfield.helipad, airfield.heading);
      else onGroundAt(airfield.threshold, airfield.heading);
    } else {
      const y = Math.max(terrain.heightAt(START.x, START.z) + 450, 1100);
      vehicle.reset(new THREE.Vector3(START.x, y, START.z), 0, airSpeed);
      coins.reset();
    }
  }
  flightScore = 0;
  state = 'flying';
  paused = false;
  outsideTime = 0;
  wasOnGround = vehicle.onGround;
  model.model.visible = cameraMode === 'chase';
  hintShown = vehicle.onGround;
  hud.setMessage(hintShown ? startHint() : '');
  hud.setWarning(null);
  syncModel(0);
  snapCamera();
}

function startHint() {
  if (stats.kind === 'heli') return touch.enabled ? 'Schieb den Rotor-Regler über die Mitte zum Abheben' : 'Halte W zum Abheben';
  return touch.enabled ? 'Gas ganz hoch, dann ab ca. ' + Math.round(stats.stallSpeed * 3.6) + ' km/h Knüppel zu dir ziehen' : `W = Gas geben, ab ca. ${Math.round(stats.stallSpeed * 3.6)} km/h mit ↓ abheben`;
}

const againText = () => (touch.enabled ? 'Tippe auf ↻ für einen neuen Flug · ✈ für das Menü' : 'Leertaste: neuer Flug · M: Menü');

function crash(reason: string) {
  const wasFinished = state === 'finished';
  state = 'crashed';
  model.model.visible = false;
  explosion.trigger(vehicle.position);
  hud.setWarning(null);
  sound.crash();
  if (mode === 'race' || mode === 'missions') {
    hud.setMessage(`💥 ${reason}\n${wasFinished ? '' : mode === 'race' ? 'Rennen nicht geschafft' : 'Mission nicht geschafft'}\n${againText()}`);
    return;
  }
  if (mode === 'free') {
    hud.setMessage(`💥 ${reason}\n${againText()}`);
    return;
  }
  const record = flightScore > save.bestFlight;
  if (record) save.bestFlight = flightScore;
  if (flightScore > 0) addHighscore(save.highscores.coins, flightScore, stats.name, false);
  writeSave(save);
  const points = `${flightScore} ${flightScore === 1 ? 'Punkt' : 'Punkte'} in diesem Flug${record ? ' – neuer Rekord! 🏆' : ''}`;
  hud.setMessage(`💥 ${reason}\n${points}\n${againText()}`);
}

// ---------- Kamera ----------
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const fwd = new THREE.Vector3();
const tmp = new THREE.Vector3();

function chaseTarget(out: THREE.Vector3) {
  vehicle.getCameraForward(fwd);
  out.copy(vehicle.position).addScaledVector(fwd, -stats.cameraDistance);
  out.y += stats.cameraDistance * 0.3;
  return out;
}

function snapCamera() {
  chaseTarget(camPos);
  camPos.y = Math.max(camPos.y, terrain.surfaceAt(camPos.x, camPos.z) + 3);
  camera.position.copy(camPos);
  camLook.copy(vehicle.position);
  camera.lookAt(camLook);
}

function updateCamera(dt: number) {
  if (cameraMode === 'cockpit' && state !== 'crashed') {
    const offset = stats.kind === 'heli' ? tmp.set(0, 0.5, -1.4) : tmp.set(0, 1.0, -0.6);
    camera.position.copy(vehicle.position).add(offset.applyQuaternion(vehicle.quaternion));
    camera.quaternion.copy(vehicle.quaternion);
    return;
  }
  const k = 1 - Math.exp(-dt * 4);
  chaseTarget(tmp);
  camPos.lerp(tmp, k);
  const minY = terrain.surfaceAt(camPos.x, camPos.z) + 3;
  if (camPos.y < minY) camPos.y = minY;
  camera.position.copy(camPos);
  vehicle.getCameraForward(fwd);
  camLook.lerp(tmp.copy(vehicle.position).addScaledVector(fwd, 15), 1 - Math.exp(-dt * 8));
  camera.up.set(0, 1, 0);
  camera.lookAt(camLook);
}

/** Winkel zu einem Ziel relativ zur Flugrichtung (0 = geradeaus, 90 = rechts). */
function relativeBearing(target: THREE.Vector3) {
  const bearing = THREE.MathUtils.radToDeg(Math.atan2(target.x - vehicle.position.x, -(target.z - vehicle.position.z)));
  return ((bearing - vehicle.headingDeg + 540) % 360) - 180;
}

function pointTo(target: THREE.Vector3 | undefined) {
  if (!target || !save.settings.pointer) return hud.setCoinPointer(null);
  const dist = Math.hypot(target.x - vehicle.position.x, target.z - vehicle.position.z);
  hud.setCoinPointer(relativeBearing(target), dist, target.y - vehicle.position.y);
}

// ---------- Münzen ----------
const prevPos = new THREE.Vector3();

function handleCoins() {
  const radius = (16 + vehicle.speed * 0.03) * (save.upgrades.magnet ? 1.8 : 1);
  const hits = coins.collect(prevPos, vehicle.position, radius);
  if (hits.length > 0) {
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
  hud.setTopInfo(`🪙 ${flightScore}`, `Gesamt ${save.coins} · noch ${coins.remaining} Münzen`);
  pointTo(coins.nearest(vehicle.position)?.position);
}

// ---------- Ringrennen ----------
const RACE_REWARD = 10;
const RECORD_REWARD = 20;

function handleRace(dt: number) {
  const event = race.update(dt, prevPos, vehicle.position);
  if (event?.type === 'start') {
    sound.coin();
    hud.popup('Los! ⏱');
  } else if (event?.type === 'ring') {
    sound.coin();
    hud.popup(`${event.index + 1}/${race.total}`);
  } else if (event?.type === 'finish') {
    const best = save.bestTimes[stats.id];
    const record = !best || event.time < best;
    const reward = RACE_REWARD + (record ? RECORD_REWARD : 0);
    if (record) save.bestTimes[stats.id] = event.time;
    const place = addHighscore(save.highscores.race, event.time, stats.name, true);
    save.coins += reward;
    writeSave(save);
    sound.allCollected();
    state = 'finished';
    const bestLine = record ? 'Neue Bestzeit! 🏆' : `Bestzeit: ${formatTime(best!)}`;
    const placeLine = place > 0 ? ` · Platz ${place} in der Bestenliste` : '';
    hud.setMessage(`🏁 Ziel! ${formatTime(event.time)}\n${bestLine}${placeLine}\n+${reward} Punkte\n${againText()}`);
  }

  const best = save.bestTimes[stats.id];
  const timeText = race.running || race.finished ? formatTime(race.elapsed) : '0:00.0';
  const ringText = race.finished ? 'Geschafft!' : race.nextIndex === 0 ? 'Flieg durch den grünen Startring' : `Ring ${race.nextIndex + 1} von ${race.total}`;
  hud.setTopInfo(`⏱ ${timeText}`, `${ringText}${best ? ` · Bestzeit ${formatTime(best)}` : ''}`);
  pointTo(race.nextRing?.center);
}

// ---------- Missionen ----------
function handleMission(dt: number, agl: number) {
  const m = mission;
  if (!m) return;
  const event = state === 'flying' ? missions.update(dt, prevPos, vehicle, agl) : null;
  if (event?.type === 'step') {
    sound.success();
    hud.popup(event.text);
  } else if (event?.type === 'done') {
    const first = !(m.id in save.missions);
    const reward = first ? m.reward : Math.max(5, Math.round(m.reward / 4));
    const best = save.missions[m.id];
    const record = best === undefined || event.time < best;
    if (record) save.missions[m.id] = event.time;
    save.coins += reward;
    writeSave(save);
    sound.allCollected();
    state = 'finished';
    hud.setMessage(
      `🎯 ${m.name} geschafft!\nZeit ${formatTime(event.time)}${record && !first ? ' – neue Bestzeit! 🏆' : ''}\n+${reward} Punkte${first ? ' (erstes Mal!)' : ''}\n${againText()}`,
    );
  } else if (event?.type === 'fail') {
    state = 'finished';
    sound.fail();
    hud.setMessage(`❌ ${event.reason}\nMission nicht geschafft\n${againText()}`);
  }
  const done = state === 'finished';
  hud.setTopInfo(`🎯 ${formatTime(missions.elapsed)}`, done ? m.name : missions.statusText(agl));
  pointTo(done ? undefined : missions.target);
}

// ---------- Verkehr ----------
function handleTraffic() {
  if (traffic.collides(prevPos, vehicle.position)) {
    crash('Zusammenstoß mit einem anderen Flugzeug!');
    return;
  }
  const threat = traffic.nearbyThreat(vehicle.position);
  if (!threat) return hud.setWarning(null);
  const rel = relativeBearing(threat.position);
  const where = Math.abs(rel) < 35 ? 'vor dir' : Math.abs(rel) > 145 ? 'hinter dir' : rel > 0 ? 'rechts' : 'links';
  const dy = threat.position.y - vehicle.position.y;
  const height = dy > 30 ? ', über dir' : dy < -30 ? ', unter dir' : ', auf deiner Höhe';
  hud.setWarning(`⚠ Flugzeug ${where}${height} – ${Math.round(threat.distance)} m`);
}

// ---------- Modell ----------
function syncModel(dt: number) {
  model.model.position.copy(vehicle.position);
  model.model.quaternion.copy(vehicle.quaternion);
  if (model.propeller) model.propeller.rotation.z += dt * (20 + vehicle.throttle * 60);
  if (model.flame) model.flame.scale.set(1, 1, 0.2 + vehicle.throttle * (0.9 + Math.random() * 0.25));
  if (model.rotor) model.rotor.rotation.y -= dt * (vehicle.onGround && vehicle.throttle < 0.4 ? 9 + vehicle.throttle * 30 : 26);
  if (model.tailRotor) model.tailRotor.rotation.x += dt * 45;
}

// ---------- Spielschleife ----------
const clock = new THREE.Clock();
setVehicle(stats);
vehicle.reset(new THREE.Vector3(START.x, 1100, START.z), 0, 0);
snapCamera();
applySettings();
showTimeScale();
openMenu();

// Zum Landen zählt auch der Wasserspiegel (dort gibt es dann aber einen Absturz)
const groundAt = (x: number, z: number) => terrain.surfaceAt(x, z);
const slopeAt = (x: number, z: number) => terrain.slopeAt(x, z, 8);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'flying') paused = true;
});

/** Ein Simulationsschritt (dt in Spielzeit). */
function simulate(dt: number) {
  const clampAxis = (v: number) => Math.max(-1, Math.min(1, v));
  prevPos.copy(vehicle.position);
  wind.update(dt, save.settings.wind);
  const reason = vehicle.update(
    dt,
    {
      throttle: input.axis('KeyS', 'KeyW'),
      pitch: clampAxis(input.axis('ArrowUp', 'ArrowDown') + touch.pitch) * (invertPitch && stats.kind === 'plane' ? -1 : 1),
      roll: clampAxis(input.axis('ArrowLeft', 'ArrowRight') + touch.roll),
      yaw: input.axis('KeyA', 'KeyD'),
      assist,
    },
    groundAt,
    slopeAt,
  );
  if (!vehicle.onGround) vehicle.position.addScaledVector(wind.velocity, dt);
  if (reason) crash(reason);
  else if (vehicle.onGround && terrain.isWater(vehicle.position.x, vehicle.position.z)) crash('Im Wasser gelandet – dafür bräuchte man ein Wasserflugzeug!');

  const ground = terrain.surfaceAt(vehicle.position.x, vehicle.position.z);
  const agl = vehicle.position.y - ground;

  if ((state as State) !== 'crashed') {
    if (hintShown && !vehicle.onGround) {
      hintShown = false;
      hud.setMessage('');
    }
    // Landung erkannt
    if (vehicle.onGround && !wasOnGround && state === 'flying') {
      sound.success();
      hud.popup('Gelandet ✓');
    }
    wasOnGround = vehicle.onGround;

    if (mode === 'coins') handleCoins();
    else if (mode === 'race') handleRace(dt);
    else if (mode === 'missions') handleMission(dt, agl);
    else {
      const d = Math.hypot(vehicle.position.x - airfield.center.x, vehicle.position.z - airfield.center.z);
      hud.setTopInfo('🕊 Freiflug', d > 600 ? 'Der Pfeil zeigt zum Flugplatz' : 'Flugplatz Unterwössen');
      pointTo(d > 600 ? airfield.center : undefined);
    }
    if ((state as State) !== 'crashed') handleTraffic();
  }

  // Gebietsgrenze
  const margin = terrain.outsideDistance(vehicle.position.x, vehicle.position.z);
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

  syncModel(dt);
  shadow.update(vehicle.position.x, vehicle.position.z, ground, agl, stats.size, (state as State) !== 'crashed');

  hud.setPlace(placeName(vehicle.position.x, vehicle.position.z));
  hud.update({
    speed: vehicle.speed,
    altitude: vehicle.position.y,
    aboveGround: agl,
    heading: vehicle.headingDeg,
    throttle: vehicle.throttle,
    stalled: vehicle.stalled,
    verticalSpeed: vehicle.verticalSpeed,
    onGround: vehicle.onGround,
  });
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);

  if (state !== 'menu' && !menu.visible) {
    if (input.wasPressed('KeyC') || touch.wasPressed('camera')) {
      cameraMode = cameraMode === 'chase' ? 'cockpit' : 'chase';
      model.model.visible = cameraMode === 'chase' && state !== 'crashed';
      if (cameraMode === 'chase') snapCamera();
    }
    if (input.wasPressed('KeyK')) hud.toggleControls();
    if (input.wasPressed('KeyI')) invertPitch = !invertPitch;
    if (input.wasPressed('KeyH') || touch.wasPressed('assist')) assist = !assist;
    if (input.wasPressed('KeyP') || input.wasPressed('Escape') || touch.wasPressed('pause')) paused = !paused;
    if (input.wasPressed('KeyT') || touch.wasPressed('speed')) {
      const options = [1, 1.5, 2, 3];
      timeScale = options[(options.indexOf(timeScale) + 1) % options.length];
      save.timeScale = timeScale;
      writeSave(save);
      showTimeScale();
      hud.popup(`⏩ ${String(timeScale).replace('.', ',')}×`);
    }
    if (input.wasPressed('Space') || touch.wasPressed('restart')) startFlight();
    if (input.wasPressed('KeyM') || touch.wasPressed('menu')) openMenu();
  }
  hud.setOptions(invertPitch, assist);
  const pauseText = '⏸ Pause\n' + (touch.enabled ? 'Tippe auf ⏸ zum Weiterfliegen' : 'P zum Weiterfliegen');
  if (paused && state !== 'menu') {
    hud.setMessage(pauseText);
    pauseShown = true;
  } else if (pauseShown) {
    hud.setMessage('');
    pauseShown = false;
  }

  const active = (state === 'flying' || state === 'finished') && !paused;
  if (active) {
    const newThrottle = touch.takeThrottle();
    if (newThrottle !== null) vehicle.throttle = newThrottle;
    // Zeitraffer: mehrere kleine Schritte statt einem großen (damit nichts durchrutscht)
    const steps = Math.ceil(timeScale);
    for (let i = 0; i < steps && (state === 'flying' || state === 'finished'); i++) simulate((dt * timeScale) / steps);
  }

  const engineKind = stats.kind === 'heli' ? 'heli' : model.flame ? 'jet' : 'prop';
  sound.engine(engineKind, vehicle.throttle, vehicle.speed, active && state !== 'crashed');

  if (!paused) {
    if (mode === 'coins') coins.update(dt * timeScale);
    traffic.update(dt * timeScale);
    explosion.update(dt * timeScale);
  }
  updateCamera(dt);
  terrainRenderer.update(camera.position);
  scenery.update(camera.position);
  sky.dome.position.copy(camera.position);
  renderer.render(scene, camera);
  touch.showThrottle(vehicle.throttle);
  input.endFrame();
  touch.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Zum Testen in der Browser-Konsole
(window as unknown as Record<string, unknown>).game = {
  camera, scene, terrain, scenery, coins, race, traffic, save, airfield, missions,
  get vehicle() { return vehicle; },
  get model() { return model; },
  get state() { return state; },
  get stats() { return stats; },
};
