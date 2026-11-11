/** DOM overlay: speedometer, info panel, street name, toasts, help and credits. */
export class Hud {
  readonly root: HTMLElement;
  private info: HTMLElement;
  private speedo: HTMLCanvasElement;
  private street: HTMLElement;
  private toast: HTMLElement;
  private msg: HTMLElement;
  private help: HTMLElement;
  private toastTimer = 0;
  private msgTimer = 0;
  private lastStreet = '';
  readonly minimapHost: HTMLElement;

  constructor() {
    this.root = document.getElementById('hud')!;
    this.root.innerHTML = `
      <div class="topleft panel" id="hud-info"></div>
      <div class="minimap" id="hud-minimap"></div>
      <canvas class="speedo" id="hud-speedo" width="340" height="340"></canvas>
      <div class="street" id="hud-street"></div>
      <div class="toast" id="hud-toast"></div>
      <div class="message panel" id="hud-msg"></div>
      <div class="help panel" id="hud-help"></div>
      <div class="credit">Map data © OpenStreetMap contributors</div>`;
    this.info = document.getElementById('hud-info')!;
    this.speedo = document.getElementById('hud-speedo') as HTMLCanvasElement;
    this.street = document.getElementById('hud-street')!;
    this.toast = document.getElementById('hud-toast')!;
    this.msg = document.getElementById('hud-msg')!;
    this.help = document.getElementById('hud-help')!;
    this.minimapHost = document.getElementById('hud-minimap')!;
    this.setHelp(true);
  }

  setHelp(visible: boolean) {
    this.help.style.display = visible ? '' : 'none';
    this.help.innerHTML = `
      <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / arrows drive &nbsp; <kbd>Space</kbd> handbrake<br>
      <kbd>1</kbd> Jeep &nbsp; <kbd>2</kbd> Mototaxi &nbsp; <kbd>3</kbd> Boat &nbsp; <kbd>E</kbd> enter / exit<br>
      <kbd>C</kbd> camera &nbsp; <kbd>F</kbd> drone &nbsp; <kbd>R</kbd> reset &nbsp; <kbd>T</kbd> skip time &nbsp; <kbd>P</kbd> rain<br>
      <kbd>H</kbd> hide help &nbsp; click to use the mouse for looking around`;
  }

  setInfo(html: string) { this.info.innerHTML = html; }

  setStreet(name: string, sub = '') {
    const key = name + '|' + sub;
    if (key === this.lastStreet) return;
    this.lastStreet = key;
    this.street.innerHTML = name ? `${escapeHtml(name)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}` : '';
  }

  showToast(title: string, sub = '', seconds = 3.5) {
    this.toast.innerHTML = `${escapeHtml(title)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}`;
    this.toast.classList.add('show');
    this.toastTimer = seconds;
  }

  message(text: string, seconds = 2.5) {
    this.msg.textContent = text;
    this.msg.classList.add('show');
    this.msgTimer = seconds;
  }

  update(dt: number) {
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.toast.classList.remove('show');
    if (this.msgTimer > 0 && (this.msgTimer -= dt) <= 0) this.msg.classList.remove('show');
  }

  /** Analog speedometer in km/h. */
  drawSpeed(kmh: number, max: number, label: string) {
    const c = this.speedo, g = c.getContext('2d')!;
    const W = c.width, cx = W / 2, cy = W / 2, R = W * 0.44;
    g.clearRect(0, 0, W, W);
    g.fillStyle = 'rgba(8, 24, 36, 0.55)';
    g.beginPath(); g.arc(cx, cy, R + 14, 0, Math.PI * 2); g.fill();
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const top = Math.ceil(max / 20) * 20;
    g.lineWidth = 10;
    g.strokeStyle = 'rgba(255,255,255,0.15)';
    g.beginPath(); g.arc(cx, cy, R, a0, a1); g.stroke();
    const frac = Math.min(1, Math.abs(kmh) / top);
    const grad = g.createLinearGradient(0, W, W, 0);
    grad.addColorStop(0, '#43c9cb'); grad.addColorStop(1, '#f2a541');
    g.strokeStyle = grad;
    g.beginPath(); g.arc(cx, cy, R, a0, a0 + (a1 - a0) * frac); g.stroke();
    g.fillStyle = '#fff';
    g.font = '600 20px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let v = 0; v <= top; v += top > 100 ? 20 : 10) {
      const a = a0 + (a1 - a0) * (v / top);
      g.globalAlpha = 0.75;
      g.fillText(String(v), cx + Math.cos(a) * (R - 32), cy + Math.sin(a) * (R - 32));
    }
    g.globalAlpha = 1;
    const na = a0 + (a1 - a0) * frac;
    g.strokeStyle = '#ff5a3c'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(na) * (R - 8), cy + Math.sin(na) * (R - 8)); g.stroke();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(cx, cy, 8, 0, Math.PI * 2); g.fill();
    g.font = '700 52px system-ui, sans-serif';
    g.fillText(String(Math.round(Math.abs(kmh))), cx, cy + R * 0.42);
    g.font = '500 18px system-ui, sans-serif';
    g.globalAlpha = 0.8;
    g.fillText(`km/h · ${label}`, cx, cy + R * 0.7);
    g.globalAlpha = 1;
  }

  showSpeedo(v: boolean) { this.speedo.style.display = v ? '' : 'none'; }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
