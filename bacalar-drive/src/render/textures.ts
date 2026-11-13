import * as THREE from 'three';

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function speckle(g: CanvasRenderingContext2D, s: number, base: string, colors: string[], n: number, seed: number, rmax = 1.5) {
  g.fillStyle = base;
  g.fillRect(0, 0, s, s);
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.globalAlpha = 0.25 + r() * 0.5;
    const rr = 0.4 + r() * rmax;
    g.fillRect(r() * s, r() * s, rr, rr);
  }
  g.globalAlpha = 1;
}

export function asphaltTexture() {
  return canvasTex(256, (g, s) => {
    speckle(g, s, '#4a4a4c', ['#3a3a3c', '#5c5c5e', '#444447', '#626264'], 9000, 1);
    // patches and cracks
    const r = rng(7);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = `rgba(30,30,32,${0.08 + r() * 0.1})`;
      g.beginPath();
      g.ellipse(r() * s, r() * s, 10 + r() * 30, 6 + r() * 20, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
  });
}

export function dirtTexture() {
  // sascab: white limestone dirt
  return canvasTex(256, (g, s) => {
    speckle(g, s, '#d9cfb4', ['#c7bb9b', '#e8e0c8', '#b8a983', '#efe8d5'], 10000, 2, 2.2);
    const r = rng(9);
    for (let i = 0; i < 2; i++) {
      // wheel ruts
      g.fillStyle = 'rgba(150,135,100,0.18)';
      g.fillRect(s * (0.22 + i * 0.5) + r() * 4, 0, s * 0.08, s);
    }
  });
}

export function concreteTexture() {
  return canvasTex(128, (g, s) => {
    speckle(g, s, '#bdb8ad', ['#a9a49a', '#cdc8bd'], 2500, 3);
    g.strokeStyle = 'rgba(80,80,80,0.35)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, 0.5); g.lineTo(s, 0.5); g.stroke();
  });
}

export function woodTexture() {
  return canvasTex(256, (g, s) => {
    g.fillStyle = '#8a6440';
    g.fillRect(0, 0, s, s);
    const r = rng(4);
    const planks = 8;
    for (let p = 0; p < planks; p++) {
      const x = (p / planks) * s;
      const shade = 0.85 + r() * 0.3;
      g.fillStyle = `rgb(${Math.floor(140 * shade)},${Math.floor(100 * shade)},${Math.floor(64 * shade)})`;
      g.fillRect(x + 1, 0, s / planks - 2, s);
      for (let k = 0; k < 30; k++) {
        g.fillStyle = `rgba(60,40,20,${0.1 + r() * 0.15})`;
        g.fillRect(x + 2 + r() * (s / planks - 4), r() * s, 1, 10 + r() * 40);
      }
      g.fillStyle = 'rgba(40,25,10,0.8)';
      g.fillRect(x, 0, 1.5, s);
    }
  });
}

export function stoneTexture() {
  return canvasTex(256, (g, s) => {
    speckle(g, s, '#b9ad94', ['#a29680', '#cfc4aa', '#8f846f'], 6000, 5, 2);
    const r = rng(11);
    g.strokeStyle = 'rgba(70,60,45,0.45)';
    g.lineWidth = 1.5;
    const rows = 8;
    for (let j = 0; j < rows; j++) {
      const y = (j / rows) * s;
      g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke();
      let x = (j % 2) * 16;
      while (x < s) {
        g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + s / rows); g.stroke();
        x += 20 + r() * 26;
      }
    }
  });
}

/** Facade: white base with windows, tinted by vertex colors. 1 texture unit = 3 m wide x 3 m tall. */
export function facadeTexture() {
  return canvasTex(512, (g, s) => {
    speckle(g, s, '#f4f1ea', ['#e6e1d6', '#ffffff', '#ddd7ca'], 9000, 6, 2.4);
    const r = rng(21);
    // rain streaks and damp stains running down the plaster
    for (let i = 0; i < 26; i++) {
      const x = r() * s, w = 3 + r() * 14, h = s * (0.15 + r() * 0.5);
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, `rgba(70,62,50,${0.05 + r() * 0.09})`);
      grad.addColorStop(1, 'rgba(70,62,50,0)');
      g.fillStyle = grad;
      g.fillRect(x, 0, w, h);
    }
    // peeled patches showing older paint and bare block
    for (let i = 0; i < 9; i++) {
      g.fillStyle = r() < 0.5 ? `rgba(150,140,125,${0.25 + r() * 0.25})` : `rgba(255,255,255,${0.25 + r() * 0.3})`;
      g.beginPath();
      const cx = r() * s, cy = r() * s;
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2, rad = 6 + r() * 20;
        g.lineTo(cx + Math.cos(a) * rad * 1.6, cy + Math.sin(a) * rad);
      }
      g.fill();
    }
    // hairline cracks
    g.strokeStyle = 'rgba(60,55,48,0.35)';
    g.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      let x = r() * s, y = r() * s * 0.6;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 26; y += 10 + r() * 22; g.lineTo(x, y); }
      g.stroke();
    }
    // window: recessed frame, glass, and a wrought iron grille (reja)
    const wx = s * 0.3, wy = s * 0.27, ww = s * 0.4, wh = s * 0.44;
    g.fillStyle = '#d9d2c2'; g.fillRect(wx - 8, wy - 8, ww + 16, wh + 16);
    g.fillStyle = '#2f3a40'; g.fillRect(wx, wy, ww, wh);
    g.fillStyle = '#566c76'; g.fillRect(wx + 4, wy + 4, ww / 2 - 6, wh - 8);
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(wx + 8, wy + 8, ww / 4, wh / 3);
    g.strokeStyle = '#17191b'; g.lineWidth = 3;
    for (let k = 0; k <= 6; k++) { const x = wx + (ww * k) / 6; g.beginPath(); g.moveTo(x, wy - 4); g.lineTo(x, wy + wh + 4); g.stroke(); }
    for (const fy of [0.18, 0.5, 0.82]) { g.beginPath(); g.moveTo(wx - 4, wy + wh * fy); g.lineTo(wx + ww + 4, wy + wh * fy); g.stroke(); }
    // sill with a dirt streak under it
    g.fillStyle = '#cfc8b8'; g.fillRect(wx - 14, wy + wh + 8, ww + 28, 9);
    const grad = g.createLinearGradient(0, wy + wh + 17, 0, wy + wh + 70);
    grad.addColorStop(0, 'rgba(60,55,45,0.22)'); grad.addColorStop(1, 'rgba(60,55,45,0)');
    g.fillStyle = grad; g.fillRect(wx - 6, wy + wh + 17, ww + 12, 53);
    // splash-back grime at the foot of the wall
    const base = g.createLinearGradient(0, s * 0.86, 0, s);
    base.addColorStop(0, 'rgba(60,50,40,0)'); base.addColorStop(1, 'rgba(60,50,40,0.28)');
    g.fillStyle = base; g.fillRect(0, s * 0.86, s, s * 0.14);
  });
}

/** Emissive mask matching the facade window, lit at night. */
export function windowGlowTexture() {
  return canvasTex(256, (g, s) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#ffcf7a';
    g.fillRect(s * 0.3, s * 0.27, s * 0.4, s * 0.44);
  });
}

export function roofTexture() {
  return canvasTex(128, (g, s) => {
    speckle(g, s, '#d8d4cc', ['#c4bfb5', '#e9e5de', '#b0aba1'], 3000, 8);
  });
}
