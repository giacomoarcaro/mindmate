import * as THREE from 'three';
import type { Sky } from 'three/examples/jsm/objects/Sky.js';

const LAT = 18.68 * THREE.MathUtils.DEG2RAD;
const DECL = 8 * THREE.MathUtils.DEG2RAD;
/** 24 game hours in 20 real minutes */
export const HOURS_PER_SECOND = 24 / (20 * 60);

const FOG_DAY = new THREE.Color('#bcdcec');
const FOG_DUSK = new THREE.Color('#f0b48a');
const FOG_NIGHT = new THREE.Color('#0b1626');
const FOG_RAIN = new THREE.Color('#8d9aa3');
const HEMI_DAY = new THREE.Color('#cdeaff');
const HEMI_NIGHT = new THREE.Color('#304868');
const SUN_LOW = new THREE.Color('#ffb070');
const SUN_HIGH = new THREE.Color('#fff6e8');
const MOON = new THREE.Color('#9fb6e8');

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Day and night cycle: sun path for Bacalar's latitude (sunrise in the east over the
 * lagoon), sky, fog, light colors, stars, and a night factor for lamps and headlights.
 */
export class Atmosphere {
  hours = 9.5;
  readonly sunDir = new THREE.Vector3();
  /** 0 at noon-ish daylight, 1 at full night */
  night = 0;
  /** 0..1 daylight strength */
  day = 1;
  rain = 0;
  rainTarget = 0;
  /** shorter fog on phones, where fewer tiles are loaded */
  fogScale = 1;
  readonly fogColor = new THREE.Color();
  readonly stars: THREE.Points;
  readonly moon = new THREE.DirectionalLight(MOON, 0);
  private skipping = 0;

  constructor(
    private scene: THREE.Scene,
    private sky: Sky,
    private sun: THREE.DirectionalLight,
    private hemi: THREE.HemisphereLight,
    private renderer: THREE.WebGLRenderer,
  ) {
    const n = 2500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos[i * 3] = r * Math.cos(a) * 4000;
      pos[i * 3 + 1] = Math.abs(u) * 4000;
      pos[i * 3 + 2] = r * Math.sin(a) * 4000;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false;
    scene.add(this.stars, this.moon, this.moon.target);
    this.moon.castShadow = false;
  }

  /** Jump ahead in time (T key). Animated quickly rather than instantly. */
  skip(hours = 2) { this.skipping += hours; }

  clock(): string {
    const h = Math.floor(this.hours) % 24, m = Math.floor((this.hours % 1) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  update(dt: number, focus: THREE.Vector3) {
    let adv = dt * HOURS_PER_SECOND;
    if (this.skipping > 0) {
      const s = Math.min(this.skipping, dt * 4);
      this.skipping -= s;
      adv += s;
    }
    this.hours = (this.hours + adv) % 24;
    this.rain += (this.rainTarget - this.rain) * Math.min(1, dt * 0.6);

    // sun position: hour angle 0 at solar noon
    const H = ((this.hours - 12) / 24) * Math.PI * 2;
    const east = -Math.cos(DECL) * Math.sin(H);
    const north = Math.cos(LAT) * Math.sin(DECL) - Math.sin(LAT) * Math.cos(DECL) * Math.cos(H);
    const up = Math.sin(LAT) * Math.sin(DECL) + Math.cos(LAT) * Math.cos(DECL) * Math.cos(H);
    this.sunDir.set(east, up, -north).normalize();
    const elev = this.sunDir.y;

    this.day = smooth(-0.08, 0.18, elev);
    this.night = 1 - smooth(-0.12, 0.05, elev);
    const dusk = smooth(-0.12, 0.02, elev) * (1 - smooth(0.05, 0.3, elev));

    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.turbidity.value = 3 + this.rain * 12;
    u.rayleigh.value = 1.2 + dusk * 1.5 + this.rain * 1.5;
    u.mieCoefficient.value = 0.004 + this.rain * 0.01;

    // sun light
    const clouds = 1 - this.rain * 0.75;
    this.sun.intensity = 3.2 * this.day * clouds;
    this.sun.color.copy(SUN_LOW).lerp(SUN_HIGH, smooth(0.05, 0.45, elev));
    this.sun.visible = this.day > 0.01;
    // moon roughly opposite the sun
    this.moon.intensity = 0.35 * this.night * clouds;
    this.moon.position.copy(focus).addScaledVector(new THREE.Vector3(-this.sunDir.x, Math.abs(this.sunDir.y) + 0.3, -this.sunDir.z).normalize(), 300);
    this.moon.target.position.copy(focus);

    this.hemi.intensity = (0.45 + 0.75 * this.day) * (1 - this.rain * 0.3);
    this.hemi.color.copy(HEMI_NIGHT).lerp(HEMI_DAY, this.day);

    this.fogColor.copy(FOG_NIGHT).lerp(FOG_DAY, this.day).lerp(FOG_DUSK, dusk * 0.55).lerp(FOG_RAIN.clone().multiplyScalar(0.25 + 0.75 * this.day), this.rain * 0.85);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(this.fogColor);
    fog.near = (380 - this.rain * 300) * this.fogScale;
    fog.far = (1150 - this.rain * 700) * this.fogScale;
    this.renderer.setClearColor(this.fogColor);

    (this.stars.material as THREE.PointsMaterial).opacity = this.night * (1 - this.rain);
    this.stars.position.copy(focus);
    this.renderer.toneMappingExposure = 0.7 + 0.2 * this.day;
  }
}
