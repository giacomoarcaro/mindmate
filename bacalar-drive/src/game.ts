import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { MapData } from './data/types';
import { World } from './world/world';
import { Input } from './input';
import { DroneCamera } from './camera/drone';
import { CameraRig } from './camera/rig';
import { BuildingSet } from './world/buildings';
import { Vegetation } from './world/vegetation';
import { WaterWalls } from './world/waterwalls';
import { buildWater } from './world/water';
import { Physics } from './physics/physics';
import { Player } from './player';
import { Hud } from './ui/hud';
import { Car, type Vehicle } from './vehicles/vehicle';
import { jeepModel } from './vehicles/models';
import { JEEP } from './vehicles/specs';

type Progress = (msg: string) => Promise<void>;

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(65, 1, 0.3, 6000);
  readonly input: Input;
  world!: World;
  physics!: Physics;
  player!: Player;
  hud!: Hud;
  buildings!: BuildingSet;
  vegetation!: Vegetation;
  water!: ReturnType<typeof buildWater>;
  drone: DroneCamera;
  rig: CameraRig;
  droneActive = false;
  jeep!: Car;
  sun = new THREE.DirectionalLight(0xfff4e0, 3.0);
  hemi = new THREE.HemisphereLight(0xbfe6ff, 0x5d6b3a, 1.1);
  sky = new Sky();
  spawn = { x: 0, y: 0, h: 15, heading: 0 };
  private timer = new THREE.Timer();
  private fpsAcc = { t: 0, n: 0, fps: 0 };
  private elapsed = 0;

  constructor(readonly canvas: HTMLCanvasElement, readonly data: MapData) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.input = new Input(canvas);
    this.drone = new DroneCamera(this.camera);
    this.rig = new CameraRig(this.camera);
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
    w.layers.push(this.buildings, this.vegetation, new WaterWalls(this.data, w.field, w.roads, w.grid));
    this.water = buildWater(w.field);
    this.scene.add(this.water.mesh);
    await progress('Starting physics…');
    this.physics = await Physics.create(w);
    this.hud = new Hud();
    this.player = new Player(this.physics, w, this.hud);
    this.scene.add(this.player.root);
    this.jeep = new Car(this.physics, jeepModel(), JEEP);
    this.player.add(this.jeep);
    await progress('Setting up the scene…');
    this.setupEnvironment();
    this.findSpawn();
    await progress('Building tiles around Fuerte de San Felipe…');
    this.world.preload(this.spawn.x, this.spawn.y, 2);
    this.player.spawnInto(this.jeep, this.spawn.x, this.spawn.y, this.spawn.h + 0.3, this.spawn.heading);
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
    const costera = (r: { src: { name: string } }) => /costera/i.test(r.src.name);
    const drivable = (r: { src: { cls: string } }) => r.src.cls !== 'path';
    // Prefer a road named "Costera" near the fort, otherwise the nearest drivable road
    let near = roads.nearest(0, 0, 400, (r) => costera(r) && drivable(r));
    if (!near) near = roads.nearest(0, 0, 400, drivable);
    if (!near) return;
    let { dx, dy } = near;
    if (dy < 0) { dx = -dx; dy = -dy; }
    this.spawn = { x: near.x, y: near.y, h: near.h, heading: Math.atan2(dx, dy) };
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  private handleKeys() {
    const input = this.input;
    const p = this.player;
    if (input.wasPressed('KeyF')) {
      this.droneActive = !this.droneActive;
      if (this.droneActive) this.drone.takeOver(); else this.rig.snap();
      this.hud.message(this.droneActive ? 'Drone camera: WASD, mouse, Space / Z, Shift' : 'Drone off');
    }
    if (input.wasPressed('KeyH')) {
      const el = document.getElementById('hud-help')!;
      this.hud.setHelp(el.style.display === 'none');
    }
    if (this.droneActive) return;
    if (input.wasPressed('KeyC')) { this.rig.cycle(); this.hud.message(`Camera: ${this.rig.mode}`); }
    if (input.wasPressed('KeyR')) p.reset();
    const keys: [string, Vehicle | undefined][] = [['Digit1', this.jeep]];
    for (const [code, v] of keys) {
      if (v && input.wasPressed(code)) {
        const err = p.summon(v);
        if (err) this.hud.message(err); else { this.hud.showToast(v.name); this.rig.snap(); }
      }
    }
    if (input.wasPressed('KeyE')) {
      if (p.active) p.exit();
      else {
        const v = p.nearestVehicle();
        if (v) p.enter(v); else this.hud.message('No vehicle nearby (press 1, 2 or 3 to call one)');
      }
    }
  }

  /** Test helper: run the vehicle simulation without rendering. */
  debugSimulate(seconds: number, axes: { throttle: number; steer: number; handbrake: boolean }) {
    const p = this.player;
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i++) {
      if (p.active) p.active.controls = axes;
      this.physics.update([p.focus()]);
      this.physics.advance(1 / 60, (h) => { for (const v of p.vehicles) if (v.body.isEnabled()) v.preStep(h); });
    }
    for (const v of p.vehicles) v.syncVisual(this.elapsed);
    const f = p.focus();
    return { x: f.x, y: f.y, h: f.h, kmh: (p.active?.forwardSpeed() ?? 0) * 3.6, heading: p.heading() * 57.3 };
  }

  private frame(now: number) {
    this.timer.update(now);
    const dt = Math.min(this.timer.getDelta(), 0.05);
    this.elapsed += dt;
    const input = this.input;
    input.pollGamepad();
    const field = this.world.field;
    const p = this.player;

    this.handleKeys();

    // controls
    const axes = this.droneActive ? { throttle: 0, steer: 0, handbrake: true } : input.driveAxes();
    if (p.active) p.active.controls = axes;
    for (const v of p.vehicles) if (v !== p.active) v.controls = { throttle: 0, steer: 0, handbrake: true };

    // physics
    const focus = p.focus();
    this.physics.update([focus]);
    p.updateParked();
    const camYaw = this.rig.viewYaw();
    this.physics.advance(dt, (h) => {
      for (const v of p.vehicles) if (v.body.isEnabled()) v.preStep(h);
      if (!p.active && !this.droneActive) {
        let mx = 0, my = 0;
        if (input.isDown('KeyW') || input.isDown('ArrowUp')) my += 1;
        if (input.isDown('KeyS') || input.isDown('ArrowDown')) my -= 1;
        if (input.isDown('KeyD') || input.isDown('ArrowRight')) mx += 1;
        if (input.isDown('KeyA') || input.isDown('ArrowLeft')) mx -= 1;
        p.walker.step(h, mx, my, input.isDown('ShiftLeft'), camYaw, input.isDown('Space'));
      }
    });
    for (const v of p.vehicles) v.syncVisual(this.elapsed);
    p.walker.sync(this.elapsed);

    // camera
    const groundAt = (x: number, z: number) => field.heightAt(x, -z);
    if (this.droneActive) {
      this.drone.update(dt, input, groundAt);
    } else if (p.active) {
      const v = p.active;
      this.rig.update(dt, {
        position: v.position(), quaternion: v.quaternion(),
        chaseDist: v.camera.chaseDist, chaseHeight: v.camera.chaseHeight, hood: v.camera.hood,
        speed: v.forwardSpeed(),
      }, input, groundAt);
    } else {
      const w = p.walker;
      this.rig.update(dt, {
        position: w.position(), quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, w.yaw, 0)),
        chaseDist: 4.5, chaseHeight: 2.2, hood: new THREE.Vector3(0, 1.65, -0.2), speed: w.speed,
      }, input, groundAt);
    }

    const cam = this.camera.position;
    const streamAt = this.droneActive ? { x: cam.x, y: -cam.z } : focus;
    this.world.update(streamAt.x, streamAt.y);

    // shadow camera follows the view
    const sunDir = this.sky.material.uniforms.sunPosition.value as THREE.Vector3;
    const target = new THREE.Vector3(cam.x, field.heightAt(cam.x, -cam.z), cam.z);
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(sunDir, 400);
    this.sky.position.copy(cam);
    this.water.uniforms.uTime.value = this.elapsed;
    this.water.uniforms.uSunDir.value.copy(sunDir).normalize();
    this.vegetation.time.value = this.elapsed;

    // HUD
    this.hud.update(dt);
    if (p.active) {
      this.hud.showSpeedo(true);
      this.hud.drawSpeed(p.active.forwardSpeed() * 3.6, p.active.maxKmh, p.active.name);
    } else this.hud.showSpeedo(false);
    this.fpsAcc.t += dt; this.fpsAcc.n++;
    if (this.fpsAcc.t > 0.5) {
      this.fpsAcc.fps = Math.round(this.fpsAcc.n / this.fpsAcc.t);
      this.fpsAcc.t = 0; this.fpsAcc.n = 0;
      this.hud.setInfo(`<b>Bacalar</b><br>${this.fpsAcc.fps} fps · ${this.droneActive ? 'drone' : this.rig.mode}`);
    }

    this.renderer.render(this.scene, this.camera);
    input.endFrame();
  }
}
