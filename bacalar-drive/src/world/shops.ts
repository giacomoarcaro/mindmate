import * as THREE from 'three';

/** Shop categories from OSM amenity / tourism tags: Spanish label, sign and awning colors. */
export interface ShopStyle { label: string; bg: string; fg: string; awning: [string, string] }

const STYLES: [RegExp, ShopStyle][] = [
  [/restaurant|food_court/, { label: 'RESTAURANTE', bg: '#c8372d', fg: '#fff7e0', awning: ['#c8372d', '#fff7e0'] }],
  [/fast_food/, { label: 'COMIDA', bg: '#f2b134', fg: '#3a1d0c', awning: ['#e85d1f', '#ffe9a8'] }],
  [/cafe/, { label: 'CAFÉ', bg: '#5b3a24', fg: '#f6e3c4', awning: ['#5b3a24', '#f6e3c4'] }],
  [/ice_cream/, { label: 'NEVERÍA', bg: '#ff8fb8', fg: '#ffffff', awning: ['#ff8fb8', '#ffffff'] }],
  [/bar|pub|nightclub/, { label: 'BAR', bg: '#2b1d4a', fg: '#ffd23f', awning: ['#6a3fa0', '#ffd23f'] }],
  [/hotel|motel/, { label: 'HOTEL', bg: '#0f5c93', fg: '#ffffff', awning: ['#0f5c93', '#ffffff'] }],
  [/hostel|guest_house|apartment|chalet/, { label: 'HOSPEDAJE', bg: '#2a9d8f', fg: '#ffffff', awning: ['#2a9d8f', '#e9f5f2'] }],
  [/pharmacy/, { label: 'FARMACIA', bg: '#1f8a4c', fg: '#ffffff', awning: ['#1f8a4c', '#ffffff'] }],
  [/clinic|hospital|dentist|doctors/, { label: 'CONSULTORIO', bg: '#ffffff', fg: '#c62828', awning: ['#c62828', '#ffffff'] }],
  [/bank|atm/, { label: 'BANCO', bg: '#1a3d6d', fg: '#ffffff', awning: ['#1a3d6d', '#d6e2f2'] }],
  [/fuel/, { label: 'GASOLINERA', bg: '#2e7d32', fg: '#ffffff', awning: ['#2e7d32', '#ffffff'] }],
  [/school|university|kindergarten/, { label: 'ESCUELA', bg: '#f4f1ea', fg: '#7b2d26', awning: ['#7b2d26', '#f4f1ea'] }],
  [/place_of_worship/, { label: 'TEMPLO', bg: '#f4f1ea', fg: '#4b2e83', awning: ['#4b2e83', '#f4f1ea'] }],
  [/bus_station|taxi/, { label: 'TERMINAL', bg: '#ffd23f', fg: '#20252a', awning: ['#20252a', '#ffd23f'] }],
  [/bicycle_rental|attraction|museum|viewpoint/, { label: 'TURISMO', bg: '#e9c46a', fg: '#264653', awning: ['#2a9d8f', '#e9c46a'] }],
];

/** Points that are not shops (benches, taps, ATMs on a wall) get no storefront. */
const SKIP = /drinking_water|water_point|bench|waste|toilets|parking|shelter|atm|public_bath|post_box|vending/;

export function shopStyle(kind: string): ShopStyle | null {
  if (SKIP.test(kind)) return null;
  for (const [re, s] of STYLES) if (re.test(kind)) return s;
  return { label: 'NEGOCIO', bg: '#f4f1ea', fg: '#20252a', awning: ['#3fb8af', '#f4f1ea'] };
}

const CW = 512, CH = 128, COLS = 4, ROWS = 16;

/** Hand-painted style rótulo: category over the name, painted straight on a board. */
function drawSign(g: CanvasRenderingContext2D, x: number, y: number, name: string, s: ShopStyle) {
  g.fillStyle = s.bg;
  g.fillRect(x, y, CW, CH);
  g.strokeStyle = s.fg;
  g.lineWidth = 5;
  g.strokeRect(x + 7, y + 7, CW - 14, CH - 14);
  g.fillStyle = s.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '700 20px Georgia, "Times New Roman", serif';
  g.fillText(s.label, x + CW / 2, y + 28, CW - 40);
  const label = name.toUpperCase();
  let size = 54;
  g.font = `900 ${size}px "Arial Black", Arial, sans-serif`;
  while (g.measureText(label).width > CW - 44 && size > 22) {
    size -= 2;
    g.font = `900 ${size}px "Arial Black", Arial, sans-serif`;
  }
  g.fillText(label, x + CW / 2, y + 78, CW - 40);
}

/** One canvas atlas of signs per tile. */
export class SignAtlas {
  readonly tex: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  private used = 0;

  constructor() {
    const c = document.createElement('canvas');
    c.width = CW * COLS;
    c.height = CH * ROWS;
    this.g = c.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
  }

  /** Draws a sign and returns its UV rectangle, or null when the atlas is full. */
  add(name: string, s: ShopStyle) {
    if (this.used >= COLS * ROWS) return null;
    const x = (this.used % COLS) * CW, y = Math.floor(this.used / COLS) * CH;
    this.used++;
    drawSign(this.g, x, y, name, s);
    this.tex.needsUpdate = true;
    const W = CW * COLS, H = CH * ROWS, e = 1 / W;
    return { u0: x / W + e, u1: (x + CW) / W - e, v0: 1 - (y + CH) / H + e, v1: 1 - y / H - e };
  }

  count() { return this.used; }
}
