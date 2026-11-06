import * as THREE from 'three';
import { seededRandom } from '../util/noise';

export const HORIZON_COLOR = new THREE.Color('#cfe3f2');
const ZENITH_COLOR = new THREE.Color('#3f86d4');

export interface Sky {
  dome: THREE.Mesh;
  /** Abendstimmung ein/aus */
  setEvening(evening: boolean): void;
}

const LOOKS = {
  day: { horizon: '#cfe3f2', zenith: '#3f86d4', sun: '#fff4e0', sunI: 2.4, sky: '#dfefff', groundL: '#5a6b3a', hemiI: 1.2, sunPos: [-0.5, 0.8, 0.6], cloud: '#ffffff', cloudGlow: '#000000' },
  evening: { horizon: '#f2b483', zenith: '#34497e', sun: '#ffb37a', sunI: 2.0, sky: '#ffd3b0', groundL: '#4a3f3a', hemiI: 0.85, sunPos: [-0.85, 0.22, 0.45], cloud: '#ffd6c2', cloudGlow: '#7a5560' },
};

/** Himmel mit Farbverlauf, Licht, Nebel und ein paar Wolken. */
export function createSky(scene: THREE.Scene): Sky {
  scene.background = HORIZON_COLOR;
  scene.fog = new THREE.Fog(HORIZON_COLOR, 4000, 20000);

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

  const hemi = new THREE.HemisphereLight('#dfefff', '#5a6b3a', 1.2);
  scene.add(hemi);
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

  const fog = scene.fog as THREE.Fog;
  const uniforms = (dome.material as THREE.ShaderMaterial).uniforms;
  return {
    dome,
    setEvening(evening: boolean) {
      const l = evening ? LOOKS.evening : LOOKS.day;
      const horizon = new THREE.Color(l.horizon);
      scene.background = horizon;
      fog.color.copy(horizon);
      uniforms.bottom.value = horizon;
      uniforms.top.value = new THREE.Color(l.zenith);
      sun.color.set(l.sun);
      sun.intensity = l.sunI;
      sun.position.set(l.sunPos[0], l.sunPos[1], l.sunPos[2]).normalize();
      hemi.color.set(l.sky);
      hemi.groundColor.set(l.groundL);
      hemi.intensity = l.hemiI;
      cloudMat.color.set(l.cloud);
      cloudMat.emissive.set(l.cloudGlow);
    },
  };
}
