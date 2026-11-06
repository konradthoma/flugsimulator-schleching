import * as THREE from 'three';
import { Terrain } from './terrain';
import { findFlatSpot, unevenness } from './places';
import { drapeMaterial } from './mapfeatures';

/** Mindestlänge der Bahn (m) */
const MIN_LENGTH = 620;
const WIDTH = 30;

/**
 * Flugplatz im Achental: Landebahn, Hubschrauberlandeplatz, Hangar und Windsack.
 * Liegt auf der echten Bahn des Segelflugplatzes Unterwössen (aus OpenStreetMap);
 * fehlt sie, wird ein möglichst ebener Platz gesucht.
 */
export class Airfield {
  readonly group = new THREE.Group();
  readonly center = new THREE.Vector3();
  /** Richtung der Landebahn (waagerecht, Länge 1) */
  readonly dir = new THREE.Vector3();
  readonly side = new THREE.Vector3();
  length = MIN_LENGTH;
  readonly width = WIDTH;
  readonly helipad: THREE.Vector3;
  private hangarPos = new THREE.Vector3();

  constructor(private terrain: Terrain) {
    if (!this.useRealRunway()) this.findRunway();
    this.side.set(-this.dir.z, 0, this.dir.x);

    // Hubschrauberlandeplatz neben der Bahn
    this.helipad = findFlatSpot(terrain, this.center.x, this.center.z, 70, 260, 16, (p) => this.distToRunway(p.x, p.z) > 45 && !terrain.isWater(p.x, p.z), 10);
    this.hangarPos.copy(this.center).addScaledVector(this.side, -55).addScaledVector(this.dir, -120);
    if (this.distTo(this.hangarPos, this.helipad) < 50) this.hangarPos.addScaledVector(this.dir, 160);

    this.buildRunway();
    this.buildHelipad();
    this.buildHangar();
    this.buildWindsock();
  }

  /** Anfang der Bahn (zum Starten), Blick entlang der Bahn. */
  get threshold(): THREE.Vector3 {
    return this.center.clone().addScaledVector(this.dir, -this.length / 2 + 40);
  }

  get heading(): number {
    return Math.atan2(-this.dir.x, -this.dir.z);
  }

  /** Liegt die Stelle auf dem Flugplatz (dort keine Häuser bauen)? */
  blocks(x: number, z: number): boolean {
    const p = new THREE.Vector3(x, 0, z);
    return this.distToRunway(x, z) < 25 || this.distTo(p, this.helipad) < 35 || this.distTo(p, this.hangarPos) < 45;
  }

