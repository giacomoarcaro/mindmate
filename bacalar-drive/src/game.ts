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
import { Boat, Car, type Vehicle } from './vehicles/vehicle';
import { boatModel, jeepModel, motoTaxiModel } from './vehicles/models';
import { JEEP, MOTOTAXI } from './vehicles/specs';
import { Atmosphere } from './env/atmosphere';
import { StreetLights } from './world/streetlights';
import { Minimap } from './ui/minimap';
import type { Poi } from './data/types';
import { Landmarks } from './world/landmarks';
import { PierLayer } from './world/piers';
import { Rain } from './env/rain';
import { GymSite } from './gym/gym';
import { FacadeStore } from './world/facades';
import { StreetProps } from './world/streetprops';
import { TouchControls } from './ui/touch';
import { People } from './gym/people';
import { Pins } from './gym/pins';
import { BRAND, drawLogo, whatsappUrl } from './gym/brand';
import { Sound } from './audio';
import { Effects } from './render/fx';
import { Clouds } from './env/clouds';
import { RoundScreens, fmtTime } from './ui/round';
import { Race } from './gym/race';
import { figure, type Kind } from './gym/people';

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
  moto!: Car;
  boat!: Boat;
  atmosphere!: Atmosphere;
  streetLights!: StreetLights;
  minimap!: Minimap;
  landmarks!: Landmarks;
  gym!: GymSite;
  streetProps!: StreetProps;
  people!: People;
  pins!: Pins;
  /** mission state: people on board and members delivered to the gym */
  onboard = 0;
  /** kinds of the people riding with the player */
  private riders: Kind[] = [];
  readonly sound = new Sound();
  fx!: Effects;
  clouds = new Clouds();
  /** arcade score for knocking people over, with a short combo window */
  puntos = 0;
  private combo = 0;
  private comboTimer = 0;
  private lastKmh = 0;
  private slowFrames = 0;
  /** race from the plaza to the gym against three rivals; TIME_LIMIT ends it */
  readonly TIME_LIMIT = 300;
  race!: Race;
  private round = { phase: 'idle' as 'idle' | 'countdown' | 'racing' | 'done', countdown: 0, time: 0, socios: 0, hits: 0, startPuntos: 0, lastBeep: 0 };
  private best: number | null = null;
  private screens!: RoundScreens;
  private routeTimer = 0;
  socios = 0;
  private nextReward = 0;
  rain = new Rain();
  /** phones and tablets get on-screen controls and the light settings */
  readonly isTouch = TouchControls.wanted();
  readonly lowQuality = /[?&]low\b/.test(location.search) || this.isTouch;
  touch: TouchControls | null = null;
  private minimapTimer = 0;
  headlight = new THREE.SpotLight(0xfff1d0, 0, 90, 0.55, 0.5, 1.2);
  private namedPoints: Poi[] = [];
  private lastPoi: Poi | null = null;
  /** seconds during which the welcome title owns the toast */
  private welcomeUntil = 0;
  private lastRoadName = '';
  private hudTimer = 0;
  sun = new THREE.DirectionalLight(0xfff4e0, 3.0);
  hemi = new THREE.HemisphereLight(0xbfe6ff, 0x5d6b3a, 1.1);
  sky = new Sky();
  spawn = { x: 0, y: 0, h: 15, heading: 0 };
  private timer = new THREE.Timer();
  private fpsAcc = { t: 0, n: 0, fps: 0 };
  private elapsed = 0;

  constructor(readonly canvas: HTMLCanvasElement, readonly data: MapData) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.isTouch, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.lowQuality ? 1.25 : 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.input = new Input(canvas);
    this.drone = new DroneCamera(this.camera);
    this.rig = new CameraRig(this.camera);
    if (!this.isTouch) canvas.addEventListener('click', () => this.input.requestPointerLock());
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  async init(progress: Progress) {
    await progress('Rasterizing lagoon and terrain…');
    this.landmarks = new Landmarks(this.data);
    this.gym = new GymSite(this.data);
    this.world = new World(this.data, (field) => { this.landmarks.registerModifiers(field); this.gym.registerModifier(field); });
    this.gym.markOccupied(this.world.field);
    if (this.lowQuality) this.world.loadRadius = 2;
    this.scene.add(this.world.root);
    this.landmarks.markOccupied(this.world.field);
    await progress('Placing buildings and houses…');
    const w = this.world;
    this.buildings = new BuildingSet(this.data, w.field, w.roads, w.grid, [...this.landmarks.exclusions(), this.gym.exclusion()]);
    this.buildings.facades = await FacadeStore.load(import.meta.env.BASE_URL);
    this.buildings.assignShops(this.data.pois);
    this.buildings.sponsor = { x: this.gym.x, y: this.gym.y };
    this.vegetation = new Vegetation(w.field);
    if (this.lowQuality) this.vegetation.spacing = 8.5;
    this.streetLights = new StreetLights(w.roads, w.field, w.grid);
    w.layers.push(this.buildings, this.vegetation, this.streetLights, new PierLayer(this.data, w.field, w.grid), this.streetProps = new StreetProps(w.roads, w.field, w.grid), new WaterWalls(this.data, w.field, w.roads, w.grid));
    await progress('Building Fuerte de San Felipe and the plaza…');
    this.landmarks.build(this.vegetation.species[2].geo[0], this.vegetation.material);
    this.gym.build();
    this.gym.buildBillboards(w.roads, w.field);
    this.people = new People(w.roads, w.field);
    if (this.lowQuality) this.people.max = 18;
    this.pins = new Pins([...this.data.pois, ...this.data.landmarks.filter((l) => !l.kind.startsWith('place:'))], w.field, this.gym);
    this.scene.add(this.landmarks.group, this.rain.mesh, this.gym.group, this.people.group, this.pins.group);
    this.water = buildWater(w.field);
    this.scene.add(this.water.mesh);
    await progress('Starting physics…');
    this.physics = await Physics.create(w);
    this.physics.addStatic(this.landmarks.colliders, [...this.landmarks.boxes, ...this.gym.boxes]);
    this.hud = new Hud();
    if (this.isTouch) {
      this.touch = new TouchControls(this.input, this.canvas);
      this.touch.onFoot = () => !this.player?.active;
      this.hud.setHelp(false);
    }
    this.hud.setBrand(drawLogo(128).toDataURL(), `${BRAND.offer} · WhatsApp|Día gratis · WhatsApp`, whatsappUrl());
    const creditEl = document.querySelector('.credit');
    if (creditEl) creditEl.textContent = this.data.meta.attribution.replace(/ \(ODbL\)/g, '');
    if (this.buildings.facades) {
      const credit = document.querySelector('.credit');
      if (credit) credit.textContent += ` · ${this.buildings.facades.attribution}`;
    }
    try { this.puntos = Number(localStorage.getItem('bjg-puntos')) || 0; } catch { /* storage unavailable */ }
    try { this.socios = Number(localStorage.getItem('bjg-socios')) || 0; } catch { /* storage unavailable */ }
    this.player = new Player(this.physics, w, this.hud);
    this.scene.add(this.player.root);
    this.jeep = new Car(this.physics, jeepModel(), JEEP);
    this.moto = new Car(this.physics, motoTaxiModel(), MOTOTAXI);
    // hip positions of passengers: Jeep back bench, mototaxi bench
    this.jeep.seats = [new THREE.Vector3(-0.45, 0.98, 0.95), new THREE.Vector3(0, 0.98, 0.95), new THREE.Vector3(0.45, 0.98, 0.95)];
    this.moto.seats = [new THREE.Vector3(-0.28, 0.74, 0.78), new THREE.Vector3(0.28, 0.74, 0.78)];
    this.boat = new Boat(this.physics, boatModel());
    for (const v of [this.jeep, this.moto, this.boat]) this.player.add(v);
    this.minimap = new Minimap(this.hud.minimapHost, w.field, w.roads, this.buildings.all, this.data.landmarks);
    this.minimap.gym = { x: this.gym.x, y: this.gym.y };
    this.findSpawn();
    this.race = new Race(w.roads, w.field, this.physics, this.spawn, { x: this.gym.dropX, y: this.gym.dropY });
    this.scene.add(this.race.group);
    this.screens = new RoundScreens();
    this.screens.onStart = () => this.startRound();
    this.screens.onRestart = () => this.startRound(true);
    try { this.best = Number(localStorage.getItem('bjg-best')) || null; } catch { /* storage unavailable */ }
    this.namedPoints = [...this.data.landmarks.filter((l) => !l.kind.startsWith('place:')), ...this.data.pois];
    await progress('Setting up the scene…');
    this.setupEnvironment();
    this.findSpawn();
    await progress('Building tiles around Fuerte de San Felipe…');
    this.world.preload(this.spawn.x, this.spawn.y, 2);
    this.player.spawnInto(this.jeep, this.spawn.x, this.spawn.y, this.spawn.h + 0.3, this.spawn.heading);
    this.welcomeUntil = 4.5;
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
    this.sun.shadow.mapSize.set(this.lowQuality ? 1024 : 2048, this.lowQuality ? 1024 : 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -120; sc.right = 120; sc.top = 120; sc.bottom = -120; sc.near = 1; sc.far = 800;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.scene.add(this.clouds.mesh);
    this.fx = new Effects(this.renderer, this.scene, this.camera, !this.lowQuality);
    this.resize();
    this.atmosphere = new Atmosphere(this.scene, this.sky, this.sun, this.hemi, this.renderer);
    if (this.lowQuality) this.atmosphere.fogScale = 0.72;
    this.headlight.position.set(0, 1.2, -1.5);
    this.headlight.target.position.set(0, -2, -25);
    this.scene.add(this.headlight, this.headlight.target);
  }

  /** Line everyone up at the plaza and start the 3-2-1 countdown. */
  private startRound(respawn = false) {
    if (respawn || this.player.active !== this.jeep) {
      this.riders = [];
      this.onboard = 0;
      this.player.spawnInto(this.jeep, this.spawn.x, this.spawn.y, this.spawn.h + 0.3, this.spawn.heading);
      this.seatRiders();
      this.rig.mode = 'chase';
      this.rig.snap();
    }
    this.race.reset(this.spawn);
    this.round = { phase: 'countdown', countdown: 3.2, time: 0, socios: 0, hits: 0, startPuntos: this.puntos, lastBeep: 4 };
  }

  private endRound(place: number) {
    if (this.round.phase !== 'racing') return;
    this.round.phase = 'done';
    const t = this.round.time;
    const won = place === 1;
    let newBest = false;
    if (place > 0 && (this.best === null || t < this.best)) {
      this.best = t; newBest = true;
      try { localStorage.setItem('bjg-best', String(t)); } catch { /* storage unavailable */ }
    }
    if (won) this.sound.reward(); else this.sound.crash(0.3);
    this.screens.showEnd({
      won, place, racers: this.race.rivals.length + 1, seconds: t, best: this.best, newBest,
      socios: this.round.socios, puntos: this.puntos - this.round.startPuntos, hits: this.round.hits,
    });
  }

  /** Countdown, race clock, finish line and the HUD race line. */
  private updateRace(dt: number) {
    const r = this.round;
    const f = this.player.focus();
    if (r.phase === 'countdown') {
      r.countdown -= dt;
      const n = Math.ceil(r.countdown);
      if (n !== r.lastBeep && n >= 1 && n <= 3) { r.lastBeep = n; this.hud.showToast(String(n), 'prepárate', 0.9); this.sound.beep(false); }
      if (r.countdown <= 0) {
        r.phase = 'racing';
        this.hud.showToast('¡YA!', 'primero al Jungle Gym', 1.2);
        this.sound.beep(true);
      }
    } else if (r.phase === 'racing') {
      r.time += dt;
      const atGym = this.gym.dropDistance(f.x, f.y) < 12 && this.player.active?.kind === 'land';
      if (atGym) this.endRound(1 + this.race.finishedCount());
      else if (r.time >= this.TIME_LIMIT) this.endRound(0);
    }
    this.race.update(dt, r.phase === 'racing', r.time);
    // minimap: race route and rivals
    this.routeTimer -= dt;
    if (this.routeTimer <= 0) {
      this.routeTimer = 0.5;
      this.minimap.route = r.phase === 'idle' || r.phase === 'done' ? [] : this.race.routeFrom(f.x, f.y);
    }
    this.minimap.rivals = r.phase === 'idle' ? [] : this.race.rivals.map((v) => [v.x, v.y] as [number, number]);
  }

  /** Text for the race part of the HUD. */
  private raceLine() {
    const r = this.round;
    if (r.phase === 'idle') return '';
    const f = this.player.focus();
    const pos = r.phase === 'done' ? '' : `${this.race.position(f.x, f.y)}º/${this.race.rivals.length + 1}`;
    const left = Math.max(0, this.race.remaining(f.x, f.y));
    const dist = left < 1000 ? `${Math.round(left / 10) * 10} m` : `${(left / 1000).toFixed(1)} km`;
    return `<span class="race-clock">⏱ ${fmtTime(r.time)}</span> <span class="race-pos">${pos}</span><br>${dist} al gym${this.best ? ` · récord ${fmtTime(this.best)}` : ''}`;
  }

  private findSpawn() {
    const roads = this.world.roads;
    // Start in the historic center, on the street in front of the BACALAR letters, facing them.
    const sign = this.landmarks.signSpot;
    if (sign) {
      // straight in front of the letters, so the chase camera frames them head on
      let d = 13;
      for (let t = 10; t <= 26; t += 1) {
        const r = roads.nearest(sign.x + sign.nx * t, sign.y + sign.ny * t, 10, (o) => o.src.cls !== 'path');
        if (r && r.dist < r.road.src.width / 2 - 1) { d = t; break; }
      }
      const x = sign.x + sign.nx * d, y = sign.y + sign.ny * d;
      this.spawn = { x, y, h: Math.max(this.world.field.heightAt(x, y), sign.h) + 0.2, heading: Math.atan2(-sign.nx, -sign.ny) };
      return;
    }
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
    this.fx?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    this.screens.showStart(this.race.rivals.map((r) => r.name), this.race.routeLength, this.best, this.isTouch);
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  private handleKeys() {
    const input = this.input;
    const p = this.player;
    if (input.wasPressed('KeyF')) {
      this.droneActive = !this.droneActive;
      if (this.droneActive) this.drone.takeOver(); else this.rig.snap();
      this.hud.message(this.droneActive ? 'Dron: WASD, mouse, Espacio / Z, Shift' : 'Dron apagado');
    }
    if (input.wasPressed('KeyH')) {
      const el = document.getElementById('hud-help')!;
      this.hud.setHelp(el.style.display === 'none');
    }
    if (this.droneActive) return;
    if (input.wasPressed('KeyC')) { this.rig.cycle(); this.hud.message(`Cámara: ${{ chase: 'persecución', hood: 'cofre', top: 'aérea' }[this.rig.mode]}`); }
    if (input.wasPressed('KeyR')) p.reset();
    if (input.wasPressed('KeyT')) { this.atmosphere.skip(2); this.hud.message('Adelantando 2 horas…'); }
    if (input.wasPressed('KeyP')) {
      this.atmosphere.rainTarget = this.atmosphere.rainTarget > 0 ? 0 : 1;
      this.hud.message(this.atmosphere.rainTarget ? 'Lluvia' : 'Sin lluvia');
    }
    if (input.wasPressed('KeyG')) this.sound.horn();
    if (input.wasPressed('KeyM')) this.hud.message(this.sound.toggleMute() ? 'Sonido apagado' : 'Sonido encendido');
    const keys: [string, Vehicle | undefined][] = [['Digit1', this.jeep], ['Digit2', this.moto], ['Digit3', this.boat]];
    for (const [code, v] of keys) {
      if (v && input.wasPressed(code)) {
        const err = p.summon(v);
        if (err) this.hud.message(err); else {
          this.hud.showToast(v.name); this.rig.snap();
          // riders move with you; the boat takes nobody, so they stay waiting for the next car ride
          if (v.kind === 'water') this.riders = [];
          this.riders = this.riders.slice(0, v.seats.length || this.riders.length);
          this.seatRiders();
        }
      }
    }
    if (input.wasPressed('KeyE')) {
      if (p.active) p.exit();
      else {
        const v = p.nearestVehicle();
        if (v) { p.enter(v); this.seatRiders(); } else this.hud.message('No hay vehículo cerca (pulsa 1, 2 o 3 para llamar uno)');
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

  /** Show the riders sitting in the active vehicle. */
  private seatRiders() {
    for (const v of this.player.vehicles) v.riders.clear();
    const v = this.player.active;
    if (!v) return;
    this.riders.forEach((kind, i) => {
      const seat = v.seats[i];
      if (!seat) return;
      const f = figure(kind);
      f.legs.forEach((l) => { l.rotation.x = Math.PI / 2; });
      f.arms.forEach((a) => { a.rotation.x = 0.5; });
      f.root.scale.setScalar(0.92);
      f.root.position.set(seat.x, seat.y - 0.8, seat.z);
      v.riders.add(f.root);
    });
  }

  /** Pick up people who want to train, drop them at the gym, score points for knocking people over. */
  private updateMission(dt: number, fx: number, fy: number) {
    const p = this.player;
    const v = p.active;
    const seats = v && v.kind === 'land' ? v.seats.length : 0;
    const f = p.focus();
    const kmh = v ? Math.abs(v.forwardSpeed()) * 3.6 : 0;
    const car = v && v.kind === 'land' && !this.droneActive ? (() => {
      const lv = v.body.linvel();
      const big = v === this.jeep;
      return {
        x: f.x, y: f.y, h: f.h, vx: lv.x, vy: -lv.z, heading: v.heading(),
        halfW: big ? 0.95 : 0.7, halfL: big ? 2.25 : 1.45,
        speed: Math.hypot(lv.x, lv.z), freeSeats: Math.max(0, seats - this.riders.length), stopped: kmh < 6,
      };
    })() : null;
    const ev = this.people.update(dt, this.elapsed, fx, fy, car);

    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.combo = 0;
    for (const h of ev.hits) {
      this.sound.hit(Math.min(1, h.speed / 20));
      if (h.gymGoer) {
        this.hud.showToast('¡Ese iba al gym!', 'sin puntos · frena para que suban', 2.2);
        continue;
      }
      this.combo++;
      this.round.hits++;
      this.comboTimer = 3.5;
      const pts = Math.round((100 + h.speed * 3.6 * 2) * this.combo);
      this.puntos += pts;
      this.sound.points(this.combo);
      this.hud.showToast(`+${pts}`, this.combo > 1 ? `combo x${this.combo}` : '¡strike!', 1.6);
      // the bump slows the car a little
      if (v) { const lv = v.body.linvel(); v.body.setLinvel({ x: lv.x * 0.93, y: lv.y, z: lv.z * 0.93 }, true); }
    }
    if (ev.hits.length) { try { localStorage.setItem('bjg-puntos', String(this.puntos)); } catch { /* storage unavailable */ } }
    for (const b of ev.bounces) this.sound.bounce(b);
    if (ev.boarded.length) {
      this.riders.push(...ev.boarded);
      this.onboard = this.riders.length;
      this.seatRiders();
      this.sound.board();
      this.hud.showToast(ev.boarded.length > 1 ? `¡${ev.boarded.length} suben contigo!` : '¡Sube contigo!', 'llévalos al Jungle Gym');
    }

    const d = this.gym.dropDistance(f.x, f.y);
    if (this.riders.length > 0 && v && kmh < 8 && d < 12) {
      const n = this.riders.length;
      this.socios += n;
      const bonus = 500 * n;
      this.puntos += bonus;
      try { localStorage.setItem('bjg-socios', String(this.socios)); localStorage.setItem('bjg-puntos', String(this.puntos)); } catch { /* storage unavailable */ }
      this.people.spawnLeaving(this.riders, f.x, f.y, this.gym.x, this.gym.y);
      this.riders = [];
      this.onboard = 0;
      this.seatRiders();
      this.sound.dropoff();
      this.hud.showToast(`+${n} ${n > 1 ? 'socios' : 'socio'} en el gym`, `+${bonus} puntos · total socios: ${this.socios}`);
      this.round.socios += n;
    }
    this.minimap.waiting = this.people.waiting();
    const dist = d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`;
    const seatTxt = seats ? `A bordo ${this.riders.length}/${seats}` : v ? 'La lancha no lleva pasajeros' : 'Sube a un vehículo';
    const race = this.raceLine();
    this.hud.setMission(race
      ? `${race}<br><b>${(this.puntos - this.round.startPuntos).toLocaleString('es-MX')}</b> pts · ${seatTxt}`
      : `<b>${this.puntos.toLocaleString('es-MX')}</b> pts · ${seatTxt}<br>Gym a ${dist}`);

    // engine, tires, crash
    const atm = this.atmosphere;
    if (v && !this.droneActive) {
      const kind = v === this.jeep ? 'jeep' : v === this.moto ? 'moto' : 'boat';
      const lv = v.body.linvel();
      const fwd = v.forwardSpeed();
      const lateral = Math.sqrt(Math.max(0, lv.x * lv.x + lv.z * lv.z - fwd * fwd));
      const slip = v.kind === 'land' ? Math.max(v.controls.handbrake && kmh > 15 ? 1 : 0, Math.min(1, (lateral - 2.5) / 5)) : 0;
      this.sound.update(kind, Math.min(1, kmh / v.maxKmh), Math.max(0, v.controls.throttle), Math.max(0, slip), atm.rain);
      const drop = this.lastKmh - kmh;
      if (drop > 18 && ev.hits.length === 0) this.sound.crash(Math.min(1, drop / 60));
    } else this.sound.update('none', 0, 0, 0, atm.rain);
    this.lastKmh = kmh;
  }

  /** Street name under the player and toasts for nearby named places. */
  private updateNames(x: number, y: number) {
    const road = this.world.roads.nearest(x, y, 14);
    if (road && road.dist < road.road.src.width / 2 + 4) {
      const r = road.road.src;
      const name = r.name || '';
      const kind = { primary: 'Carretera', secondary: 'Avenida', residential: 'Calle', service: 'Acceso', track: 'Camino de sascab', path: 'Andador' }[r.cls] ?? '';
      if (name) {
        this.hud.setStreet(name, kind);
        this.lastRoadName = name;
      } else this.hud.setStreet(kind ? `${kind} sin nombre` : '', '');
    } else if (this.player.active?.kind === 'water') {
      this.hud.setStreet('Laguna de Bacalar', 'Laguna de los Siete Colores');
    } else this.hud.setStreet('');

    if (this.elapsed < this.welcomeUntil) {
      if (!this.lastPoi) this.hud.showToast('BACALAR', 'Pueblo Mágico · centro histórico', 4);
      this.lastPoi = this.namedPoints[0] ?? null;
      return;
    }
    let best: Poi | null = null, bd = 70;
    for (const poi of this.namedPoints) {
      const d = Math.hypot(poi.x - x, poi.y - y);
      if (d < bd) { bd = d; best = poi; }
    }
    if (best && best !== this.lastPoi) {
      const kind = best.kind.split(':')[1]?.replace(/_/g, ' ') ?? '';
      this.hud.showToast(best.name, kind);
      this.lastPoi = best;
    } else if (this.lastPoi && Math.hypot(this.lastPoi.x - x, this.lastPoi.y - y) > 160) {
      this.lastPoi = null;
    }
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
    const holding = this.round.phase === 'countdown' || this.screens?.visible;
    const axes = this.droneActive || holding ? { throttle: 0, steer: 0, handbrake: true } : input.driveAxes();
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

    // day and night
    const target = new THREE.Vector3(cam.x, field.heightAt(cam.x, -cam.z), cam.z);
    const atm = this.atmosphere;
    atm.update(dt, target);
    const sunDir = atm.sunDir;
    // shadow camera follows the view, snapped to texels to avoid shimmering
    const snap = 240 / 2048;
    target.x = Math.round(target.x / snap) * snap;
    target.z = Math.round(target.z / snap) * snap;
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(sunDir, 400);
    this.sky.position.copy(cam);
    const wu = this.water.uniforms;
    wu.uTime.value = this.elapsed;
    wu.uSunDir.value.copy(sunDir);
    wu.uDay.value = atm.day;
    wu.uSkyColor.value.copy(atm.fogColor);
    wu.uRain.value = atm.rain;
    wu.uSunColor.value.copy(this.sun.color);
    this.vegetation.time.value = this.elapsed;
    this.clouds.update(this.elapsed, cam, this.sun.color, atm.day, atm.rain);
    this.streetLights.setNight(atm.night);
    this.buildings.setNight(atm.night);
    this.rain.update(this.elapsed, cam, atm.rain);
    const wet = 1 - atm.rain * 0.35;
    (this.world.materials.asphalt as THREE.MeshLambertMaterial).color.setScalar(wet);
    (this.world.materials.dirt as THREE.MeshLambertMaterial).color.setScalar(1 - atm.rain * 0.25);
    const flag = this.landmarks.group.getObjectByName('flag');
    if (flag) flag.rotation.y = Math.sin(this.elapsed * 1.7) * 0.25;
    const lightsOn = atm.night > 0.35 || atm.rain > 0.5;
    for (const v of p.vehicles) v.setLights(lightsOn && v === p.active);
    if (p.active && lightsOn) {
      p.active.object.add(this.headlight, this.headlight.target);
      this.headlight.intensity = 60;
    } else this.headlight.intensity = 0;

    this.updateRace(dt);
    this.updateMission(dt, streamAt.x, streamAt.y);
    this.gym.update(this.elapsed, atm.night);
    this.pins.update(dt, streamAt.x, streamAt.y, cam);

    // HUD
    this.hud.update(dt);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.2;
      const f = this.droneActive ? { x: cam.x, y: -cam.z } : focus;
      this.updateNames(f.x, f.y);
    }
    const mapPos = this.droneActive ? { x: cam.x, y: -cam.z } : focus;
    const mapHeading = this.droneActive ? -this.drone.yaw : p.heading();
    this.minimapTimer -= dt;
    if (this.minimapTimer <= 0) {
      this.minimapTimer = 1 / 30;
      this.minimap.draw(mapPos.x, mapPos.y, mapHeading);
    }
    if (p.active) {
      this.hud.showSpeedo(true);
      this.hud.drawSpeed(p.active.forwardSpeed() * 3.6, p.active.maxKmh, p.active.name);
    } else this.hud.showSpeedo(false);
    this.fpsAcc.t += dt; this.fpsAcc.n++;
    if (this.fpsAcc.t > 0.5) {
      this.fpsAcc.fps = Math.round(this.fpsAcc.n / this.fpsAcc.t);
      if (this.elapsed > 8) { this.slowFrames = this.fpsAcc.fps < 40 ? this.slowFrames + 1 : 0; if (this.slowFrames === 6) this.fx.setAo(false); }
      this.fpsAcc.t = 0; this.fpsAcc.n = 0;
      this.hud.setInfo(`<b>${atm.clock()}</b> &nbsp;Bacalar<br>${this.fpsAcc.fps} fps · ${this.droneActive ? 'drone' : this.rig.mode} camera`);
    }

    this.fx.render();
    input.endFrame();
  }
}
