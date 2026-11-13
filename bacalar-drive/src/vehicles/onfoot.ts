import * as THREE from 'three';
import { RAPIER, GROUP_LAND_VEHICLE, GROUP_PLAYER, GROUP_STATIC, GROUP_WATERWALL, groups, type Physics } from '../physics/physics';
import { personModel } from './models';

/** Walking character on Rapier's kinematic character controller. */
export class OnFoot {
  readonly object = new THREE.Group();
  readonly body: RAPIER.RigidBody;
  private collider: RAPIER.Collider;
  private cc: RAPIER.KinematicCharacterController;
  private model = personModel();
  private vy = 0;
  private walkPhase = 0;
  yaw = 0;
  speed = 0;

  constructor(private physics: Physics) {
    const rw = physics.rw;
    this.body = rw.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.collider = rw.createCollider(
      RAPIER.ColliderDesc.capsule(0.55, 0.3).setTranslation(0, 0.85, 0)
        .setCollisionGroups(groups(GROUP_PLAYER, GROUP_STATIC | GROUP_WATERWALL | GROUP_LAND_VEHICLE)),
      this.body,
    );
    this.cc = rw.createCharacterController(0.05);
    this.cc.enableAutostep(0.45, 0.2, true);
    this.cc.enableSnapToGround(0.6);
    this.cc.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
    this.cc.setApplyImpulsesToDynamicBodies(true);
    this.object.add(this.model.root);
  }

  place(x: number, y: number, h: number, heading: number) {
    this.body.setTranslation({ x, y: h + 0.05, z: -y }, true);
    this.body.setNextKinematicTranslation({ x, y: h + 0.05, z: -y });
    this.yaw = -heading;
    this.vy = 0;
    this.sync(0);
  }

  setEnabled(on: boolean) {
    this.body.setEnabled(on);
    this.object.visible = on;
  }

  position(out = new THREE.Vector3()) {
    const t = this.body.translation();
    return out.set(t.x, t.y, t.z);
  }

  heading() { return -this.yaw; }

  /** move: x right, y forward relative to camera yaw */
  step(h: number, moveX: number, moveY: number, run: boolean, camYaw: number, jump: boolean) {
    const len = Math.hypot(moveX, moveY);
    const speed = len > 0.05 ? (run ? 7.5 : 3.2) : 0;
    let dx = 0, dz = 0;
    if (speed > 0) {
      const a = Math.atan2(moveX, moveY);
      const yaw = camYaw - a;
      dx = -Math.sin(yaw) * speed * h;
      dz = -Math.cos(yaw) * speed * h;
      // turn the character toward the movement direction
      let d = yaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, 10 * h);
    }
    const grounded = this.cc.computedGrounded();
    if (grounded) {
      this.vy = jump ? 5 : -1;
    } else this.vy -= 9.81 * h;
    this.cc.computeColliderMovement(this.collider, { x: dx, y: this.vy * h, z: dz }, undefined, groups(GROUP_PLAYER, GROUP_STATIC | GROUP_WATERWALL | GROUP_LAND_VEHICLE));
    const m = this.cc.computedMovement();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    this.speed = speed;
    if (t.y < -30) this.vy = 0;
  }

  sync(time: number) {
    const t = this.body.translation();
    this.object.position.set(t.x, t.y, t.z);
    this.object.rotation.set(0, this.yaw, 0);
    this.walkPhase = this.speed > 0 ? time * (this.speed > 4 ? 11 : 7) : this.walkPhase * 0.9;
    const s = this.speed > 0 ? Math.sin(this.walkPhase) * (this.speed > 4 ? 0.8 : 0.5) : 0;
    const L = this.model.limbs;
    L.hipL.rotation.x = s; L.hipR.rotation.x = -s;
    L.shL.rotation.x = -s * 0.8; L.shR.rotation.x = s * 0.8;
  }
}
