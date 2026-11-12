import * as THREE from 'three';
import { BRAND, LOGO_ASPECT, canvasTexture, drawLogoWide } from '../gym/brand';

/** Procedural low-poly vehicle and character models. Forward is -Z, up is +Y. */

const std = (color: string | number, opts: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, ...opts });

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function cyl(rt: number, rb: number, h: number, mat: THREE.Material, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.castShadow = true;
  return m;
}

export interface VehicleModel {
  root: THREE.Group;
  /** emissive head light materials, brightened at night */
  lights: THREE.MeshStandardMaterial[];
  brakeLights: THREE.MeshStandardMaterial[];
  /** wheel template; one clone per wheel */
  wheel?: THREE.Object3D;
}

export function makeWheel(radius: number, width: number, rimColor = '#c9c9c9') {
  const g = new THREE.Group();
  const tire = cyl(radius, radius, width, std('#1c1c1c', { roughness: 0.9 }), 16);
  tire.rotation.z = Math.PI / 2;
  const rim = cyl(radius * 0.6, radius * 0.6, width + 0.02, std(rimColor, { metalness: 0.6, roughness: 0.35 }), 8);
  rim.rotation.z = Math.PI / 2;
  const hub = box(width + 0.04, radius * 0.25, radius * 0.25, std('#555'));
  g.add(tire, rim, hub);
  return g;
}

let logoMat: THREE.MeshBasicMaterial | null = null;
/** Round gym logo decal, shared by all vehicles. */
/**
 * Official logo decal; `size` is its height in meters, width follows the logo's proportions.
 * Single sided (reads correctly from its front, +Z of the plane); use logoBoard for both sides.
 */
function logoDecal(size: number) {
  if (!logoMat) logoMat = new THREE.MeshBasicMaterial({ map: canvasTexture(drawLogoWide(512)), transparent: true, alphaTest: 0.05 });
  return new THREE.Mesh(new THREE.PlaneGeometry(size * LOGO_ASPECT(), size), logoMat);
}

/** Two back-to-back decals so the logo reads correctly from both sides. */
function logoBoard(size: number) {
  const g = new THREE.Group();
  const front = logoDecal(size);
  front.position.z = 0.01;
  const back = logoDecal(size);
  back.rotation.y = Math.PI;
  back.position.z = -0.01;
  g.add(front, back);
  return g;
}

/** Decal facing outward on the side of a vehicle (sx < 0 left, sx > 0 right). */
function sideDecal(size: number, sx: number) {
  const d = logoDecal(size);
  d.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
  return d;
}

/** Brownie, the gym dog, riding along. */
function brownie() {
  const g = new THREE.Group();
  const fur = std('#7b4a26', { roughness: 0.9 });
  const dark = std('#3a2212', { roughness: 0.9 });
  g.add(box(0.3, 0.34, 0.42, fur, 0, 0.17, 0));
  g.add(box(0.26, 0.24, 0.26, fur, 0, 0.46, -0.16));
  g.add(box(0.14, 0.1, 0.14, fur, 0, 0.42, -0.34));
  g.add(box(0.06, 0.05, 0.05, dark, 0, 0.45, -0.42));
  g.add(box(0.07, 0.14, 0.05, dark, -0.12, 0.56, -0.1));
  g.add(box(0.07, 0.14, 0.05, dark, 0.12, 0.56, -0.1));
  g.add(box(0.28, 0.05, 0.28, std(BRAND.pink), 0, 0.33, -0.15));
  return g;
}

