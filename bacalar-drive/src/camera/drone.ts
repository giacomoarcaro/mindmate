import * as THREE from 'three';
import type { Input } from '../input';

/** Free-fly drone camera: WASD move, mouse or arrow keys look, Space up, Z/Ctrl down, Shift boost. */
export class DroneCamera {
  yaw = 0;
  pitch = -0.35;
  readonly pos = new THREE.Vector3();
  private vel = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera) {}

  /** Start from the camera's current transform. */
  takeOver() {
    this.pos.copy(this.camera.position);
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = e.y;
    this.pitch = e.x;
    this.vel.set(0, 0, 0);
  }

  update(dt: number, input: Input, groundAt: (x: number, z: number) => number) {
    const look = 1.8 * dt;
    this.yaw -= input.mouseDX * 0.0022;
    this.pitch -= input.mouseDY * 0.0022;
    if (input.isDown('ArrowLeft')) this.yaw += look;
    if (input.isDown('ArrowRight')) this.yaw -= look;
    if (input.isDown('ArrowUp')) this.pitch += look * 0.6;
    if (input.isDown('ArrowDown')) this.pitch -= look * 0.6;
    const gp = input.gamepad;
    if (gp) {
      if (Math.abs(gp.axes[2] ?? 0) > 0.12) this.yaw -= gp.axes[2] * look;
      if (Math.abs(gp.axes[3] ?? 0) > 0.12) this.pitch -= gp.axes[3] * look * 0.6;
    }
    this.pitch = Math.max(-1.5, Math.min(1.4, this.pitch));

    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3();
    if (input.isDown('KeyW')) wish.add(fwd);
    if (input.isDown('KeyS')) wish.sub(fwd);
    if (input.isDown('KeyD')) wish.add(right);
    if (input.isDown('KeyA')) wish.sub(right);
    if (gp) {
      if (Math.abs(gp.axes[1] ?? 0) > 0.12) wish.addScaledVector(fwd, -gp.axes[1]);
      if (Math.abs(gp.axes[0] ?? 0) > 0.12) wish.addScaledVector(right, gp.axes[0]);
    }
    if (input.isDown('Space')) wish.y += 1;
    if (input.isDown('KeyZ') || input.isDown('ControlLeft')) wish.y -= 1;
    const altitude = this.pos.y - groundAt(this.pos.x, this.pos.z);
    const speed = (input.isDown('ShiftLeft') || input.isDown('ShiftRight') ? 160 : 40) * (1 + Math.max(0, altitude) / 120);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
    this.vel.lerp(wish, 1 - Math.exp(-dt * 4));
    this.pos.addScaledVector(this.vel, dt);
    const minY = groundAt(this.pos.x, this.pos.z) + 1.5;
    if (this.pos.y < minY) this.pos.y = minY;
    this.pos.y = Math.min(this.pos.y, 2500);

    this.camera.position.copy(this.pos);
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }
}
