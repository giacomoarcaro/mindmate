import * as THREE from 'three';
import { RAPIER, GROUP_BOAT, GROUP_LAND_VEHICLE, GROUP_PLAYER, GROUP_STATIC, GROUP_WATERWALL, groups, type Physics } from '../physics/physics';
import type { VehicleModel } from './models';

export interface Controls { throttle: number; steer: number; handbrake: boolean; boost?: boolean }

export interface CameraSpec {
  chaseDist: number;
  chaseHeight: number;
  /** hood camera position in vehicle space */
  hood: THREE.Vector3;
}

/** Common interface for the jeep, the moto taxi and the boat. */
export abstract class Vehicle {
  readonly object = new THREE.Group();
  body!: RAPIER.RigidBody;
  controls: Controls = { throttle: 0, steer: 0, handbrake: false };
  lightsOn = false;
  braking = false;
  abstract readonly name: string;
  abstract readonly kind: 'land' | 'water';
  abstract readonly camera: CameraSpec;
  /** top speed in km/h for the speedometer */
  abstract readonly maxKmh: number;
  /** passenger seats (vehicle space): hip position of a seated figure */
  seats: THREE.Vector3[] = [];
  /** figures currently riding */
  readonly riders = new THREE.Group();

  constructor(protected physics: Physics, readonly model: VehicleModel) {
    this.object.add(model.root);
    model.root.add(this.riders);
  }

  /** forward speed in m/s (negative when reversing) */
  abstract forwardSpeed(): number;
  abstract preStep(h: number): void;
  abstract syncVisual(time: number): void;

  /** Place at map coords with heading (radians clockwise from north). */
  place(x: number, y: number, h: number, heading: number) {
    const yaw = -heading;
    this.body.setTranslation({ x, y: h, z: -y }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.syncVisual(0);
  }

  position(out = new THREE.Vector3()) {
    const t = this.body.translation();
    return out.set(t.x, t.y, t.z);
  }

  quaternion(out = new THREE.Quaternion()) {
    const r = this.body.rotation();
    return out.set(r.x, r.y, r.z, r.w);
  }

  /** Heading in radians, clockwise from north (map convention). */
  heading() {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion());
    return Math.atan2(fwd.x, -fwd.z);
  }

  setEnabled(on: boolean) {
    if (this.body.isEnabled() !== on) this.body.setEnabled(on);
  }

  setLights(on: boolean) {
    this.lightsOn = on;
    for (const m of this.model.lights) m.emissiveIntensity = on ? 3 : 0.2;
  }

  protected updateBrakeLights() {
    for (const m of this.model.brakeLights) m.emissiveIntensity = this.braking ? 4 : this.lightsOn ? 1.2 : 0.2;
  }
}

// ---------------------------------------------------------------------------

export interface CarSpec {
  name: string;
  mass: number;
  halfExtents: [number, number, number];
  /** chassis collider offset (local) */
  colliderOffset: [number, number, number];
  /** center of mass (local), kept low for stability */
  com: [number, number, number];
  inertia: [number, number, number];
  wheels: { pos: [number, number, number]; steer: boolean; drive: boolean; rear: boolean }[];
  wheelRadius: number;
  suspensionRest: number;
  suspensionTravel: number;
  stiffness: number;
  compression: number;
  relaxation: number;
  friction: number;
  engineForce: number;
  reverseForce: number;
  brakeForce: number;
  maxSteer: number;
  maxKmh: number;
  camera: CameraSpec;
  /** motorcycle: the model leans into corners and the body is held upright more firmly */
  bike?: boolean;
  /** downforce coefficient (N per (m/s)^2): keeps fast vehicles planted */
  downforce?: number;
}

/** Ray-cast vehicle on Rapier's DynamicRayCastVehicleController. */
export class Car extends Vehicle {
  readonly kind = 'land' as const;
  readonly name: string;
  readonly camera: CameraSpec;
  readonly maxKmh: number;
  private ctrl: RAPIER.DynamicRayCastVehicleController;
  private wheelPivots: THREE.Object3D[] = [];
  private steer = 0;
  /** visual body attitude driven by acceleration (squat, dive, roll, bike lean) */
  private bodyPitch = 0;
  private bodyRoll = 0;
  private prevV = 0;
  private flipped = 0;

