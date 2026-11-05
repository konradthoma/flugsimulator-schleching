import * as THREE from 'three';

/** Weicher Schatten unter dem Fluggerät – hilft sehr beim Landen. */
export class Shadow {
  readonly mesh: THREE.Mesh;
  private material: THREE.MeshBasicMaterial;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const g = canvas.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.85)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0.45)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.material = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.material);
    this.mesh.renderOrder = 2;
  }

  update(x: number, z: number, groundY: number, agl: number, size: number, visible: boolean) {
    this.mesh.visible = visible && agl < 250;
    if (!this.mesh.visible) return;
    this.mesh.position.set(x, groundY + 0.7, z);
    this.mesh.scale.setScalar(size * (1.1 + agl * 0.004));
    this.material.opacity = THREE.MathUtils.clamp(1 - agl / 250, 0, 1) * 0.6;
  }
}

/** Kleine Explosion mit Rauch nach einem Absturz. */
export class Explosion {
  readonly group = new THREE.Group();
  private parts: { mesh: THREE.Mesh; vel: THREE.Vector3; spin: number }[] = [];
  private age = 0;
  private fire = new THREE.MeshBasicMaterial({ color: '#ff9a2e', transparent: true, depthWrite: false });
  private smoke = new THREE.MeshStandardMaterial({ color: '#555b60', transparent: true, depthWrite: false, flatShading: true });

  constructor() {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    for (let i = 0; i < 26; i++) {
      const isFire = i < 12;
      const mesh = new THREE.Mesh(geo, isFire ? this.fire : this.smoke);
      this.group.add(mesh);
      this.parts.push({ mesh, vel: new THREE.Vector3(), spin: 0 });
    }
    this.group.visible = false;
  }

  trigger(at: THREE.Vector3) {
    this.age = 0;
    this.group.visible = true;
    this.group.position.copy(at);
    this.parts.forEach((p, i) => {
      const isFire = i < 12;
      p.mesh.position.set(0, 0, 0);
      p.vel.set((Math.random() - 0.5) * 2, Math.random() * 0.8 + (isFire ? 0.3 : 0.6), (Math.random() - 0.5) * 2).multiplyScalar(isFire ? 22 : 9);
      p.spin = Math.random() * 3;
      p.mesh.scale.setScalar(isFire ? 2.5 + Math.random() * 2 : 3 + Math.random() * 3);
    });
  }

  update(dt: number) {
    if (!this.group.visible) return;
    this.age += dt;
    this.fire.opacity = Math.max(0, 1 - this.age / 1.2);
    this.smoke.opacity = Math.max(0, 0.8 - this.age / 5);
    this.parts.forEach((p, i) => {
      const isFire = i < 12;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.exp(-dt * (isFire ? 2.5 : 1.2)));
      if (!isFire) p.vel.y += dt * 2;
      p.mesh.rotation.x += p.spin * dt;
      p.mesh.scale.multiplyScalar(1 + dt * (isFire ? 0.6 : 0.5));
    });
    if (this.age > 5) this.group.visible = false;
  }
}

/** Böiger Wind: weiche, zufällige Windstöße (m/s). */
export class Wind {
  readonly velocity = new THREE.Vector3();
  private t = Math.random() * 100;

  update(dt: number, enabled: boolean) {
    if (!enabled) {
      this.velocity.set(0, 0, 0);
      return;
    }
    this.t += dt;
    const t = this.t;
    const gust = Math.max(0, Math.sin(t * 0.21) + Math.sin(t * 0.53 + 1) * 0.6);
    this.velocity.set(
      Math.sin(t * 0.13) * 3 + Math.sin(t * 1.7) * 1.4 * gust,
      Math.sin(t * 0.9 + 2) * 1.1 * gust + Math.sin(t * 2.3) * 0.5,
      Math.cos(t * 0.11) * 3 + Math.cos(t * 1.3 + 0.5) * 1.4 * gust,
    );
  }
}