export function jeepModel(color = BRAND.lime, livery = true): VehicleModel {
  const root = new THREE.Group();
  const paint = std(color, { roughness: 0.45, metalness: 0.25 });
  const black = std('#222', { roughness: 0.8 });
  const dark = std('#333', { roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: '#9fc4d6', roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.45 });
  const head = std('#fffbe6', { emissive: '#fff3c0', emissiveIntensity: 0.2 });
  const tail = std('#7a0b0b', { emissive: '#ff2020', emissiveIntensity: 0.2 });

  // tub and hood
  root.add(box(1.72, 0.62, 3.0, paint, 0, 0.55, 0.35));
  root.add(box(1.6, 0.5, 1.25, paint, 0, 0.62, -1.62));
  // gym livery: pink stripe, logo on the doors and the hood, Brownie in the passenger seat
  if (livery) {
  root.add(box(1.74, 0.1, 3.02, std(BRAND.pink, { roughness: 0.45 }), 0, 0.72, 0.35));
  for (const sx of [-0.875, 0.875]) {
    const d = sideDecal(0.52, sx);
    d.position.set(sx, 0.55, 0.3);
    root.add(d);
  }
  // on the hood, readable from the driver's seat and the chase camera behind
  const hoodLogo = logoDecal(0.78);
  hoodLogo.rotation.set(-Math.PI / 2, Math.PI, 0, 'YXZ');
  hoodLogo.position.set(0, 0.875, -1.6);
  root.add(hoodLogo);
  // roof sign on the roll bar, readable from both sides
  const roofSign = logoBoard(0.62);
  roofSign.position.set(0, 1.98, 0.35);
  root.add(roofSign);
  root.add(box(0.05, 0.36, 0.05, std('#222'), -0.3, 1.76, 0.35));
  root.add(box(0.05, 0.36, 0.05, std('#222'), 0.3, 1.76, 0.35));
  }
  const dog = brownie();
  dog.position.set(0.42, 0.96, -0.2);
  root.add(dog);
  // grille with seven slots
  root.add(box(1.4, 0.55, 0.08, dark, 0, 0.62, -2.27));
  for (let i = 0; i < 7; i++) root.add(box(0.07, 0.42, 0.04, black, -0.42 + i * 0.14, 0.62, -2.32));
  // round headlights
  for (const sx of [-0.56, 0.56]) {
    const l = cyl(0.13, 0.13, 0.08, head, 14);
    l.rotation.x = Math.PI / 2;
    l.position.set(sx, 0.68, -2.31);
    root.add(l);
  }
  // fenders
  for (const sx of [-0.92, 0.92]) {
    root.add(box(0.32, 0.08, 0.95, black, sx, 0.88, -1.45));
    root.add(box(0.32, 0.08, 0.95, black, sx, 0.88, 1.2));
  }
  // bumpers
  root.add(box(1.9, 0.18, 0.18, black, 0, 0.32, -2.36));
  root.add(box(1.9, 0.18, 0.18, black, 0, 0.32, 1.93));
  // windshield
  root.add(box(1.6, 0.06, 0.06, paint, 0, 1.47, -0.92));
  for (const sx of [-0.78, 0.78]) {
    const p = box(0.06, 0.62, 0.06, paint, sx, 1.17, -0.92);
    root.add(p);
  }
  const ws = box(1.5, 0.56, 0.02, glass, 0, 1.17, -0.92);
  ws.castShadow = false;
  root.add(ws);
  // roll bar
  for (const sx of [-0.75, 0.75]) root.add(box(0.07, 0.75, 0.07, black, sx, 1.2, 0.35));
  root.add(box(1.57, 0.07, 0.07, black, 0, 1.56, 0.35));
  for (const sx of [-0.75, 0.75]) root.add(box(0.07, 0.07, 1.25, black, sx, 1.56, -0.28));
  // seats
  for (const sx of [-0.42, 0.42]) {
    root.add(box(0.5, 0.12, 0.5, dark, sx, 0.9, -0.2));
    root.add(box(0.5, 0.6, 0.1, dark, sx, 1.18, 0.07));
  }
  root.add(box(1.35, 0.12, 0.55, dark, 0, 0.9, 0.95));
  // spare tire
  const spare = makeWheel(0.4, 0.26);
  spare.rotation.y = Math.PI / 2;
  spare.position.set(0, 0.85, 2.0);
  root.add(spare);
  // tail lights
  for (const sx of [-0.78, 0.78]) root.add(box(0.12, 0.18, 0.04, tail, sx, 0.68, 1.86));

  return { root, lights: [head], brakeLights: [tail], wheel: makeWheel(0.42, 0.3) };
}

