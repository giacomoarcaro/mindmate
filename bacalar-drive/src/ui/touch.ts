import type { Input } from '../input';

/**
 * One-thumb controls for phones: the car accelerates by itself, sliding a finger anywhere
 * steers, FRENO brakes (and reverses when stopped), TURBO fires the boost. Works in portrait
 * and landscape. Small buttons open the menu, change the camera and switch vehicle.
 */
export class TouchControls {
  readonly root: HTMLElement;
  private steerId: number | null = null;
  private startX = 0;
  /** false while a menu is open or outside a vehicle: no automatic throttle */
  autoGas = true;
  onMenu: () => void = () => undefined;

  constructor(private input: Input, canvas: HTMLCanvasElement) {
    input.touch.active = true;
    document.body.classList.add('touch');
    const root = document.createElement('div');
    root.id = 'touch';
    root.innerHTML = `
      <div class="tc-wheel" id="tc-wheel"><i></i></div>
      <div class="tc-hint" id="tc-hint">Desliza el dedo para girar</div>
      <button class="tc-btn tc-brake" id="tc-brake">FRENO</button>
      <button class="tc-btn tc-turbo" id="tc-turbo">TURBO</button>
      <div class="tc-top">
        <button class="tc-btn tc-small" id="tc-menu">Menú</button>
        <button class="tc-btn tc-small" data-key="KeyC">Cámara</button>
        <button class="tc-btn tc-small" data-key="KeyV">Vehículo</button>
        <button class="tc-btn tc-small" data-key="KeyG">Claxon</button>
      </div>`;
    document.body.appendChild(root);
    this.root = root;
    const wheel = root.querySelector<HTMLElement>('#tc-wheel')!;
    const dot = wheel.firstElementChild as HTMLElement;
    const hint = root.querySelector<HTMLElement>('#tc-hint')!;

    let brake = false;
    const apply = () => { input.touch.throttle = brake ? -1 : this.autoGas ? 1 : 0; };
    setInterval(apply, 100);

    // steering: horizontal distance from where the finger first touched
    const RANGE = 78;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || this.steerId !== null) return;
      this.steerId = e.pointerId;
      this.startX = e.clientX;
      wheel.style.left = `${e.clientX}px`;
      wheel.style.top = `${e.clientY}px`;
      wheel.classList.add('on');
      hint.classList.add('gone');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.steerId) return;
      let s = (e.clientX - this.startX) / RANGE;
      // let the anchor follow the finger so a long swipe never gets "stuck" at full lock
      if (s > 1) { this.startX = e.clientX - RANGE; s = 1; }
      if (s < -1) { this.startX = e.clientX + RANGE; s = -1; }
      input.touch.steer = Math.abs(s) < 0.06 ? 0 : s;
      dot.style.transform = `translateX(${s * 34}px)`;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.steerId) return;
      this.steerId = null;
      input.touch.steer = 0;
      wheel.classList.remove('on');
      dot.style.transform = '';
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    const hold = (id: string, set: (on: boolean) => void) => {
      const el = root.querySelector<HTMLElement>(id)!;
      const on = (e: PointerEvent) => { try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ } el.classList.add('on'); set(true); e.preventDefault(); };
      const off = () => { el.classList.remove('on'); set(false); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
    };
    hold('#tc-brake', (on) => { brake = on; apply(); });
    hold('#tc-turbo', (on) => { input.touch.boost = on; });

    root.querySelectorAll<HTMLElement>('[data-key]').forEach((b) => {
      b.addEventListener('pointerdown', (e) => { input.tap(b.dataset.key!); e.preventDefault(); });
    });
    root.querySelector('#tc-menu')!.addEventListener('click', () => this.onMenu());
    for (const el of [root, canvas]) el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** True on phones and tablets (coarse pointer and no fine pointer). */
  static wanted() {
    if (/[?&]touch\b/.test(location.search)) return true;
    return matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
  }
}
