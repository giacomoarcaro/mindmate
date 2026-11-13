/** Flat list of x,y pairs in local meters (x east, y north). */
export type Ring = number[];

export interface Road {
  id: number;
  name: string;
  hw: string;
  /** primary | secondary | residential | service | track | path */
  cls: string;
  width: number;
  paved: boolean;
  bridge?: boolean;
  oneway?: boolean;
  pts: number[];
}

export interface Building {
  id: number;
  /** First ring is the outer footprint, the rest are holes. */
  rings: Ring[];
  levels?: number;
  height?: number;
  kind?: string;
  name?: string;
  /** 'ms' = Microsoft satellite footprint, otherwise OpenStreetMap */
  source?: 'osm' | 'ms';
}

export interface AreaFeature {
  id: number;
  name?: string;
  rings: Ring[];
}

export interface WaterBody extends AreaFeature {
  kind: 'lagoon' | 'cenote' | 'pond';
}

export interface Pier {
  id: number;
  name?: string;
  area?: boolean;
  width: number;
  pts: number[];
}

export interface Poi {
  name: string;
  kind: string;
  x: number;
  y: number;
  /** outline for historic sites */
  ring?: number[];
}

export interface MapData {
  meta: {
    bbox: [number, number, number, number];
    origin: { lat: number; lon: number };
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    generated: string;
    attribution: string;
    note: string;
  };
  roads: Road[];
  buildings: Building[];
  water: WaterBody[];
  forest: AreaFeature[];
  residential: AreaFeature[];
  parks: AreaFeature[];
  piers: Pier[];
  pois: Poi[];
  landmarks: Poi[];
}