export function motoTaxiModel(color = BRAND.lime, livery = true): VehicleModel {
  const root = new THREE.Group();
  const paint = std(color, { roughness: 0.4, metalness: 0.3 });
  const white = std('#f2f2f2');
  const black = std('#1d1d1d', { roughness: 0.8 });
  const chrome = std('#cfcfcf', { metalness: 0.8, roughness: 0.25 });
  const canvas = std(livery ? BRAND.pink : '#2a6fb0', { roughness: 0.9, side: THREE.DoubleSide });
  const head = std('#fffbe6', { emissive: '#fff3c0', emissiveIntensity: 0.2 });
  const tail = std('#7a0b0b', { emissive: '#ff2020', emissiveIntensity: 0.2 });

  // motorcycle front
  root.add(box(0.28, 0.25, 0.9, paint, 0, 0.62, -0.7));                 // tank / frame
  root.add(box(0.32, 0.12, 0.6, black, 0, 0.8, -0.35));                 // seat
  const fork = box(0.06, 0.75, 0.06, chrome, 0, 0.62, -1.18);
  fork.rotation.x = -0.35;
  root.add(fork);
  root.add(box(0.75, 0.04, 0.04, chrome, 0, 1.05, -1.05));              // handlebar
  const lamp = cyl(0.09, 0.09, 0.1, head, 12);
  lamp.rotation.x = Math.PI / 2;
  lamp.position.set(0, 0.9, -1.33);
  root.add(lamp);
  root.add(box(0.22, 0.05, 0.4, paint, 0, 0.62, -1.3));                 // front mudguard
  // rear passenger cabin
  root.add(box(1.25, 0.12, 1.1, black, 0, 0.42, 0.55));                 // platform
  root.add(box(1.25, 0.45, 0.08, paint, 0, 0.68, 1.08));                // back panel
  root.add(box(0.06, 0.4, 1.1, paint, -0.6, 0.65, 0.55));
  root.add(box(0.06, 0.4, 1.1, paint, 0.6, 0.65, 0.55));
  root.add(box(1.1, 0.14, 0.45, white, 0, 0.66, 0.78));                 // bench
  root.add(box(1.1, 0.4, 0.08, white, 0, 0.9, 1.0));
  // canopy on four poles
  for (const sx of [-0.58, 0.58]) for (const sz of [0.05, 1.05]) root.add(box(0.04, 1.15, 0.04, chrome, sx, 1.05, sz));
  const roof = box(1.35, 0.05, 1.35, canvas, 0, 1.64, 0.5);
  root.add(roof);
  root.add(box(1.36, 0.16, 0.02, canvas, 0, 1.56, -0.17));
  if (livery) {
  const backLogo = logoDecal(0.4);
  backLogo.position.set(0, 0.7, 1.125);
  // logo on both canopy edges
  for (const sx of [-0.69, 0.69]) {
    const side = sideDecal(0.3, sx);
    side.position.set(sx, 1.55, 0.5);
    root.add(side);
  }
  root.add(backLogo);
  }
  // tail lights
  for (const sx of [-0.5, 0.5]) root.add(box(0.12, 0.08, 0.03, tail, sx, 0.6, 1.13));

  return { root, lights: [head], brakeLights: [tail], wheel: makeWheel(0.3, 0.14, '#888') };
}

