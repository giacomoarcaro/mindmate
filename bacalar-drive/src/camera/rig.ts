import * as THREE from 'three';
import type { Input } from '../input';

export type CamMode = 'chase' | 'hood' | 'top';
export const CAM_MODES: CamMode[] = ['chase', 'hood', 'top'];

export interface CamTarget {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  chaseDist: number;
  chaseHeight: number;
  hood: THREE.Vector3;
  speed: number;
}

/** Chase / hood / top-down camera following a vehicle or the walking player. */
export class CameraRig {
  mode: CamMode = 'chase';
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private yaw = 0;
  private orbit = 0;
  private orbitPitch = 0;
  private orbitIdle = 0;
  private initialized = false;

  constructor(private camera: THREE.PerspectiveCamera) {}

  cycle() {
    this.mode = CAM_MODES[(CAM_MODES.indexOf(this.mode) + 1) % CAM_MODES.length];
    this.initialized = false;
  }

  snap() { this.initialized = false; }

  /** Yaw of the camera view (three.js convention) for on-foot movement. */
  viewYaw() {
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    return e.y;
  }

  update(dt: number, t: CamTarget, input: Input, groundAt: (x: number, z: number) => number) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(t.quaternion);
    const targetYaw = Math.atan2(-fwd.x, -fwd.z);
    if (!this.initialized) this.yaw = targetYaw;
    let dy = targetYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * Math.min(1, dt * (2.5 + Math.abs(t.speed) * 0.08));

    // mouse orbit in chase mode, drifting back after a moment
    if (input.mouseDX || input.mouseDY) {
      this.orbit -= input.mouseDX * 0.004;
      this.orbitPitch = Math.max(-0.3, Math.min(0.9, this.orbitPitch + input.mouseDY * 0.003));
      this.orbitIdle = 0;
    } else {
      this.orbitIdle += dt;
      if (this.orbitIdle > 1.5) {
        this.orbit *= Math.exp(-dt * 2);
        this.orbitPitch *= Math.exp(-dt * 2);
      }
    }
    const gp = input.gamepad;
    if (gp && Math.abs(gp.axes[2] ?? 0) > 0.15) { this.orbit -= gp.axes[2] * dt * 2.5; this.orbitIdle = 0; }

    const cam = this.camera;
    if (this.mode === 'chase') {
      const yaw = this.yaw + this.orbit;
      const dist = t.chaseDist + Math.min(4, Math.abs(t.speed) * 0.06);
      const height = t.chaseHeight + this.orbitPitch * t.chaseDist;
      const desired = new THREE.Vector3(
        t.position.x + Math.sin(yaw) * dist,
        t.position.y + height,
        t.position.z + Math.cos(yaw) * dist,
      );
      const g = groundAt(desired.x, desired.z) + 0.8;
      if (desired.y < g) desired.y = g;
      const lookAt = t.position.clone().add(new THREE.Vector3(0, t.chaseHeight * 0.45, 0));
      if (!this.initialized) { this.pos.copy(desired); this.look.copy(lookAt); this.initialized = true; }
      this.pos.lerp(desired, 1 - Math.exp(-dt * 8));
      this.look.lerp(lookAt, 1 - Math.exp(-dt * 14));
      cam.position.copy(this.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
    } else if (this.mode === 'hood') {
      const p = t.hood.clone().applyQuaternion(t.quaternion).add(t.position);
      cam.position.copy(p);
      // keep the horizon steady: blend vehicle orientation with a level one
      const level = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, targetYaw + this.orbit, 0, 'YXZ'));
      const q = t.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.04, this.orbit, 0, 'YXZ')));
      cam.quaternion.copy(level.slerp(q, 0.6));
      this.initialized = true;
    } else {
      const height = 70 + Math.abs(t.speed) * 1.2;
      const desired = new THREE.Vector3(t.position.x, t.position.y + height, t.position.z);
      if (!this.initialized) { this.pos.copy(desired); this.initialized = true; }
      this.pos.lerp(desired, 1 - Math.exp(-dt * 5));
      cam.position.copy(this.pos);
      cam.up.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      cam.lookAt(t.position);
      cam.up.set(0, 1, 0);
    }
  }
}
