import * as THREE from 'three';
import { Terrain } from '../world/terrain';
import { Airfield } from '../world/airfield';
import { findFlatSpot, findSummits } from '../world/places';
import { VehiclePhysics } from '../vehicles/vehicle';

export type StepKind = 'land' | 'drop' | 'hover' | 'gate' | 'over';

export interface MissionStep {
  kind: StepKind;
  position: THREE.Vector3;
  radius: number;
  /** Anzeige oben, z. B. "Lande auf dem Flugplatz" */
  label: string;
  /** Höchstens so hoch über Grund (für drop/hover) */
  maxAgl?: number;
  /** So lange schweben (s) */
  hoverTime?: number;
  /** Text, wenn geschafft */
  done: string;
}

export interface Mission {
  id: string;
  name: string;
  description: string;
  reward: number;
  heliOnly?: boolean;
  start: { position: THREE.Vector3; heading: number; onGround: boolean };
  steps: MissionStep[];
  /** Ganze Mission unter dieser Höhe über Grund fliegen */
  maxAgl?: number;
}

export type MissionEvent =
  | { type: 'step'; text: string }
  | { type: 'done'; time: number }
  | { type: 'fail'; reason: string };

const COLORS: Record<StepKind, string> = {
  land: '#3ddc5a',
  drop: '#ff8a1f',
  hover: '#ff4f6a',
  gate: '#3fd0ff',
  over: '#ffd23a',
};

/** Alle Missionen und ihr Ablauf. */
export class Missions {
  readonly list: Mission[] = [];
  readonly group = new THREE.Group();
  /** Hütte und Wanderer (Deko) */
  readonly decor = new THREE.Group();

  mission: Mission | null = null;
  index = 0;
  elapsed = 0;
  hoverProgress = 0;
  tooHighTime = 0;
  finished = false;

  /** Stellen, an denen keine Bäume stehen sollen */
  readonly keepClear: THREE.Vector3[] = [];
  private markers: THREE.Group[] = [];
  private hiker: THREE.Group;
  private pulse = 0;

