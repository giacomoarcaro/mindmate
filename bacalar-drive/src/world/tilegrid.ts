export const TILE = 250;

/** Maps world positions (map meters, x east / y north) to 250 m tile keys. */
export class TileGrid {
  readonly ntx: number;
  readonly nty: number;
  constructor(readonly minX: number, readonly minY: number, maxX: number, maxY: number) {
    this.ntx = Math.ceil((maxX - minX) / TILE);
    this.nty = Math.ceil((maxY - minY) / TILE);
  }
  tx(x: number) { return Math.max(0, Math.min(this.ntx - 1, Math.floor((x - this.minX) / TILE))); }
  ty(y: number) { return Math.max(0, Math.min(this.nty - 1, Math.floor((y - this.minY) / TILE))); }
  key(tx: number, ty: number) { return ty * this.ntx + tx; }
  keyAt(x: number, y: number) { return this.key(this.tx(x), this.ty(y)); }
  coords(key: number): [number, number] { return [key % this.ntx, Math.floor(key / this.ntx)]; }
  /** Tile origin (south-west corner) in map meters. */
  origin(key: number): [number, number] {
    const [tx, ty] = this.coords(key);
    return [this.minX + tx * TILE, this.minY + ty * TILE];
  }
}
