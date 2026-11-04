import * as THREE from 'three';
import { seededRandom } from '../util/noise';

export const HORIZON_COLOR = new THREE.Color('#cfe3f2');
const ZENITH_COLOR = new THREE.Color('#3f86d4');

/** Himmel mit Farbverlauf, Licht, Nebel und ein paar Wolken. */
export function createSky(scene: THREE.Scene): THREE.Mesh {
  scene.background = HORIZON_COLOR;
  scene.fog = new THREE.Fog(HORIZON_COLOR, 3000, 14000);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(18000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: ZENITH_COLOR }, bottom: { value: HORIZON_COLOR } },
      vertexShader: `
        varying float vH;
        void main() {
          vH = normalize(position).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 bottom; varying float vH;
        void main() {
          gl_FragColor = vec4(mix(bottom, top, smoothstep(0.0, 0.5, vH)), 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  dome.renderOrder = -1;
  scene.add(dome);

  scene.add(new THREE.HemisphereLight('#dfefff', '#5a6b3a', 1.2));
  const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
  sun.position.set(-0.5, 0.8, 0.6).normalize(); // Sonne im Süden
  scene.add(sun);

  // Wolken aus abgeflachten, kantigen Kugeln
  const rand = seededRandom(7);
  const cloudGeo = new THREE.IcosahedronGeometry(1, 0);
  const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1 });
  for (let i = 0; i < 45; i++) {
    const cloud = new THREE.Group();
    const cx = (rand() - 0.5) * 26000;
    const cz = (rand() - 0.5) * 26000;
    const cy = 2300 + rand() * 600;
    for (let p = 0; p < 5; p++) {
      const puff = new THREE.Mesh(cloudGeo, cloudMat);
      const s = 80 + rand() * 120;
      puff.scale.set(s * 1.6, s * 0.6, s);
      puff.position.set((rand() - 0.5) * 300, (rand() - 0.5) * 40, (rand() - 0.5) * 200);
      cloud.add(puff);
    }
    cloud.position.set(cx, cy, cz);
    scene.add(cloud);
  }
  return dome;
}