  constructor(
    private terrain: Terrain,
    airfield: Airfield,
  ) {
    const t = terrain;
    const summits = findSummits(t);
    const geigel = summits.find((s) => s.name === 'Geigelstein') ?? summits[0];
    const S = geigel.position;

    const runway = airfield.center.clone();
    const runwayStart = airfield.threshold;
    runwayStart.y = t.heightAt(runwayStart.x, runwayStart.z);
    const helipad = airfield.helipad.clone();
    const summitPad = findFlatSpot(t, S.x, S.z, 0, 180, 9, (p) => p.y > S.y - 45, 10);
    const hut = findFlatSpot(t, S.x, S.z, 350, 1000, 14, (p) => p.y > S.y - 450 && p.y < S.y - 120, 20);
    const hikerSpot = findFlatSpot(t, S.x, S.z, 500, 1100, 5, (p) => p.y > 1450 && p.y < S.y - 80 && t.slopeAt(p.x, p.z) < 0.5, 25);

    const air = (p: THREE.Vector3, agl: number) => new THREE.Vector3(p.x, t.heightAt(p.x, p.z) + agl, p.z);
    const toward = (from: THREE.Vector3, to: THREE.Vector3) => Math.atan2(-(to.x - from.x), -(to.z - from.z));

    // 1. Erste Landung
    const approach = runway.clone().addScaledVector(airfield.dir, -2800);
    this.list.push({
      id: 'landung',
      name: '🛬 Erste Landung',
      description: 'Flieg zum Flugplatz und lande auf der Landebahn. Langsam sinken, Flügel waagerecht!',
      reward: 40,
      start: { position: air(approach, 260), heading: airfield.heading, onGround: false },
      steps: [{ kind: 'land', position: runway, radius: airfield.length / 2 + 20, label: 'Lande auf dem Flugplatz und bleib stehen', done: 'Gelandet!' }],
    });

    // 2. Paketdienst
    this.list.push({
      id: 'paket',
      name: '📦 Paketdienst',
      description: 'Starte am Flugplatz und bring ein Paket zur Hütte am Geigelstein. Tief anfliegen! Danach zurück und landen.',
      reward: 60,
      start: { position: runwayStart.clone(), heading: airfield.heading, onGround: true },
      steps: [
        { kind: 'drop', position: hut, radius: 70, maxAgl: 90, hoverTime: 1.5, label: 'Bring das Paket zur Hütte – tief anfliegen (unter 90 m)', done: 'Paket abgeliefert! 📦' },
        { kind: 'land', position: runway, radius: airfield.length / 2 + 20, label: 'Flieg zurück und lande auf dem Flugplatz', done: 'Gelandet!' },
      ],
    });

    // 3. Tiefflug durchs Tal
    const gates = this.planValley(runway, airfield.dir, 9, 650);
    const firstGate = gates[0];
    const back = new THREE.Vector3().subVectors(gates[0], gates[1]).setY(0).normalize();
    const startLow = firstGate.clone().addScaledVector(back, 650);
    this.list.push({
      id: 'tiefflug',
      name: '🏞 Tiefflug im Tal',
      description: 'Flieg durch alle Tore, ohne höher als 180 m über dem Boden zu steigen.',
      reward: 70,
      maxAgl: 180,
      start: { position: air(startLow, 110), heading: toward(startLow, firstGate), onGround: false },
      steps: gates.map((g, i) => ({
        kind: 'gate' as const,
        position: g,
        radius: 90,
        label: `Tor ${i + 1} von ${gates.length} – bleib unter 180 m über Grund`,
        done: i === gates.length - 1 ? 'Alle Tore!' : `${i + 1}/${gates.length}`,
      })),
    });

    // 4. Gipfeltour
    const tourStart = air(runway, 450);
    this.list.push({
      id: 'gipfel',
      name: '⛰ Gipfeltour',
      description: `Überfliege ${summits.map((s) => s.name).join(', ')} – immer höher als der Gipfel.`,
      reward: 80,
      start: { position: tourStart, heading: toward(tourStart, summits[0].position), onGround: false },
      steps: summits.map((s) => ({
        kind: 'over' as const,
        position: s.position.clone(),
        radius: 320,
        label: `Überfliege den ${s.name} (${Math.round(s.position.y)} m)`,
        done: `${s.name} ✓`,
      })),
    });

    // 5. Bergrettung (nur Hubschrauber)
    this.list.push({
      id: 'rettung',
      name: '⛑ Bergrettung',
      description: 'Ein Wanderer hat sich am Geigelstein verletzt. Schwebe tief über ihm, bis er an Bord ist, und bring ihn zum Landeplatz.',
      reward: 120,
      heliOnly: true,
      start: { position: helipad.clone(), heading: toward(helipad, hikerSpot), onGround: true },
      steps: [
        { kind: 'hover', position: hikerSpot, radius: 30, maxAgl: 35, hoverTime: 3, label: 'Schwebe tief über dem Wanderer (unter 35 m, langsam)', done: 'Wanderer an Bord! ⛑' },
        { kind: 'land', position: helipad, radius: 22, label: 'Bring ihn zum Hubschrauber-Landeplatz (H) und lande', done: 'Gerettet!' },
      ],
    });

    // 6. Gipfellandung (nur Hubschrauber)
    this.list.push({
      id: 'gipfellandung',
      name: '🚁 Gipfellandung',
      description: 'Lande auf dem Gipfel des Geigelsteins und flieg danach zurück zum Landeplatz.',
      reward: 100,
      heliOnly: true,
      start: { position: helipad.clone(), heading: toward(helipad, summitPad), onGround: true },
      steps: [
        { kind: 'land', position: summitPad, radius: 30, label: `Lande auf dem Geigelstein (${Math.round(S.y)} m)`, done: 'Auf dem Gipfel! 🏔' },
        { kind: 'land', position: helipad, radius: 22, label: 'Flieg zurück und lande auf dem Landeplatz (H)', done: 'Gelandet!' },
      ],
    });

    this.keepClear.push(hut, summitPad, hikerSpot);
    this.buildHut(hut);
    this.hiker = this.buildHiker(hikerSpot);
    this.hiker.visible = false;
  }

  /** Tore entlang des Tals: immer in die Richtung, wo es am tiefsten ist. */
  private planValley(start: THREE.Vector3, startDir: THREE.Vector3, count: number, spacing: number): THREE.Vector3[] {
    const t = this.terrain;
    const limit = t.half - 1500;
    let dir = Math.atan2(startDir.x, -startDir.z);
    // in die Richtung starten, in der das Tal länger tief bleibt
    const valleyScore = (d: number) => {
      let sum = 0;
      for (let k = 1; k <= 8; k++) sum += t.heightAt(start.x + Math.sin(d) * k * 400, start.z - Math.cos(d) * k * 400);
      return sum;
    };
    if (valleyScore(dir + Math.PI) < valleyScore(dir)) dir += Math.PI;
    const pts: THREE.Vector2[] = [new THREE.Vector2(start.x + Math.sin(dir) * 500, start.z - Math.cos(dir) * 500)];
    for (let i = 1; i < count; i++) {
      const p = pts[i - 1];
      let best: { pt: THREE.Vector2; dir: number; cost: number } | null = null;
      for (const turn of [-40, -25, -12, 0, 12, 25, 40]) {
        const d = dir + THREE.MathUtils.degToRad(turn);
        const pt = new THREE.Vector2(p.x + Math.sin(d) * spacing, p.y - Math.cos(d) * spacing);
        if (Math.abs(pt.x) > limit || Math.abs(pt.y) > limit) continue;
        let cost = t.heightAt(pt.x, pt.y) + Math.abs(turn) * 1.5;
        for (const q of pts.slice(0, -1)) if (q.distanceTo(pt) < spacing) cost += 2000;
        if (!best || cost < best.cost) best = { pt, dir: d, cost };
      }
      if (!best) break;
      pts.push(best.pt);
      dir = best.dir;
    }
    return pts.map((p) => new THREE.Vector3(p.x, t.heightAt(p.x, p.y), p.y));
  }

