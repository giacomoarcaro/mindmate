import type { MapData } from './data/types';
import { Game } from './game';
import { loadLogo } from './gym/brand';

const msg = document.getElementById('loading-msg')!;
const setMsg = (s: string) => { msg.textContent = s; };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** Sentinel-2 ground image as raw pixels; the game works without it. */
function loadGround(url: string): Promise<{ data: Uint8ClampedArray; w: number; h: number; image: HTMLImageElement } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      resolve({ data: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height, image: img });
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function boot() {
  setMsg('Loading OpenStreetMap data…');
  const res = await fetch(`${import.meta.env.BASE_URL}data/bacalar.json`);
  if (!res.ok) {
    setMsg('Map data not found. Run "npm run fetch-map" first.');
    return;
  }
  const data = (await res.json()) as MapData;
  await loadLogo(import.meta.env.BASE_URL);
  const ground = await loadGround(`${import.meta.env.BASE_URL}data/ground.jpg`);
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const game = new Game(canvas, data, ground);
  await game.init(async (s) => { setMsg(s); await nextFrame(); });
  document.getElementById('loading')!.classList.add('hidden');
  game.start();
  (window as unknown as { __game: Game }).__game = game;
}

boot().catch((err) => {
  console.error(err);
  setMsg(`Error: ${(err as Error).message}`);
});
