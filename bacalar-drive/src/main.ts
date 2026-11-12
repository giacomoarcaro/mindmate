import type { MapData } from './data/types';
import { Game } from './game';
import { loadLogo } from './gym/brand';

const msg = document.getElementById('loading-msg')!;
const setMsg = (s: string) => { msg.textContent = s; };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function boot() {
  setMsg('Loading OpenStreetMap data…');
  const res = await fetch(`${import.meta.env.BASE_URL}data/bacalar.json`);
  if (!res.ok) {
    setMsg('Map data not found. Run "npm run fetch-map" first.');
    return;
  }
  const data = (await res.json()) as MapData;
  await loadLogo(import.meta.env.BASE_URL);
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const game = new Game(canvas, data);
  await game.init(async (s) => { setMsg(s); await nextFrame(); });
  document.getElementById('loading')!.classList.add('hidden');
  game.start();
  (window as unknown as { __game: Game }).__game = game;
}

boot().catch((err) => {
  console.error(err);
  setMsg(`Error: ${(err as Error).message}`);
});