  private buildHut(p: THREE.Vector3) {
    const hut = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: '#8a5a35', roughness: 1, flatShading: true });
    const roof = new THREE.MeshStandardMaterial({ color: '#5b5f63', roughness: 1, flatShading: true });
    hut.add(new THREE.Mesh(new THREE.BoxGeometry(12, 6, 9).translate(0, 3, 0), wood));
    hut.add(
      new THREE.Mesh(
        new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-7.5, 0), new THREE.Vector2(7.5, 0), new THREE.Vector2(0, 4)]), { depth: 11, bevelEnabled: false }).translate(0, 6, -5.5),
        roof,
      ),
    );
    hut.add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 9, 5).translate(8, 4.5, 3), new THREE.MeshStandardMaterial({ color: '#ddd' })));
    const flag = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 0.05), new THREE.MeshStandardMaterial({ color: '#2f7fd6' }));
    flag.position.set(9.2, 8.2, 3);
    hut.add(flag);
    hut.position.set(p.x, p.y - 0.5, p.z);
    hut.rotation.y = 0.6;
    this.decor.add(hut);
  }

  private buildHiker(p: THREE.Vector3) {
    const g = new THREE.Group();
    const orange = new THREE.MeshStandardMaterial({ color: '#ff6a1f', emissive: '#ff4a00', emissiveIntensity: 0.4 });
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.2, 0.5).translate(0, 0.9, 0), orange));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6).translate(0, 1.8, 0), new THREE.MeshStandardMaterial({ color: '#f1c7a5' })));
    // rote Decke, damit man ihn von oben sieht
    g.add(new THREE.Mesh(new THREE.BoxGeometry(5, 0.1, 3), new THREE.MeshStandardMaterial({ color: '#e0302a' })));
    g.position.set(p.x, p.y, p.z);
    this.decor.add(g);
    return g;
  }

  /** Hier keine Bäume */
  blocks(x: number, z: number): boolean {
    return this.keepClear.some((p) => Math.hypot(p.x - x, p.z - z) < 35);
  }

  get step(): MissionStep | undefined {
    return this.mission?.steps[this.index];
  }

  begin(m: Mission) {
    this.mission = m;
    this.index = 0;
    this.elapsed = 0;
    this.hoverProgress = 0;
    this.tooHighTime = 0;
    this.finished = false;
    this.hiker.visible = m.id === 'rettung';
    for (const marker of this.markers) this.group.remove(marker);
    this.markers = m.steps.map((s) => this.buildMarker(s, m.maxAgl));
    this.group.add(...this.markers);
    this.refreshMarkers();
  }

  stop() {
    this.mission = null;
    this.hiker.visible = false;
    for (const marker of this.markers) this.group.remove(marker);
    this.markers = [];
  }

  private buildMarker(s: MissionStep, maxAgl?: number): THREE.Group {
    const g = new THREE.Group();
    const color = COLORS[s.kind];
    const glow = (opacity: number) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    if (s.kind === 'gate') {
      // Röhre vom Boden bis zur erlaubten Höhe
      const h = maxAgl ?? 200;
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(s.radius, s.radius, h, 32, 1, true).translate(0, h / 2, 0), glow(0.16)));
      g.add(new THREE.Mesh(new THREE.TorusGeometry(s.radius, 2.5, 6, 40).rotateX(Math.PI / 2).translate(0, h, 0), glow(0.8)));
      g.add(new THREE.Mesh(new THREE.TorusGeometry(s.radius, 2.5, 6, 40).rotateX(Math.PI / 2).translate(0, 3, 0), glow(0.8)));
    } else {
      const beamH = s.kind === 'over' ? 500 : 900;
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(Math.min(s.radius * 0.3, 18), Math.min(s.radius * 0.4, 24), beamH, 12, 1, true).translate(0, beamH / 2, 0), glow(0.4)));
      const ring = new THREE.Mesh(new THREE.RingGeometry(s.radius - Math.max(2, s.radius * 0.06), s.radius, 48).rotateX(-Math.PI / 2), glow(0.85));
      ring.position.y = s.kind === 'over' ? 10 : 1.5;
      g.add(ring);
      if (s.kind === 'drop' || s.kind === 'hover') {
        const top = s.maxAgl ?? 50;
        const ceiling = new THREE.Mesh(new THREE.TorusGeometry(s.radius, 1.5, 6, 40).rotateX(Math.PI / 2).translate(0, top, 0), glow(0.6));
        g.add(ceiling);
      }
    }
    g.position.copy(s.position);
    return g;
  }

  private refreshMarkers() {
    this.markers.forEach((m, i) => {
      m.visible = i === this.index || i === this.index + 1;
      m.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
        if (mat && 'opacity' in mat) {
          mat.userData.base ??= mat.opacity;
          mat.opacity = mat.userData.base * (i === this.index ? 1 : 0.3);
        }
      });
    });
  }

  /** Prüft den aktuellen Schritt. */
  update(dt: number, from: THREE.Vector3, v: VehiclePhysics, agl: number): MissionEvent | null {
    const m = this.mission;
    const s = this.step;
    this.pulse += dt;
    if (this.markers[this.index]) this.markers[this.index].scale.setScalar(1 + Math.sin(this.pulse * 4) * 0.03);
    if (!m || !s || this.finished) return null;
    this.elapsed += dt;

    // Höhenbegrenzung
    if (m.maxAgl !== undefined) {
      if (agl > m.maxAgl) {
        this.tooHighTime += dt;
        if (this.tooHighTime > 3) return { type: 'fail', reason: 'Zu hoch geflogen!' };
      } else this.tooHighTime = 0;
    }

    const p = v.position;
    const dist = Math.hypot(p.x - s.position.x, p.z - s.position.z);
    let reached = false;
    switch (s.kind) {
      case 'land':
        reached = v.onGround && v.speed < 3 && dist < s.radius;
        break;
      case 'over':
        reached = dist < s.radius && p.y > s.position.y + 10;
        break;
      case 'gate': {
        // Abstand der Flugstrecke (von -> nach) zur Tormitte, von oben gesehen
        const ax = from.x - s.position.x;
        const az = from.z - s.position.z;
        const bx = p.x - from.x;
        const bz = p.z - from.z;
        const len2 = bx * bx + bz * bz;
        const k = len2 > 0 ? THREE.MathUtils.clamp(-(ax * bx + az * bz) / len2, 0, 1) : 0;
        reached = Math.hypot(ax + bx * k, az + bz * k) < s.radius;
        break;
      }
      case 'drop':
      case 'hover': {
        const inside = dist < s.radius && agl < (s.maxAgl ?? 50);
        if (s.kind === 'drop' && v.kind === 'plane') {
          reached = inside;
        } else {
          const slow = v.speed < (s.kind === 'drop' ? 10 : 6);
          this.hoverProgress = inside && slow ? this.hoverProgress + dt : Math.max(0, this.hoverProgress - dt * 2);
          reached = this.hoverProgress >= (s.hoverTime ?? 2);
        }
        break;
      }
    }
    if (!reached) return null;

    this.index++;
    this.hoverProgress = 0;
    if (s.kind === 'hover') this.hiker.visible = false;
    if (this.index >= m.steps.length) {
      this.finished = true;
      this.refreshMarkers();
      return { type: 'done', time: this.elapsed };
    }
    this.refreshMarkers();
    return { type: 'step', text: s.done };
  }

  /** Ziel für den Wegweiser-Pfeil */
  get target(): THREE.Vector3 | undefined {
    return this.step?.position;
  }

  /** Text unter der großen Anzeige */
  statusText(agl: number): string {
    const s = this.step;
    if (!s) return '';
    let text = s.label;
    if ((s.kind === 'hover' || s.kind === 'drop') && this.hoverProgress > 0) {
      text += ` · ${Math.round((this.hoverProgress / (s.hoverTime ?? 2)) * 100)} %`;
    }
    const m = this.mission;
    if (m?.maxAgl !== undefined && agl > m.maxAgl) text = `⚠ Zu hoch! Runter unter ${m.maxAgl} m über Grund (${Math.max(0, 3 - this.tooHighTime).toFixed(1)})`;
    return text;
  }
}
