# Bacalar Drive · Bacalar Jungle Gym

**The race**: start at the BACALAR letters on the plaza and be first to the Jungle Gym, about
1.5 km of real streets, against three rivals (Don Chuy, La Güera, El Profe) who drive the
shortest road route. A 3-2-1 countdown starts the clock; the HUD shows race time, position,
distance left and your best time (saved in the browser). Five minutes maximum.

At the finish a screen shows time, position and points. Winners get a prize code and a link
to bacalarjunglegym.com. Everyone gets a short form (name, goal, preferred time) that opens
WhatsApp with a ready message to +39 366 151 2335; nothing is stored or sent by the game
itself. The number lives in `src/gym/brand.ts`.

The game is themed around the Bacalar Jungle Gym and exists to send people to the gym.

- **Mission**: stop next to pedestrians showing the green "¡AL GYM!" bubble: they run to the
  car and sit in the back (Jeep 3 seats, mototaxi 2). Drive them to the gym for +500 points
  each. Knocking other pedestrians over is cartoon style: they fly, bounce, get up and walk
  off, and score points with a combo multiplier. Hitting a gym-goer scores nothing. The gym stands at its real
  coordinates (18.6856156, -88.3949969) with a light beacon, a large logo pin and a drop-off
  ring. At 3, 10, 25 and 50 people delivered a card shows the real offer with a WhatsApp
  booking button. A WhatsApp button is always visible at the top.
- **Branding**: lime, pink and charcoal livery on all vehicles, Brownie the gym dog in the
  Jeep, logo on the HUD and loading screen, billboards along the main roads with the distance
  to the gym, gym marker and direction arrow on the minimap. UI text is in Spanish.
- **Pedestrians**: señores with sombrero and guayabera, señoras and abuelas in embroidered
  huipil, kids, young people, and paleteros pushing their cart, walking along town streets.
- **Pins**: every named place from the map data gets a map-style pin with its name and a
  category logo. The data source is OpenStreetMap, not Google Maps.
- Brand facts live in `src/gym/brand.ts` (offer, hours, prices, WhatsApp number). Offer,
  hours and prices come from the gym's website and should be confirmed before a public launch.
- Real facade photos come from Mapillary once downloaded; see the section at the end.

A 3D open world driving game set in Bacalar, Quintana Roo, Mexico, generated from real
OpenStreetMap data. Runs in the browser. Built with Vite, TypeScript, Three.js and Rapier
(`@dimforge/rapier3d-compat`). No backend.

## Run

