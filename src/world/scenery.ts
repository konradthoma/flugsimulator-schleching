import * as THREE from 'three';
import { fetchGz, LAND, Terrain } from './terrain';
import { hash2 } from '../util/noise';
import { isMajorRiver, isMajorRoad, RibbonBuilder, ribbonMaterial, RIVER_COLOR, RIVER_LIFT, ROAD_STYLE, splitByTile, subdivide } from './mapfeatures';

/**
 * Die nähere Umgebung: echte Gebäude (aus OpenStreetMap), Wald, kleine Straßen und Bäche.
 * Alles ist in Kacheln aufgeteilt und wird erst gebaut, wenn man in die Nähe kommt.
 */

const TILE = 2000;
/** Abstand der Baum-Kandidaten im Wald (m) */
const TREE_SPACING = 24;

const enum BType {
  House = 0,
  Barn = 1,
  Industrial = 2,
  Church = 3,
  Small = 4,
  Apartments = 5,
}

interface Building {
  x: number;
  z: number;
  len: number;
  wid: number;
  ang: number;
  height: number;
  type: BType;
  flat: boolean;
}

interface Tile {
  i: number;
  j: number;
  buildings: Building[];
  lines: { pts: number[]; w: number; color: THREE.Color; lift: number; river: boolean }[];
  built?: THREE.Group;
  trees?: THREE.Group;
}

const hex = (list: string[]) => list.map((c) => new THREE.Color(c));
const WALL = {
  house: hex(['#f4f0e6', '#f1e9d8', '#efe6d0', '#f7f3ec', '#eadfc8', '#f2ede2']),
  industrial: hex(['#cfccc4', '#bfc3c5', '#d8d2c4', '#c4bdb1']),
  wood: hex(['#7a5236', '#87603e', '#6b4a32', '#8f6a46']),
};
const ROOF = {
  house: hex(['#7b3f2b', '#8b4a33', '#5e4537', '#6c6e72', '#55463d', '#93533a', '#4f4b48']),
  barn: hex(['#6a5040', '#73706b', '#5d4a3d', '#7e6a58']),
  industrial: hex(['#8d8f92', '#7f8386', '#9a9c9e', '#6f7377']),
  church: hex(['#4e5257', '#5a4a40']),
  spire: hex(['#3f5f50', '#4b4f54', '#33463d']),
};
const PITCH = [24, 24, 10, 38, 18, 22].map((d) => Math.tan(THREE.MathUtils.degToRad(d)));

/** Satteldach: Grundfläche 1×1 (x = First-Richtung), Höhe 1 */
function roofGeometry() {
  const A = [-0.5, 0, -0.5];
  const B = [-0.5, 0, 0.5];
  const T = [-0.5, 1, 0];
  const A2 = [0.5, 0, -0.5];
  const B2 = [0.5, 0, 0.5];
  const T2 = [0.5, 1, 0];
  const tris = [
    [A, T, T2], [A, T2, A2], // Dachfläche Norden
    [B, B2, T2], [B, T2, T], // Dachfläche Süden
    [A, B, T], [A2, T2, B2], // Giebel
    [A, A2, B2], [A, B2, B], // Unterseite
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(2), 3));
  geo.computeVertexNormals();
  return geo;
}

