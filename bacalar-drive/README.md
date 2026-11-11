# Bacalar Drive

A 3D open world driving game set in Bacalar, Quintana Roo, Mexico, generated from real
OpenStreetMap data. Runs in the browser. Built with Vite, TypeScript, Three.js and Rapier
(`@dimforge/rapier3d-compat`). No backend.

## Run

```bash
npm install
npm run fetch-map   # downloads OSM data once from Overpass and writes public/data/bacalar.json
npm run dev         # open the printed URL (http://localhost:5173)
```

`public/data/bacalar.json` is committed, so `npm run fetch-map` is only needed to refresh the
map. The game never calls Overpass at runtime.

Other scripts:

```bash
npm run fetch-map -- --offline   # reprocess the cached raw response (scripts/.cache) without a network call
npm run build                    # type check and build to dist/
npm run preview                  # serve the production build
```

Append `?low` to the URL for a lighter mode (smaller view distance, 1024 shadow map, pixel ratio 1).

## Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | drive (on foot: walk, Shift to run, Space to jump) |
| Space | handbrake |
| 1 / 2 / 3 | call and drive the Jeep / mototaxi / motorboat |
| E | exit the vehicle, or enter the nearest one on foot |
| C | camera: chase, hood, top down |
| F | free fly drone camera (WASD, mouse, Space up, Z down, Shift fast) |
| R | reset the vehicle onto the nearest road (boat: nearest open water) |
| T | skip 2 hours |
| P | toggle rain |
| H | hide or show the help panel |
| mouse | click the canvas to capture the mouse, then look around |

A gamepad works too: triggers for throttle and brake, left stick to steer, A handbrake,
B enter/exit, X reset, Y camera, dpad for vehicles and rain, Start skip time, Back drone.

The boat only works on water: press 3 near the lagoon and it spawns on the nearest open water
within 600 m. The player starts in the Jeep on the lakefront road next to the Fuerte de San
Felipe, facing north.

## Map data

`scripts/fetch-osm.ts` sends one Overpass query for the bounding box
south 18.63, west -88.43, north 18.73, east -88.34 and checks that it contains the town of
Bacalar, a road named Costera, the Fuerte de San Felipe and Cenote Azul (it widens the box
and retries if not). It fetches every `highway=*`, `building=*`, `natural=water`,
`natural=wood`, `landuse=forest`, `landuse=residential`, `leisure=park`, `man_made=pier`,
and named `amenity`, `tourism`, `historic` and `place` features.

Coordinates are projected with an equirectangular projection centered on the Fuerte de San
Felipe, 1 unit = 1 meter (x east, y north; in three.js north is -Z).

Note: in OSM the lakefront road beside the fort is named "Boulevard 1"; "Boulevard Costera"
is the stretch further south near Cenote Azul. The spawn prefers a road named Costera within
400 m of the fort and otherwise uses the nearest drivable road, which is the lakefront road.

Map data © OpenStreetMap contributors, available under the Open Database License.

## How the world is built

- **Terrain**: a 5 m raster of the map stores the signed distance to the shore. Land rises
  from 0.35 m at the shore to about 15 m inland; the lagoon bed and cenotes drop below the
  water plane. Each 250 m tile gets a 51x51 height mesh; a coarse mesh covers the horizon.
- **Roads**: ribbon meshes from OSM ways, width by class (primary 9 m, secondary 7 m,
  residential 5 m, track 3 m), asphalt or white sascab dirt by surface, dashed and edge
  lines on primary roads, merged per tile.
- **Buildings**: OSM footprints are extruded (`building:levels` x 3 m, otherwise 1 to 2
  floors) with flat roofs, water tanks and a palette of Mexican town colors. OSM has very few
  footprints in Bacalar, so simple houses are placed along town streets every 15 to 25 m
  where no footprint exists. Windows light up at night.
- **Lagoon**: one water plane with a shader that maps distance from shore to seven shades of
  blue, with waves, fresnel, sun glitter and a foam line. Cenotes go deep navy almost at once.
- **Jungle**: instanced low poly broadleaf trees, tall trees, palms and bushes on forest
  polygons and on any untagged land. Three LOD levels per tile (detailed, simplified, thinned).
- **Landmarks**: the Fuerte de San Felipe uses its real OSM star outline, with battered
  walls, parapets, merlons, sentry boxes, cannons, a flag, a moat and a bridge. The central
  plaza (Parque Principal) is flattened and paved with a kiosk, benches, palms and the
  colored BACALAR letters facing the fort. Piers come from `man_made=pier`. Cenote Azul is
  the dark round water body south of town.
- **Vehicles**: Rapier `DynamicRayCastVehicleController` for the Jeep (4x4) and the
  mototaxi (three wheels), a planar rigid body with keel and rudder forces for the boat,
  and a kinematic character controller on foot. An arcade anti-roll torque keeps cars upright.
- **Atmosphere**: 24 game hours in 20 real minutes, sun path for Bacalar's latitude (sunrise
  over the lagoon), sky shader, stars, moonlight, fog, street lights on primary roads, rain
  with darker sky, closer fog and rougher water.
- **UI**: heading-up minimap drawn from the same data, speedometer, current street name,
  toasts for nearby named places, OSM credit.

## Performance

The world is split into 250 m tiles that load and unload around the player within a
per-frame time budget (6 ms). Static geometry is merged per tile, trees are instanced per
tile, and physics colliders (terrain, roads, buildings, water boundary walls, landmarks)
exist only for the 3x3 tiles around the player. Shadows use one 2048 map that follows the
camera. Target is 60 fps on a mid range laptop; use `?low` on weaker GPUs.

## Project layout

```
scripts/fetch-osm.ts     Overpass query, projection, processing
src/data/                types and projection
src/world/               raster field, terrain, roads, buildings, water, vegetation,
                         piers, street lights, landmarks, tile streaming
src/physics/physics.ts   Rapier world and collider streaming
src/vehicles/            vehicle models, ray-cast cars, boat, on-foot controller
src/camera/              chase / hood / top-down rig and drone camera
src/env/                 day and night cycle, rain
src/ui/                  HUD and minimap
src/game.ts              game loop
```