```bash
npm install
npm run fetch-map   # OSM data from Overpass + Microsoft building footprints, writes public/data/bacalar.json
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

On phones and tablets the game switches to touch controls and light settings automatically:
steering stick on the left, gas, brake and handbrake on the right, action buttons along the
bottom, drag on the view to look around. On foot the stick walks. Landscape is recommended;
portrait works. Append `?touch` to force the touch controls on a desktop browser.

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
| G | horn |
| M | sound on / off |
| T | skip 2 hours |
| P | toggle rain |
| H | hide or show the help panel |
| mouse | click the canvas to capture the mouse, then look around |

A gamepad works too: triggers for throttle and brake, left stick to steer, A handbrake,
B enter/exit, X reset, Y camera, dpad for vehicles and rain, Start skip time, Back drone.

The boat only works on water: press 3 near the lagoon and it spawns on the nearest open water
within 600 m. The player starts in the Jeep in the historic center, in front of the colored BACALAR
letters on the main plaza.

## Map data

`scripts/fetch-osm.ts` sends one Overpass query for the center of Bacalar only: a square of
4 km around the main plaza (about south 18.641, west -88.428, north 18.713, east -88.352) and checks that it contains the town of
Bacalar, a road named Costera, the Fuerte de San Felipe and Cenote Azul (it widens the box
and retries if not). It fetches every `highway=*`, `building=*`, `natural=water`,
`natural=wood`, `landuse=forest`, `landuse=residential`, `leisure=park`, `man_made=pier`,
and named `amenity`, `tourism`, `historic` and `place` features.

Coordinates are projected with an equirectangular projection centered on the Fuerte de San
Felipe, 1 unit = 1 meter (x east, y north; in three.js north is -Z).

Note: in OSM the lakefront road beside the fort is named "Boulevard 1"; "Boulevard Costera"
is the stretch further south near Cenote Azul. The spawn prefers a road named Costera within
400 m of the fort and otherwise uses the nearest drivable road, which is the lakefront road.

Map data © OpenStreetMap contributors and building footprints © Microsoft, both under the
Open Database License.

## How the world is built

- **Terrain**: a 5 m raster of the map stores the signed distance to the shore. Land rises
  from 0.35 m at the shore to about 15 m inland; the lagoon bed and cenotes drop below the
  water plane. Each 250 m tile gets a 51x51 height mesh; a coarse mesh covers the horizon.
- **Roads**: ribbon meshes from OSM ways, width by class (primary 9 m, secondary 7 m,
  residential 5 m, track 3 m), asphalt or white sascab dirt by surface, dashed and edge
  lines on primary roads, merged per tile.
- **Buildings**: real footprints. OpenStreetMap has only 61 buildings in Bacalar, so
  `scripts/fetch-buildings.ts` adds the 6600 footprints of Microsoft's Global ML Building
  Footprints (detected from satellite imagery, ODbL). OSM wins where both have the same
  building. Footprints are extruded (`building:levels` x 3 m, otherwise 1 to 2 floors) with
  flat roofs, water tanks, a painted base band (guardapolvo), a door on the street side and
  the Mexican town palette. Windows light up at night.
- **Businesses**: each named amenity or tourism point from OSM is placed in the building that
  contains it (or the nearest one) and gets an open storefront, a striped awning and a painted
  sign with its real name and type (RESTAURANTE, FARMACIA, HOTEL...). Signs glow at night.
- **Street life**: raised sidewalks with curbs on town streets, utility poles with sagging
  wires, topes (speed bumps) you feel in the suspension, cars parked half on the curb, dogs
  napping on the sidewalk.
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
- **Sound**: all synthesized with WebAudio (engine with gear shifts, tire screech, crashes,
  hits, boarding and drop-off jingles, horn, rain); no audio files.
- **Atmosphere**: 24 game hours in 20 real minutes, sun path for Bacalar's latitude (sunrise
  over the lagoon), sky shader, stars, moonlight, fog, street lights on primary roads, rain
  with darker sky, closer fog and rougher water.
- **UI**: heading-up minimap drawn from the same data, speedometer, current street name,
  toasts for nearby named places, OSM credit.

## Multiplayer and hosting

`server/` is a Cloudflare Worker (free plan) with one Durable Object per room. It serves the
built game and the rooms from the same address:
https://bacalar-drive.bacalar-drive-server.workers.dev

- Rooms hold up to 8 players. "Partida rápida" joins a public room, "Crear sala" makes a
  private one and copies an invite link (`?sala=CODE`).
- Each client simulates its own vehicle and sends its state 10 times a second (once a second
  when parked). The room relays it, rejects impossible speeds and teleports, and other
  players are drawn 120 ms in the past with interpolation. Automatic reconnection.
- Preset phrases only (keys 5 to 0). Only the nickname is shared.
- Free plan limit: about 100,000 requests a day, and 20 WebSocket messages count as one
  request. A full room for several hours can exhaust it; multiplayer then pauses until the
  next day, with no charge.

Deploy (needs a Cloudflare API token with the "Edit Cloudflare Workers" template):

```bash
npm run build
```
```bash
cd server && npm install && CLOUDFLARE_API_TOKEN=... npm run deploy
```

`server/build-site.mjs` bundles `dist/` into the Worker. Local test: `npm run dev` in
`server/` and open http://localhost:8787.

## Party mode: La Mancuerna de Oro

Opening the game joins a public room and starts a round at once (auto nickname, no menu;
`?menu` or the Menú button opens the menu, `?sala=CODE` joins a private room). A round lasts 2 minutes. A golden dumbbell
appears on a street near the plaza; whoever carries it scores 10 points a second, and
touching the carrier steals it (1.5 s of protection after each change). The server owns the
dumbbell, the scores and the clock. With fewer than three people the host's client drives two
bots along the street graph. The round ends with a ranking, a prize code for the winner and
the WhatsApp lead form.

Feel and retention: turbo (Shift / TURBO button) with a charge bar, camera shake and speed
FOV, tire dust, a short slow motion and vibration when the dumbbell changes hands, a beat
that speeds up in the last 20 seconds. On phones the car accelerates by itself and one thumb
steers by sliding anywhere. The end screen shows the weekly Bacalar top (`/board`, best score
per nickname, reset each week), a daily goal, a share button (image through the share sheet
or a WhatsApp text) and "Jugar otra vez". The sport bike unlocks after 3 rounds. The gym
shows a weekly code (staff page `/codigo?k=GYM_SECRET`, secret set with `wrangler secret put`);
typing it in the menu (`/canjear`) turns the Jeep gold.

## Vehicles

Keys 1 Jeep, 2 mototaxi, 3 boat, 4 green sport motorcycle (230 km/h, leans into corners).
Handling: speed-sensitive steering, downforce, yaw damping that prevents spin-outs unless the
handbrake is pulled (drift), air control, automatic recovery when upside down, and visible
weight transfer (squat, dive, roll).

## Graphics

Procedural facades use weathered plaster with stains, cracks and wrought iron window grilles,
a darker foot on every wall, potted plants, bougainvillea, air conditioner boxes and painted
wall ads (some advertise the gym with the real distance). Desktop adds ambient occlusion
(GTAO) and a warm color grade; it switches the occlusion off if the frame rate stays under
40 fps, and `?fx=0` disables post-processing. A drifting cloud layer follows the sun color.
Phones and `?low` skip post-processing.

Ground and lagoon colors come from a Sentinel-2 cloudless mosaic (`public/data/ground.jpg`,
10 m per pixel, downloaded by `scripts/fetch-ground.ts`): "Sentinel-2 cloudless 2016" by EOX
IT Services GmbH (https://s2maps.eu), contains modified Copernicus Sentinel data 2016,
CC BY 4.0. Only the 2016 mosaic is used because later ones are non-commercial.

Not done yet: real facade photos.

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

## Real facade photos (Mapillary)

Building facades are procedural until you download street photos from Mapillary
(CC BY-SA 4.0). Google Street View is not used: Google's terms forbid using its imagery as
textures.

1. On mapillary.com open Dashboard > Developers, register an application and copy the
   "Client Token" (free).
2. Run the script once:

```bash
MAPILLARY_TOKEN="MLY|your-token" npm run fetch-facades
```

It queries the town streets, keeps one photo per 10 m and viewing direction (default cap
1200, change with `-- --max 2000`), downloads 256 px thumbnails to `public/facades/` and
writes `public/data/facades.json`. On the next start the game projects each photo onto the
street-facing wall of the nearest building and adds the Mapillary credit. The game never
calls Mapillary at runtime.

Limits: coverage depends on what contributors uploaded in Bacalar, photos are forward-facing
so facades are cropped from the left or right half and look skewed, and each building gets
one photo on one wall. Buildings without a nearby photo keep the procedural facade.
