import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { MapData } from './data/types';
import { World } from './world/world';
import { Input } from './input';
import { DroneCamera } from './camera/drone';
import { BuildingSet } from './world/buildings';
import { Vegetation } from './world/vegetation';
import { buildWater } from './world/water';

type Progress = (msg: string) => Promise<void>;

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(65, 1, 0.3, 6000);
  readonly input: Input;
  world!: World;
  buildings!: BuildingSet;
  vegetation!: Vegetation;
  water!: ReturnType<typeof buildWater>;
  drone: DroneCamera;
  sun = new THREE.DirectionalLight(0xfff4e0, 3.0);
  hemi = new THREE.HemisphereLight(0xbfe6ff, 0x5d6b3a, 1.1);
  sky = new Sky();
  spawn = { x: 0, y: 0, h: 15, heading: 0 };
  private clock = new THREE.Clock();
  private hudInfo!: HTMLElement;
  private fpsAcc = { t: 0, n: 0, fps: 0 };

  constructor(readonly canvas: HTMLCanvasElement, readonly data: MapData) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.input = new Input(canvas);
    this.drone = new DroneCamera(this.camera);
    canvas.addEventListener('click', () => this.input.requestPointerLock());
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  async init(progress: Progress) {
    await progress('Rasterizing lagoon and terrain…');
    this.world = new World(this.data);
    this.scene.add(this.world.root);
    await progress('Placing buildings and houses…');
    const w = this.world;
    this.buildings = new BuildingSet(this.data, w.field, w.roads, w.grid, [{ x: 0, y: 0, r: 75 }]);
    this.vegetation = new Vegetation(w.field);
    w.layers.push(this.buildings, this.vegetation);
    this.water = buildWater(w.field);
    this.scene.add(this.water.mesh);
    console.info('buildings', this.buildings.count());
    await progress('Setting up the scene…');
    this.setupEnvironment();
    this.findSpawn();
    this.buildHud();
    await progress('Building tiles around Fuerte de San Felipe…');
    this.world.preload(this.spawn.x, this.spawn.y, 2);
    // Start the drone above the spawn point looking north over the town and lagoon
    this.camera.position.set(this.spawn.x - 60, this.spawn.h + 70, -this.spawn.y + 160);
    this.camera.lookAt(this.spawn.x + 40, this.spawn.h, -this.spawn.y - 150);
    this.drone.takeOver();
  }

  private setupEnvironment() {
    const sky = this.sky;
    sky.scale.setScalar(5000);
    const u = sky.material.uniforms;
    u.turbidity.value = 4;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(40), THREE.MathUtils.degToRad(120));
    u.sunPosition.value.copy(sunDir);
    this.scene.add(sky);

    this.scene.fog = new THREE.Fog(0xb9d9e8, 400, 1100);
    this.sun.position.copy(sunDir).multiplyScalar(300);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -120; sc.right = 120; sc.top = 120; sc.bottom = -120; sc.near = 1; sc.far = 800;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target, this.hemi);
  }

  private findSpawn() {
    const roads = this.world.roads;
    const costera = (r: { src: { name: string; cls: string } }) => /costera/i.test(r.src.name);
    const drivable = (r: { src: { cls: string } }) => r.src.cls !== 'path';
    // Prefer a road named "Costera" near the fort, otherwise the nearest drivable road
    let near = roads.nearest(0, 0, 400, (r) => costera(r) && drivable(r));
    if (!near) near = roads.nearest(0, 0, 400, drivable);
    if (!near) return;
    let { dx, dy } = near;
    if (dy < 0) { dx = -dx; dy = -dy; }
    this.spawn = { x: near.x, y: near.y, h: near.h, heading: Math.atan2(dx, dy) };
  }

  private buildHud() {
    const hud = document.getElementById('hud')!;
    hud.innerHTML = `
      <div class="topleft panel" id="hud-info"></div>
      <div class="help panel">
        <kbd>WASD</kbd> move &nbsp; <kbd>mouse</kbd> look (click to capture) &nbsp; <kbd>Space</kbd>/<kbd>Z</kbd> up/down &nbsp; <kbd>Shift</kbd> fast
      </div>
      <div class="credit">Map data © OpenStreetMap contributors</div>`;
    this.hudInfo = document.getElementById('hud-info')!;
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const input = this.input;
    input.pollGamepad();
    const field = this.world.field;
    this.drone.update(dt, input, (x, z) => field.heightAt(x, -z));

    const cam = this.camera.position;
    this.world.update(cam.x, -cam.z);

    // Shadow camera follows the view
    const target = new THREE.Vector3(cam.x, field.heightAt(cam.x, -cam.z), cam.z);
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sky.material.uniforms.sunPosition.value, 400);
    this.sky.position.copy(cam);
    const time = this.clock.elapsedTime;
    this.water.uniforms.uTime.value = time;
    this.water.uniforms.uSunDir.value.copy(this.sky.material.uniforms.sunPosition.value).normalize();
    this.vegetation.time.value = time;

    this.fpsAcc.t += dt; this.fpsAcc.n++;
    if (this.fpsAcc.t > 0.5) {
      this.fpsAcc.fps = Math.round(this.fpsAcc.n / this.fpsAcc.t);
      this.fpsAcc.t = 0; this.fpsAcc.n = 0;
      this.hudInfo.innerHTML = `<b>Bacalar</b><br>${this.fpsAcc.fps} fps · tiles ${this.world.tiles.size}<br>x ${cam.x.toFixed(0)} y ${(-cam.z).toFixed(0)}`;
    }

    this.renderer.render(this.scene, this.camera);
    input.endFrame();
  }
}
