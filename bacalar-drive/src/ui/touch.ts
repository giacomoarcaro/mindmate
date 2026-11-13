import type { Input } from '../input';

/**
 * On-screen controls for phones and tablets: a steering stick on the left, gas and brake
 * pedals on the right, action buttons along the top, and drag anywhere else to look around.
 * On foot the stick walks (it presses virtual WASD keys).
 */
export class TouchControls {
  readonly root: HTMLElement;
  private stickId: number | null = null;
  private lookId: number | null = null;
  private lookX = 0;
  private lookY = 0;
  private origin = { x: 0, y: 0 };
  onFoot = () => false;

  constructor(private input: Input, canvas: HTMLCanvasElement) {
    input.touch.active = true;
    document.body.classList.add('touch');
    const root = document.createElement('div');
    root.id = 'touch';
    root.innerHTML = `
      <div class="tc-stick" id="tc-stick"><div class="tc-ring"></div><div class="tc-knob" id="tc-knob"></div></div>
      <div class="tc-pedals">
        <button class="tc-btn tc-brake" id="tc-brake">FRENO</button>
        <button class="tc-btn tc-gas" id="tc-gas">GAS</button>
      </div>
      <button class="tc-btn tc-hb" id="tc-hb">FRENO DE MANO</button>
      <div class="tc-top">
        <button class="tc-btn tc-small" data-key="KeyE">Bajar</button>
        <button class="tc-btn tc-small" data-key="KeyC">Cámara</button>
        <button class="tc-btn tc-small" data-key="Digit1">Jeep</button>
        <button class="tc-btn tc-small" data-key="Digit2">Mototaxi</button>
        <button class="tc-btn tc-small" data-key="Digit4">Moto</button>
        <button class="tc-btn tc-small" data-key="Digit3">Lancha</button>
        <button class="tc-btn tc-small" data-key="KeyR">Reinicio</button>
        <button class="tc-btn tc-small" data-key="KeyG">Claxon</button>
        <button class="tc-btn tc-small" data-key="KeyM">Sonido</button>
        <button class="tc-btn tc-small" id="tc-full">Pantalla</button>
      </div>
      <div class="tc-rotate" id="tc-rotate"><div>Gira el teléfono para jugar mejor</div><small>Toca para cerrar</small></div>`;
    document.body.appendChild(root);
    this.root = root;

    const stick = root.querySelector<HTMLElement>('#tc-stick')!;
    const knob = root.querySelector<HTMLElement>('#tc-knob')!;
    const R = 52;
    const setStick = (dx: number, dy: number) => {
      const l = Math.hypot(dx, dy);
      if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const sx = dx / R, sy = -dy / R;
      input.touch.steer = Math.abs(sx) < 0.08 ? 0 : sx;
      // on foot the stick walks in every direction
      const walk = this.onFoot();
      input.setVirtual('KeyW', walk && sy > 0.35);
      input.setVirtual('KeyS', walk && sy < -0.35);
      input.setVirtual('KeyA', walk && sx < -0.35);
      input.setVirtual('KeyD', walk && sx > 0.35);
      input.setVirtual('ShiftLeft', walk && Math.hypot(sx, sy) > 0.92);
    };
    stick.addEventListener('pointerdown', (e) => {
      this.stickId = e.pointerId;
      try { stick.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const r = stick.getBoundingClientRect();
      this.origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      setStick(e.clientX - this.origin.x, e.clientY - this.origin.y);
      e.preventDefault();
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      setStick(e.clientX - this.origin.x, e.clientY - this.origin.y);
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      setStick(0, 0);
    };
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);

    const hold = (id: string, set: (on: boolean) => void) => {
      const el = root.querySelector<HTMLElement>(id)!;
      const on = (e: PointerEvent) => { try { el.setPointerCapture(e.pointerId); } catch { /* synthetic or already released */ } el.classList.add('on'); set(true); e.preventDefault(); };
      const off = () => { el.classList.remove('on'); set(false); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
    };
    let gas = false, brake = false;
    const pedals = () => { input.touch.throttle = (gas ? 1 : 0) - (brake ? 1 : 0); };
    hold('#tc-gas', (on) => { gas = on; pedals(); });
    hold('#tc-brake', (on) => { brake = on; pedals(); });
    hold('#tc-hb', (on) => { input.touch.handbrake = on; input.setVirtual('Space', on); });

    root.querySelectorAll<HTMLElement>('[data-key]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => { input.tap(b.dataset.key!); e.preventDefault(); });
    });
    root.querySelector('#tc-full')!.addEventListener('click', () => {
      const d = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
      if (document.fullscreenElement) void document.exitFullscreen?.();
      else if (d.requestFullscreen) d.requestFullscreen().catch(() => undefined);
      else d.webkitRequestFullscreen?.();
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      o?.lock?.('landscape').catch(() => undefined);
    });
    root.querySelector('#tc-rotate')!.addEventListener('click', (e) => (e.currentTarget as HTMLElement).classList.add('hidden'));

    // drag on the 3D view to look around
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || this.lookId !== null) return;
      this.lookId = e.pointerId;
      this.lookX = e.clientX; this.lookY = e.clientY;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      input.mouseDX += (e.clientX - this.lookX) * 1.6;
      input.mouseDY += (e.clientY - this.lookY) * 1.6;
      this.lookX = e.clientX; this.lookY = e.clientY;
    });
    const endLook = (e: PointerEvent) => { if (e.pointerId === this.lookId) this.lookId = null; };
    canvas.addEventListener('pointerup', endLook);
    canvas.addEventListener('pointercancel', endLook);
    for (const el of [root, canvas]) el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** True on phones and tablets (coarse pointer and no fine pointer). */
  static wanted() {
    if (/[?&]touch\b/.test(location.search)) return true;
    return matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
  }
}
