/** Keyboard, mouse (pointer lock) and gamepad state. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  pointerLocked = false;
  gamepad: Gamepad | null = null;
  private padPrev: boolean[] = [];
  /** analog values from the on-screen touch controls */
  readonly touch = { active: false, steer: 0, throttle: 0, handbrake: false };

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    el.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    el.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => { this.pointerLocked = document.pointerLockElement === el; });
  }

  requestPointerLock() {
    if (!this.pointerLocked) this.el.requestPointerLock?.();
  }

  isDown(code: string) { return this.down.has(code); }

  /** Press or release a key from the on-screen controls. */
  setVirtual(code: string, on: boolean) {
    if (on) {
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
    } else this.down.delete(code);
  }

  /** One-shot press (buttons such as camera or enter / exit). */
  tap(code: string) { this.pressed.add(code); }

  /** True once per key press. */
  wasPressed(code: string) { return this.pressed.has(code); }

  /** Call once per frame after game logic. */
  endFrame() {
    this.pressed.clear();
    this.mouseDX = this.mouseDY = 0;
    this.wheel = 0;
  }

  /** Poll gamepad and convert button edges into virtual key presses. */
  pollGamepad() {
    const pads = navigator.getGamepads?.() ?? [];
    this.gamepad = null;
    for (const p of pads) if (p && p.connected) { this.gamepad = p; break; }
    const gp = this.gamepad;
    if (!gp) return;
    // Standard mapping: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 8 back, 9 start, 12-15 dpad
    const map: Record<number, string> = { 1: 'KeyE', 2: 'KeyR', 3: 'KeyC', 8: 'KeyF', 9: 'KeyT', 12: 'Digit1', 13: 'Digit2', 14: 'Digit3', 15: 'KeyP' };
    gp.buttons.forEach((b, i) => {
      const was = this.padPrev[i] ?? false;
      if (b.pressed && !was && map[i]) this.pressed.add(map[i]);
      this.padPrev[i] = b.pressed;
    });
  }

  /** Throttle -1..1, steer -1..1 (positive = right), handbrake. */
  driveAxes() {
    let throttle = 0, steer = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) throttle += 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) throttle -= 1;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) steer -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) steer += 1;
    let handbrake = this.isDown('Space');
    const t = this.touch;
    if (t.active) {
      if (Math.abs(t.steer) > 0.04) steer = t.steer;
      if (t.throttle) throttle = t.throttle;
      if (t.handbrake) handbrake = true;
    }
    const gp = this.gamepad;
    if (gp) {
      const rt = gp.buttons[7]?.value ?? 0, lt = gp.buttons[6]?.value ?? 0;
      if (Math.abs(rt - lt) > 0.05) throttle = rt - lt;
      const ax = gp.axes[0] ?? 0;
      if (Math.abs(ax) > 0.12) steer = ax;
      if (gp.buttons[0]?.pressed) handbrake = true;
    }
    return { throttle, steer, handbrake };
  }
}