  constructor(physics: Physics, model: VehicleModel, readonly spec: CarSpec) {
    super(physics, model);
    this.name = spec.name;
    this.camera = spec.camera;
    this.maxKmh = spec.maxKmh;
    const rw = physics.rw;
    const [cx, cy, cz] = spec.com;
    const [ix, iy, iz] = spec.inertia;
    this.body = rw.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setAdditionalMassProperties(spec.mass, { x: cx, y: cy, z: cz }, { x: ix, y: iy, z: iz }, { x: 0, y: 0, z: 0, w: 1 })
        .setLinearDamping(0.05)
        .setAngularDamping(0.4)
        .setCanSleep(false),
    );
    const [hx, hy, hz] = spec.halfExtents;
    const [ox, oy, oz] = spec.colliderOffset;
    rw.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(ox, oy, oz).setDensity(0).setFriction(0.4)
        .setCollisionGroups(groups(GROUP_LAND_VEHICLE, GROUP_STATIC | GROUP_WATERWALL | GROUP_LAND_VEHICLE | GROUP_BOAT | GROUP_PLAYER)),
      this.body,
    );
    this.ctrl = rw.createVehicleController(this.body);
    (this.ctrl as unknown as { setIndexForwardAxis: number }).setIndexForwardAxis = 2;
    spec.wheels.forEach((w, i) => {
      this.ctrl.addWheel({ x: w.pos[0], y: w.pos[1], z: w.pos[2] }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, spec.suspensionRest, spec.wheelRadius);
      this.ctrl.setWheelSuspensionStiffness(i, spec.stiffness);
      this.ctrl.setWheelSuspensionCompression(i, spec.compression);
      this.ctrl.setWheelSuspensionRelaxation(i, spec.relaxation);
      this.ctrl.setWheelMaxSuspensionTravel(i, spec.suspensionTravel);
      this.ctrl.setWheelFrictionSlip(i, spec.friction);
      this.ctrl.setWheelMaxSuspensionForce(i, spec.mass * 40);
      const pivot = new THREE.Group();
      const wheel = model.wheel!.clone();
      pivot.add(wheel);
      this.object.add(pivot);
      this.wheelPivots.push(pivot);
    });
  }

  forwardSpeed() { return -this.ctrl.currentVehicleSpeed(); }

  wheelsOnGround() {
    let n = 0;
    for (let i = 0; i < this.spec.wheels.length; i++) if (this.ctrl.wheelIsInContact(i)) n++;
    return n;
  }

  preStep(h: number) {
    const s = this.spec;
    const { throttle, steer, handbrake } = this.controls;
    const v = this.forwardSpeed();
    // turbo: stronger engine and higher top speed while the charge lasts
    this.boosting = !!this.controls.boost && this.turbo > 0.02 && throttle > 0.05;
    this.turbo = Math.max(0, Math.min(1, this.turbo + (this.boosting ? -h / 2.6 : h / 8)));
    const vmax = (s.maxKmh / 3.6) * (this.boosting ? 1.25 : 1);
    let force = 0, brake = 0;
    if (throttle > 0.05) {
      if (v < -0.8) brake = s.brakeForce * throttle;
      else force = s.engineForce * (this.boosting ? 1.9 : 1) * throttle * Math.max(0, 1 - (v / vmax) ** 2);
    } else if (throttle < -0.05) {
      if (v > 0.8) brake = s.brakeForce * -throttle;
      else force = s.reverseForce * throttle * Math.max(0, 1 - (v / (vmax * 0.3)) ** 2);
    } else {
      brake = 120;
    }
    this.braking = brake > 150;
    // steering: full lock when slow, narrow and slower at speed; snaps back to center quickly
    const target = -steer * s.maxSteer / (1 + Math.abs(v) * 0.05);
    const rate = (Math.abs(target) < Math.abs(this.steer) ? 5.5 : 3.2 - Math.min(1.6, Math.abs(v) * 0.03)) * h;
    this.steer += Math.max(-rate, Math.min(rate, target - this.steer));
    const grounded = this.wheelsOnGround();
    // traction: launch wheelspin at low speed, grip falls a little when sliding sideways
    const lv0 = this.body.linvel();
    const q0 = this.quaternion();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q0);
    const lateral = lv0.x * right.x + lv0.z * right.z;
    const slide = Math.min(1, Math.abs(lateral) / 7);
    this.slip = Math.max(slide, handbrake && Math.abs(v) > 4 ? 1 : 0, throttle > 0.9 && Math.abs(v) < 4 ? 0.6 : 0);

    const drives = s.wheels.filter((w) => w.drive).length;
    s.wheels.forEach((w, i) => {
      this.ctrl.setWheelEngineForce(i, w.drive ? (-force / drives) : 0);
      this.ctrl.setWheelSteering(i, w.steer ? this.steer : 0);
      let b = brake;
      if (handbrake && w.rear) b = Math.max(b, s.brakeForce * 0.8);
      this.ctrl.setWheelBrake(i, b / 10);
      // rear grip drops on the handbrake (drift) and slightly while sliding; fronts keep biting
      const grip = w.rear ? (handbrake ? 0.42 : 1 - slide * 0.18) : 1 + slide * 0.08;
      this.ctrl.setWheelFrictionSlip(i, s.friction * grip);
    });
    if (handbrake) this.braking = true;
    this.ctrl.updateVehicle(h, undefined, groups(GROUP_LAND_VEHICLE, GROUP_STATIC));
    this.stabilize(h);
    const up0 = new THREE.Vector3(0, 1, 0).applyQuaternion(q0);
    if (grounded > 0) {
      // downforce presses the car onto the road at speed
      const df = (s.downforce ?? 0) * v * v * h;
      if (df > 0) this.body.applyImpulse({ x: -up0.x * df, y: -up0.y * df, z: -up0.z * df }, true);
      // yaw damping: stops the tail from snapping round unless the driver wants a drift
      if (!handbrake) {
        const av = this.body.angvel();
        const want = Math.abs(v) > 2 ? (v * Math.tan(this.steer)) / 2.7 : 0;
        const excess = av.y - Math.max(-2.2, Math.min(2.2, want));
        this.body.applyTorqueImpulse({ x: 0, y: -excess * s.inertia[1] * Math.min(1, 2.2 * h), z: 0 }, true);
      }
    } else {
      // a little air control so jumps land on the wheels
      const av = this.body.angvel();
      this.body.setAngvel({ x: av.x * (1 - 1.5 * h), y: av.y * (1 - 0.8 * h), z: av.z * (1 - 1.5 * h) }, true);
    }
    // upside down for a while: roll back onto the wheels
    this.flipped = up0.y < 0.15 && Math.abs(v) < 3 ? this.flipped + h : 0;
    if (this.flipped > 1.5) {
      const t = this.body.translation();
      const yaw = Math.atan2(-(2 * (q0.x * q0.z + q0.w * q0.y)), 1 - 2 * (q0.x * q0.x + q0.y * q0.y));
      this.body.setTranslation({ x: t.x, y: t.y + 1.2, z: t.z }, true);
      this.body.setRotation({ x: 0, y: Math.sin(-yaw / 2), z: 0, w: Math.cos(-yaw / 2) }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.flipped = 0;
    }
    // visual weight transfer: squat on throttle, dive on brakes, roll (or lean) in corners
    const acc = (v - this.prevV) / h;
    this.prevV = v;
    const latAcc = v * this.body.angvel().y;
    const k = Math.min(1, 6 * h);
    this.bodyPitch += (Math.max(-0.07, Math.min(0.07, acc * 0.006)) - this.bodyPitch) * k;
    const rollTarget = s.bike ? Math.max(-0.75, Math.min(0.75, -latAcc * 0.085)) : Math.max(-0.09, Math.min(0.09, latAcc * 0.007));
    this.bodyRoll += (rollTarget - this.bodyRoll) * k;

    // simple aerodynamic drag
    const lv = this.body.linvel();
    const sp = Math.hypot(lv.x, lv.y, lv.z);
    if (sp > 1) {
      const k = 0.42 * sp * h / s.mass * 3;
      this.body.applyImpulse({ x: -lv.x * k * s.mass / 3, y: 0, z: -lv.z * k * s.mass / 3 }, true);
    }
  }

  /** turbo charge 0..1 and whether it is firing */
  turbo = 1;
  boosting = false;

  /** 0..1 tire slip for sound and effects */
  slip = 0;

  /** Arcade anti-roll: pull the chassis up vector toward world up, damp roll/pitch rates. */
  private stabilize(h: number) {
    const q = this.quaternion();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const axis = up.clone().cross(new THREE.Vector3(0, 1, 0));
    const av = this.body.angvel();
    const w = new THREE.Vector3(av.x, 0, av.z);
    const grounded = this.wheelsOnGround();
    const k = (grounded >= this.spec.wheels.length - 1 ? 0.5 : 2.0) * (this.spec.bike ? 2.5 : 1);
    const I = this.spec.inertia[2];
    const imp = axis.multiplyScalar(9 * k).sub(w.multiplyScalar(1.6 * k)).multiplyScalar(I * h);
    this.body.applyTorqueImpulse({ x: imp.x, y: 0, z: imp.z }, true);
  }

  syncVisual() {
    const t = this.body.translation(), r = this.body.rotation();
    this.object.position.set(t.x, t.y, t.z);
    this.object.quaternion.set(r.x, r.y, r.z, r.w);
    this.spec.wheels.forEach((w, i) => {
      const len = this.ctrl.wheelSuspensionLength(i) ?? this.spec.suspensionRest;
      const p = this.wheelPivots[i];
      p.position.set(w.pos[0], w.pos[1] - len, w.pos[2]);
      p.rotation.set(-(this.ctrl.wheelRotation(i) ?? 0), this.ctrl.wheelSteering(i) ?? 0, 0, 'YXZ');
    });
    // body attitude; a bike leans around its tire contact line
    this.model.root.rotation.set(this.bodyPitch, 0, this.bodyRoll);
    this.updateBrakeLights();
  }
}

