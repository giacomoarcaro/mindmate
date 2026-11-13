/** Equirectangular projection to local meters around an origin. x = east, y = north. */
const R = 6378137;
const DEG = Math.PI / 180;

export interface Projection {
  toLocal(lat: number, lon: number): [number, number];
  toLatLon(x: number, y: number): [number, number];
}

export function makeProjection(lat0: number, lon0: number): Projection {
  const k = Math.cos(lat0 * DEG);
  return {
    toLocal: (lat, lon) => [(lon - lon0) * DEG * R * k, (lat - lat0) * DEG * R],
    toLatLon: (x, y) => [lat0 + y / (R * DEG), lon0 + x / (R * DEG * k)],
  };
}