/** Nadelbaum und Laubbaum (Stamm dunkel über Vertex-Farben) */
function treeGeometries() {
  const conifer = new THREE.ConeGeometry(5, 18, 6).translate(0, 8, 0);
  const crown = new THREE.IcosahedronGeometry(5.5, 0).scale(1, 1.15, 1).translate(0, 10, 0);
  const trunk = new THREE.CylinderGeometry(0.6, 0.8, 6, 5).translate(0, 3, 0);
  const paint = (g: THREE.BufferGeometry, v: number) => {
    const g2 = g.toNonIndexed();
    const c = new Float32Array(g2.attributes.position.count * 3).fill(v);
    g2.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g2.deleteAttribute('uv');
    return g2;
  };
  const merge = (parts: THREE.BufferGeometry[]) => {
    const pos: number[] = [];
    const col: number[] = [];
    const nor: number[] = [];
    for (const p of parts) {
      pos.push(...(p.attributes.position.array as Float32Array));
      col.push(...(p.attributes.color.array as Float32Array));
      nor.push(...(p.attributes.normal.array as Float32Array));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  };
  return {
    conifer: paint(conifer, 1),
    deciduous: merge([paint(crown, 1), paint(trunk, 0.45)]),
  };
}

export class Scenery {
  readonly group = new THREE.Group();
  private tiles = new Map<string, Tile>();
  private boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  private roofGeo = roofGeometry();
  private spireGeo = new THREE.ConeGeometry(0.75, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0);
  private trees = treeGeometries();
  private material = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1 });
  private treeMaterial = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1, vertexColors: true });
  private lineMaterial = ribbonMaterial();
  /** Anzahl Gebäude im ganzen Gebiet */
  readonly buildingCount: number;
  /** Bis zu dieser Entfernung (m) werden Gebäude und kleine Straßen gezeigt */
  private buildingRange: number;
  /** ... und Bäume */
  private treeRange: number;

  private constructor(
    private terrain: Terrain,
    buildings: Building[],
    private avoid: (x: number, z: number) => boolean,
    lowDetail: boolean,
  ) {
    this.buildingRange = lowDetail ? 5000 : 7000;
    this.treeRange = lowDetail ? 3200 : 4500;
    this.buildingCount = buildings.length;
    for (const b of buildings) this.tile(b.x, b.z).buildings.push(b);

    const f = terrain.features;
    const addLine = (pts: number[], w: number, color: THREE.Color, lift: number, river: boolean) =>
      splitByTile(subdivide(pts, 10), TILE, (key, piece) => {
        const [i, j] = key.split(',').map(Number);
        this.tileAt(i, j).lines.push({ pts: piece, w, color, lift, river });
      });
    for (const r of f.roads) if (!isMajorRoad(r.k)) addLine(r.pts, r.w, ROAD_STYLE[r.k].color, ROAD_STYLE[r.k].lift, false);
    for (const r of f.rivers) if (!isMajorRiver(r.w)) addLine(r.pts, r.w, RIVER_COLOR, RIVER_LIFT, true);
  }

  static async load(terrain: Terrain, name: string, avoid: (x: number, z: number) => boolean, lowDetail = false): Promise<Scenery> {
    const buf = await fetchGz(`${import.meta.env.BASE_URL}terrain/${name}-buildings.bin.gz`);
    const d = new Int16Array(buf);
    const buildings: Building[] = [];
    for (let i = 0; i + 7 < d.length; i += 8) {
      const x = d[i];
      const z = d[i + 1];
      if (avoid(x, z) || !terrain.isInside(x, z)) continue;
      buildings.push({
        x,
        z,
        len: d[i + 2] / 10,
        wid: d[i + 3] / 10,
        ang: (d[i + 4] + 15708) / 10000,
        height: d[i + 5] / 10,
        type: (d[i + 6] & 15) as BType,
        flat: (d[i + 6] & 16) !== 0,
      });
    }
    return new Scenery(terrain, buildings, avoid, lowDetail);
  }

  private tileAt(i: number, j: number): Tile {
    const key = `${i},${j}`;
    let t = this.tiles.get(key);
    if (!t) this.tiles.set(key, (t = { i, j, buildings: [], lines: [] }));
    return t;
  }

  private tile(x: number, z: number) {
    return this.tileAt(Math.floor(x / TILE), Math.floor(z / TILE));
  }

  /** Baut Kacheln in der Nähe, räumt weit entfernte weg. */
  update(camera: THREE.Vector3, maxBuilds = 1) {
    const t = this.terrain;
    const todo: { tile: Tile; dist: number; what: 'built' | 'trees' }[] = [];
    const i0 = Math.floor((camera.x - this.buildingRange) / TILE);
    const i1 = Math.floor((camera.x + this.buildingRange) / TILE);
    const j0 = Math.floor((camera.z - this.buildingRange) / TILE);
    const j1 = Math.floor((camera.z + this.buildingRange) / TILE);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if ((i + 1) * TILE < t.minX || i * TILE > t.maxX || (j + 1) * TILE < t.minZ || j * TILE > t.maxZ) continue;
        const tile = this.tileAt(i, j);
        const dist = this.distance(tile, camera);
        if (!tile.built && dist < this.buildingRange) todo.push({ tile, dist, what: 'built' });
        if (!tile.trees && dist < this.treeRange) todo.push({ tile, dist, what: 'trees' });
      }
    }
    // weit entfernte Kacheln freigeben
    for (const tile of this.tiles.values()) {
      if (!tile.built && !tile.trees) continue;
      const dist = this.distance(tile, camera);
      if (tile.built && dist > this.buildingRange + 1500) {
        this.dispose(tile.built);
        tile.built = undefined;
      }
      if (tile.trees && dist > this.treeRange + 1500) {
        this.dispose(tile.trees);
        tile.trees = undefined;
      }
    }
    todo.sort((a, b) => a.dist - b.dist);
    for (const { tile, what } of todo.slice(0, maxBuilds)) {
      if (what === 'built') tile.built = this.buildTile(tile);
      else tile.trees = this.buildTrees(tile);
      this.group.add(what === 'built' ? tile.built! : tile.trees!);
    }
    return todo.length;
  }

  buildAll(camera: THREE.Vector3) {
    while (this.update(camera, 50) > 0);
  }

  private distance(tile: Tile, p: THREE.Vector3) {
    const dx = Math.max(tile.i * TILE - p.x, 0, p.x - (tile.i + 1) * TILE);
    const dz = Math.max(tile.j * TILE - p.z, 0, p.z - (tile.j + 1) * TILE);
    return Math.hypot(dx, dz);
  }

  private dispose(group: THREE.Group) {
    this.group.remove(group);
    group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
      else if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }

  // ---------- Gebäude und kleine Straßen ----------

  private buildTile(tile: Tile): THREE.Group {
    const group = new THREE.Group();
    const t = this.terrain;

    if (tile.lines.length) {
      const rb = new RibbonBuilder(t, (x, z) => this.avoid(x, z) || !t.isInside(x, z));
      const skipRiver = (x: number, z: number) => this.avoid(x, z) || t.isLake(x, z);
      for (const l of tile.lines) rb.add(l.pts, l.w, l.color, l.lift, l.river ? skipRiver : undefined);
      if (!rb.empty) group.add(new THREE.Mesh(rb.build(), this.lineMaterial));
    }

    const list = tile.buildings;
    if (!list.length) return group;
    const churches = list.filter((b) => b.type === BType.Church).length;
    const walls = new THREE.InstancedMesh(this.boxGeo, this.material, list.length * 2 + churches);
    const roofs = new THREE.InstancedMesh(this.roofGeo, this.material, list.length);
    const spires = churches ? new THREE.InstancedMesh(this.spireGeo, this.material, churches) : null;
    let nw = 0;
    let nr = 0;
    let ns = 0;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const up = THREE.Object3D.DEFAULT_UP;
    const pick = (list: THREE.Color[], r: number) => list[Math.floor(r * list.length) % list.length];

    for (let k = 0; k < list.length; k++) {
      const b = list[k];
      const r1 = hash2(b.x, b.z);
      const r2 = hash2(b.z + 17, b.x - 5);
      const r3 = hash2(b.x * 3 + 1, b.z * 7 + 2);
      const dx = Math.cos(b.ang);
      const dz = Math.sin(b.ang);
      // Höhen an den Ecken: Haus steht am Hang auf einem Sockel
      let minH = Infinity;
      let maxH = -Infinity;
      for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [0, 0]]) {
        const h = t.heightAt(b.x + dx * u * b.len - dz * v * b.wid, b.z + dz * u * b.len + dx * v * b.wid);
        minH = Math.min(minH, h);
        maxH = Math.max(maxH, h);
      }
      const base = minH - 0.3;
      const plinth = maxH - minH + 0.3;
      const wallTop = base + plinth + b.height;
      q.setFromAxisAngle(up, -b.ang);

      const industrial = b.type === BType.Industrial;
      const wallColor = industrial ? pick(WALL.industrial, r1) : pick(WALL.house, r1);
      m.compose(pos.set(b.x, base, b.z), q, scale.set(b.len, plinth + b.height, b.wid));
      walls.setMatrixAt(nw, m);
      walls.setColorAt(nw++, wallColor);

      // Oberes Stockwerk aus Holz (typisch Chiemgau)
      const woodChance = b.type === BType.House ? 0.5 : b.type === BType.Barn ? 0.8 : 0;
      if (b.height >= 4.5 && r2 < woodChance) {
        m.compose(pos.set(b.x, base + plinth + b.height * 0.5, b.z), q, scale.set(b.len + 0.3, b.height * 0.5, b.wid + 0.3));
        walls.setMatrixAt(nw, m);
        walls.setColorAt(nw++, pick(WALL.wood, r3));
      }

      // Dach
      const roofH = b.flat ? 0.4 : Math.min((b.wid / 2) * PITCH[b.type], 9);
      const over = b.flat ? 0.2 : industrial ? 0.6 : 1.4;
      m.compose(pos.set(b.x, wallTop, b.z), q, scale.set(b.len + over, roofH, b.wid + over));
      roofs.setMatrixAt(nr, m);
      const roofColor =
        b.type === BType.Church ? pick(ROOF.church, r3) : industrial ? pick(ROOF.industrial, r3) : b.type === BType.Barn ? pick(ROOF.barn, r3) : pick(ROOF.house, r3);
      roofs.setColorAt(nr++, roofColor);

      // Kirchturm mit Spitze am Ende des Schiffs
      if (b.type === BType.Church && spires) {
        const s = Math.max(4, Math.min(b.wid * 0.45, 8));
        const off = b.len / 2 - s / 2;
        const tx = b.x - dx * off;
        const tz = b.z - dz * off;
        const towerH = plinth + b.height * 1.9 + 8;
        m.compose(pos.set(tx, base, tz), q, scale.set(s, towerH, s));
        walls.setMatrixAt(nw, m);
        walls.setColorAt(nw++, wallColor);
        m.compose(pos.set(tx, base + towerH, tz), q, scale.set(s * 1.25, s * 1.8, s * 1.25));
        spires.setMatrixAt(ns, m);
        spires.setColorAt(ns++, pick(ROOF.spire, r2));
      }
    }
    walls.count = nw;
    roofs.count = nr;
    for (const mesh of [walls, roofs, spires]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
    return group;
  }

  // ---------- Wald ----------

  /** Zusätzlich keine Bäume hier (z. B. Lava). Baut den Wald neu. */
  setTreeFilter(filter: ((x: number, z: number) => boolean) | null) {
    if (filter === this.treeFilter) return;
    this.treeFilter = filter;
    for (const tile of this.tiles.values()) {
      if (!tile.trees) continue;
      this.dispose(tile.trees);
      tile.trees = undefined;
    }
  }
  private treeFilter: ((x: number, z: number) => boolean) | null = null;

  private buildTrees(tile: Tile): THREE.Group {
    const group = new THREE.Group();
    const t = this.terrain;
    const n = TILE / TREE_SPACING;
    const conifers: THREE.Matrix4[] = [];
    const conColors: THREE.Color[] = [];
    const leafy: THREE.Matrix4[] = [];
    const leafColors: THREE.Color[] = [];
    const q = new THREE.Quaternion();
    const up = THREE.Object3D.DEFAULT_UP;

    for (let a = 0; a < n; a++) {
      for (let c = 0; c < n; c++) {
        const gi = tile.i * n + c;
        const gj = tile.j * n + a;
        const r1 = hash2(gi, gj);
        const r2 = hash2(gj + 911, gi - 77);
        const r3 = hash2(gi * 5 + 3, gj * 3 + 1);
        const x = (gi + r1) * TREE_SPACING;
        const z = (gj + r2) * TREE_SPACING;
        if (!t.isInside(x, z)) continue;
        const land = t.landAt(x, z);
        const bush = land === LAND.scrub;
        if (land !== LAND.forest && !bush) continue;
        if (bush && r3 > 0.6) continue;
        const h = t.heightAt(x, z);
        if (h > 1750 || this.avoid(x, z) || this.treeFilter?.(x, z)) continue;
        if (t.slopeAt(x, z, 10) > 1.15) continue;

        // Unten Mischwald, oben nur Fichten
        const leafChance = bush ? 0 : h < 700 ? 0.45 : h < 900 ? 0.3 : h < 1200 ? 0.12 : 0;
        const deciduous = r3 < leafChance;
        const s = bush ? 0.25 + r3 * 0.2 : (0.7 + r1 * 0.6) * (h > 1450 ? 0.75 : 1);
        q.setFromAxisAngle(up, r2 * Math.PI * 2);
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, h - 1, z), q, new THREE.Vector3(s, s * (0.9 + r2 * 0.3), s));
        const color = new THREE.Color();
        if (deciduous) {
          leafy.push(m);
          leafColors.push(color.setHSL(0.22 + r1 * 0.06, 0.45, 0.28 + r2 * 0.08));
        } else {
          conifers.push(m);
          conColors.push(color.setHSL(0.3 + r1 * 0.05, 0.45, (bush ? 0.17 : 0.2) + r2 * 0.08));
        }
      }
    }
    const make = (geo: THREE.BufferGeometry, mats: THREE.Matrix4[], colors: THREE.Color[]) => {
      if (!mats.length) return;
      const mesh = new THREE.InstancedMesh(geo, this.treeMaterial, mats.length);
      mats.forEach((m, k) => {
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, colors[k]);
      });
      mesh.computeBoundingSphere();
      group.add(mesh);
    };
    make(this.trees.conifer, conifers, conColors);
    make(this.trees.deciduous, leafy, leafColors);
    return group;
  }
}