  private distTo(a: THREE.Vector3, b: THREE.Vector3) {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  /** Abstand zur Landebahn-Fläche (0 = auf der Bahn) */
  private distToRunway(x: number, z: number): number {
    const dx = x - this.center.x;
    const dz = z - this.center.z;
    const along = Math.abs(dx * this.dir.x + dz * this.dir.z) - this.length / 2;
    const across = Math.abs(dx * this.side.x + dz * this.side.z) - WIDTH / 2;
    return Math.hypot(Math.max(0, along), Math.max(0, across));
  }

  /** Echte Landebahn in der Nähe von Schleching (mindestens 400 m lang) */
  private useRealRunway(): boolean {
    let best: { d: number; ax: number; az: number; bx: number; bz: number } | null = null;
    for (const r of this.terrain.features.runways) {
      const [ax, az] = r.a;
      const [bx, bz] = r.b;
      const len = Math.hypot(bx - ax, bz - az);
      const d = Math.hypot((ax + bx) / 2, (az + bz) / 2);
      if (len < 400 || d > 8000) continue;
      if (!best || d < best.d) best = { d, ax, az, bx, bz };
    }
    if (!best) return false;
    const len = Math.hypot(best.bx - best.ax, best.bz - best.az);
    this.length = Math.max(MIN_LENGTH, Math.round(len));
    this.dir.set((best.bx - best.ax) / len, 0, (best.bz - best.az) / len);
    const cx = (best.ax + best.bx) / 2;
    const cz = (best.az + best.bz) / 2;
    this.center.set(cx, this.terrain.heightAt(cx, cz), cz);
    return true;
  }

  private findRunway() {
    const t = this.terrain;
    let best = { score: Infinity, x: 0, z: 1500, a: 0 };
    for (let x = -4500; x <= 4500; x += 100) {
      for (let z = -4500; z <= 4500; z += 100) {
        const dist = Math.hypot(x, z);
        if (dist > 4500 || dist < 350) continue; // nicht mitten durchs Dorf
        if (unevenness(t, x, z, 60) > 5) continue;
        for (let deg = 0; deg < 180; deg += 15) {
          const a = THREE.MathUtils.degToRad(deg);
          const dx = Math.sin(a);
          const dz = -Math.cos(a);
          let min = Infinity;
          let max = -Infinity;
          for (let k = -10; k <= 10; k++) {
            for (const w of [-WIDTH / 2, 0, WIDTH / 2]) {
              const px = x + dx * (k * this.length) / 20 - dz * w;
              const pz = z + dz * (k * this.length) / 20 + dx * w;
              const h = t.heightAt(px, pz);
              min = Math.min(min, h);
              max = Math.max(max, h);
            }
          }
          // Anflug soll frei sein: 1,5 km vor beiden Enden nichts Hohes
          let approach = 0;
          for (const end of [-1, 1]) {
            for (let k = 1; k <= 6; k++) {
              const d = this.length / 2 + k * 250;
              approach = Math.max(approach, t.heightAt(x + dx * d * end, z + dz * d * end) - min - k * 25);
            }
          }
          const score = (max - min) * 10 + Math.max(0, approach) * 0.5 + dist / 400;
          if (score < best.score) best = { score, x, z, a };
        }
      }
    }
    this.dir.set(Math.sin(best.a), 0, -Math.cos(best.a));
    this.center.set(best.x, t.heightAt(best.x, best.z), best.z);
  }

  /** Fläche, die dem Gelände folgt (leicht darüber). */
  private drape(geo: THREE.BufferGeometry, lift: number) {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.terrain.heightAt(pos.getX(i), pos.getZ(i)) + lift);
    }
    geo.computeVertexNormals();
    return geo;
  }

  private buildRunway() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 1024;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#5d6166';
    g.fillRect(0, 0, 64, 1024);
    g.fillStyle = '#f4f4f0';
    g.fillRect(2, 0, 2, 1024); // Randlinien
    g.fillRect(60, 0, 2, 1024);
    for (let y = 70; y < 954; y += 48) g.fillRect(30, y, 4, 26); // Mittellinie
    for (const y of [8, 984]) for (let x = 8; x < 58; x += 7) g.fillRect(x, y, 4, 32); // Schwellen
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;

    const geo = new THREE.PlaneGeometry(WIDTH, this.length, 6, Math.round(this.length / 8)).rotateX(-Math.PI / 2);
    geo.rotateY(Math.atan2(-this.dir.x, -this.dir.z));
    geo.translate(this.center.x, 0, this.center.z);
    this.drape(geo, 0.45);
    const mesh = new THREE.Mesh(
      geo,
      drapeMaterial(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }), 0.5, 0.0016),
    );
    this.group.add(mesh);

    // Rasenstreifen rund um die Bahn
    const grass = new THREE.PlaneGeometry(WIDTH + 50, this.length + 80, 10, Math.round(this.length / 8)).rotateX(-Math.PI / 2);
    grass.rotateY(Math.atan2(-this.dir.x, -this.dir.z));
    grass.translate(this.center.x, 0, this.center.z);
    this.drape(grass, 0.3);
    this.group.add(
      new THREE.Mesh(grass, drapeMaterial(new THREE.MeshStandardMaterial({ color: '#6f9a45', roughness: 1 }), 0.2, 0.001)),
    );
  }

  private buildHelipad() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#4c5156';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#ffd23a';
    g.lineWidth = 14;
    g.beginPath();
    g.arc(128, 128, 104, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#ffffff';
    g.fillRect(78, 66, 26, 124);
    g.fillRect(152, 66, 26, 124);
    g.fillRect(104, 115, 48, 26);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;

    const geo = new THREE.CircleGeometry(15, 32).rotateX(-Math.PI / 2);
    geo.rotateY(Math.atan2(-this.dir.x, -this.dir.z));
    geo.translate(this.helipad.x, 0, this.helipad.z);
    this.drape(geo, 0.5);
    this.group.add(
      new THREE.Mesh(geo, drapeMaterial(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }), 0.5, 0.0016)),
    );
  }

  private buildHangar() {
    const hangar = new THREE.Group();
    const wall = new THREE.MeshStandardMaterial({ color: '#c9ced3', roughness: 0.8, flatShading: true });
    const roof = new THREE.MeshStandardMaterial({ color: '#7d2e24', roughness: 0.9, flatShading: true });
    hangar.add(new THREE.Mesh(new THREE.BoxGeometry(34, 8, 26).translate(0, 4, 0), wall));
    hangar.add(new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 34, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.55, 1).translate(0, 8, 0), roof));
    const door = new THREE.Mesh(new THREE.BoxGeometry(20, 7, 0.3), new THREE.MeshStandardMaterial({ color: '#3a4652', roughness: 0.6 }));
    door.position.set(0, 3.5, 13.1);
    hangar.add(door);
    hangar.position.set(this.hangarPos.x, this.terrain.heightAt(this.hangarPos.x, this.hangarPos.z) - 0.5, this.hangarPos.z);
    // Tor zeigt zur Bahn
    hangar.rotation.y = Math.atan2(this.side.x, this.side.z);
    this.group.add(hangar);
  }

  private buildWindsock() {
    const p = this.center.clone().addScaledVector(this.side, 40).addScaledVector(this.dir, this.length / 2 - 60);
    const sock = new THREE.Group();
    sock.add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 8, 6).translate(0, 4, 0), new THREE.MeshStandardMaterial({ color: '#dddddd' })));
    const cone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.35, 4, 8, 1, true).rotateZ(Math.PI / 2).translate(2.2, 7.6, 0),
      new THREE.MeshStandardMaterial({ color: '#ff6a1f', side: THREE.DoubleSide, flatShading: true }),
    );
    sock.add(cone);
    sock.position.set(p.x, this.terrain.heightAt(p.x, p.z), p.z);
    sock.rotation.y = 0.8;
    this.group.add(sock);
  }
}