// ---------------------------------------------------------------------------

/** Arcade motorboat: planar rigid body that only moves on the lagoon. */
export class Boat extends Vehicle {
  readonly kind = 'water' as const;
  readonly name = 'Lancha';
  readonly maxKmh = 85;
  readonly camera: CameraSpec = { chaseDist: 9.5, chaseHeight: 3.4, hood: new THREE.Vector3(0.35, 1.9, 0.3) };
  private pitch = 0;
  private roll = 0;
  private lastV = 0;

  constructor(physics: Physics, model: VehicleModel) {
    super(physics, model);
    const rw = physics.rw;
    this.body = rw.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setGravityScale(0)
        .enabledTranslations(true, false, true)
        .enabledRotations(false, true, false)
        .setLinearDamping(0.25)
        .setAngularDamping(2.5)
        .setCanSleep(false),
    );
    rw.createCollider(
      RAPIER.ColliderDesc.cuboid(1.0, 0.45, 2.7).setTranslation(0, 0.35, -0.2).setMass(900).setFriction(0.2).setRestitution(0.2)
        .setCollisionGroups(groups(GROUP_BOAT, GROUP_STATIC | GROUP_WATERWALL | GROUP_LAND_VEHICLE)),
      this.body,
    );
  }

  forwardSpeed() {
    const lv = this.body.linvel();
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion());
    return lv.x * f.x + lv.z * f.z;
  }

  preStep(h: number) {
    const { throttle, steer } = this.controls;
    const q = this.quaternion();
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const r = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const lv = this.body.linvel();
    const vF = lv.x * f.x + lv.z * f.z;
    const vR = lv.x * r.x + lv.z * r.z;
    const mass = this.body.mass();
    const vmax = this.maxKmh / 3.6;
    let thrust = throttle > 0 ? throttle * 11000 * Math.max(0, 1 - (vF / vmax) ** 2) : throttle * 3000 * Math.max(0, 1 + vF / 5);
    if (this.controls.handbrake) thrust = -Math.sign(vF) * 4000;
    this.braking = throttle < 0 && vF > 0.5;
    // keel: kill most sideways motion
    const keel = -vR * mass * Math.min(1, 3.5 * h);
    this.body.applyImpulse({ x: f.x * thrust * h + r.x * keel, y: 0, z: f.z * thrust * h + r.z * keel }, true);
    // rudder: yaw rate grows with speed
    const yawTarget = -steer * 0.85 * Math.max(0.25, Math.min(1, Math.abs(vF) / 5)) * (vF < -0.3 ? -1 : 1);
    const av = this.body.angvel();
    this.body.setAngvel({ x: 0, y: av.y + (yawTarget - av.y) * Math.min(1, 3 * h), z: 0 }, true);
    // visual attitude
    const acc = (vF - this.lastV) / h;
    this.lastV = vF;
    this.pitch += ((Math.min(0.12, Math.max(0, vF) * 0.008) - acc * 0.004) - this.pitch) * Math.min(1, 2 * h);
    this.roll += (steer * Math.min(1, Math.abs(vF) / 10) * 0.12 - this.roll) * Math.min(1, 2 * h);
  }

  syncVisual(time: number) {
    const t = this.body.translation(), r = this.body.rotation();
    this.object.position.set(t.x, Math.sin(time * 1.7) * 0.05, t.z);
    this.object.quaternion.set(r.x, r.y, r.z, r.w);
    this.model.root.rotation.set(this.pitch + Math.sin(time * 1.3) * 0.015, 0, this.roll + Math.sin(time * 1.1) * 0.02);
    this.model.root.position.y = -0.2;
    this.updateBrakeLights();
  }

  place(x: number, y: number, _h: number, heading: number) {
    super.place(x, y, 0, heading);
  }
}