export function boatModel(): VehicleModel {
  const root = new THREE.Group();
  const hullMat = std('#f5f5f0', { roughness: 0.35 });
  const stripe = std(BRAND.lime, { roughness: 0.4 });
  const wood = std('#8b5a2b', { roughness: 0.8 });
  const black = std('#1b1b1b', { roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: '#a8d6ea', transparent: true, opacity: 0.5, roughness: 0.1 });
  const head = std('#fffbe6', { emissive: '#fff3c0', emissiveIntensity: 0.2 });

  // hull from an extruded plan shape with a pointed bow
  const shape = new THREE.Shape();
  shape.moveTo(-0.95, 2.4);
  shape.lineTo(0.95, 2.4);
  shape.lineTo(1.05, -0.6);
  shape.quadraticCurveTo(0.9, -2.2, 0, -3.0);
  shape.quadraticCurveTo(-0.9, -2.2, -1.05, -0.6);
  shape.lineTo(-0.95, 2.4);
  const hullGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.75, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 1 });
  hullGeo.rotateX(Math.PI / 2);
  hullGeo.translate(0, 0.55, 0);
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.castShadow = true;
  root.add(hull);
  const stripeGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
  stripeGeo.rotateX(Math.PI / 2);
  stripeGeo.scale(1.02, 1, 1.01);
  stripeGeo.translate(0, 0.45, 0);
  root.add(new THREE.Mesh(stripeGeo, stripe));
  // deck, seats, console, windshield
  root.add(box(1.7, 0.05, 4.6, wood, 0, 0.5, -0.1));
  root.add(box(1.6, 0.35, 0.5, std('#e8e2d0'), 0, 0.72, 1.7));
  root.add(box(0.55, 0.7, 0.5, hullMat, 0.35, 0.9, -0.2));
  const ws = box(0.6, 0.35, 0.03, glass, 0.35, 1.38, -0.42);
  ws.rotation.x = -0.4;
  root.add(ws);
  root.add(box(1.6, 0.3, 0.45, std('#e8e2d0'), 0, 0.68, 0.6));
  for (const sx of [-1.13, 1.13]) {
    const d = sideDecal(0.42, sx);
    d.position.set(sx, 0.32, 0.4);
    root.add(d);
  }
  // outboard motor
  root.add(box(0.4, 0.7, 0.5, black, 0, 0.95, 2.6));
  root.add(box(0.15, 0.9, 0.15, black, 0, 0.3, 2.7));
  const lamp = cyl(0.07, 0.07, 0.08, head, 10);
  lamp.rotation.x = Math.PI / 2;
  lamp.position.set(0, 0.9, -2.75);
  root.add(lamp);
  return { root, lights: [head], brakeLights: [] };
}

/** Simple character with swinging limbs. */
export function personModel() {
  const root = new THREE.Group();
  const skin = std('#b07a52');
  const shirt = std('#2a9d8f');
  const pants = std('#264653');
  const hat = std('#e9d8a6');
  const legL = box(0.16, 0.8, 0.18, pants, 0, -0.4, 0);
  const legR = legL.clone();
  const hipL = new THREE.Group(); hipL.position.set(-0.11, 0.85, 0); hipL.add(legL);
  const hipR = new THREE.Group(); hipR.position.set(0.11, 0.85, 0); hipR.add(legR);
  const torso = box(0.46, 0.62, 0.26, shirt, 0, 1.17, 0);
  const head = box(0.24, 0.27, 0.25, skin, 0, 1.64, 0);
  const brim = box(0.5, 0.03, 0.5, hat, 0, 1.79, 0);
  const crown = box(0.26, 0.12, 0.26, hat, 0, 1.85, 0);
  const armL = box(0.12, 0.6, 0.14, shirt, 0, -0.3, 0);
  const armR = armL.clone();
  const shL = new THREE.Group(); shL.position.set(-0.3, 1.43, 0); shL.add(armL);
  const shR = new THREE.Group(); shR.position.set(0.3, 1.43, 0); shR.add(armR);
  root.add(hipL, hipR, torso, head, brim, crown, shL, shR);
  return { root, limbs: { hipL, hipR, shL, shR } };
}
