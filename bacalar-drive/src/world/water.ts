import * as THREE from 'three';
import type { Field } from './field';

/**
 * Lagoon surface: one large plane at y = 0. The fragment shader looks up the distance
 * from shore in a data texture and maps it to the "seven colors" of Bacalar, from pale
 * turquoise in the shallows to deep navy in the channel and in cenotes.
 */

const SHADES = ['#c4f5ec', '#86e3d8', '#43c9cb', '#20a6c4', '#1582b2', '#0f5c93', '#0a3263'];
// distance from shore (m) at which each shade is reached
const STOPS = [0, 5, 13, 26, 48, 85, 150];

export function buildWater(field: Field, satellite: HTMLImageElement | null = null) {
  const { nx, ny } = field;
  const tex = new Uint8Array(nx * ny * 4);
  for (let k = 0; k < nx * ny; k++) {
    const w = field.water[k];
    if (!w) continue;
    tex[k * 4] = Math.min(255, Math.max(0, -field.sd[k] / 2));
    tex[k * 4 + 1] = w === 2 ? 255 : 0;
    tex[k * 4 + 3] = 255;
  }
  const dt = new THREE.DataTexture(tex, nx, ny, THREE.RGBAFormat, THREE.UnsignedByteType);
  dt.magFilter = THREE.LinearFilter;
  dt.minFilter = THREE.LinearFilter;
  dt.flipY = false;
  dt.needsUpdate = true;

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uDist: { value: null },
      uBounds: { value: new THREE.Vector4() },
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      uDay: { value: 1 },
      uSkyColor: { value: new THREE.Color('#9fd3ef') },
      uRain: { value: 0 },
      uShades: { value: SHADES.map((c) => new THREE.Color(c)) },
      uSat: { value: null },
      uSatMix: { value: 0 },
      uStops: { value: STOPS },
    },
  ]);
  uniforms.uDist.value = dt;
  if (satellite) {
    const st = new THREE.Texture(satellite);
    st.colorSpace = THREE.SRGBColorSpace;
    st.needsUpdate = true;
    uniforms.uSat.value = st;
    uniforms.uSatMix.value = 0.55;
  }
  uniforms.uBounds.value.set(field.minX, field.minY, (nx - 1) * 5, (ny - 1) * 5);

  const mat = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D uDist;
      uniform vec4 uBounds;
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uDay;
      uniform vec3 uSkyColor;
      uniform float uRain;
      uniform vec3 uShades[7];
      uniform sampler2D uSat;
      uniform float uSatMix;
      uniform float uStops[7];
      varying vec3 vWorld;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      // height of the small waves, used to build a normal
      float waves(vec2 p) {
        float t = uTime;
        float h = 0.0;
        h += sin(dot(p, vec2(0.21, 0.13)) + t * 1.1) * 0.5;
        h += sin(dot(p, vec2(-0.17, 0.29)) + t * 1.4) * 0.35;
        h += sin(dot(p, vec2(0.53, -0.41)) + t * 2.1) * 0.15;
        h += (noise(p * 0.9 + t * 0.6) - 0.5) * 0.5;
        h += (noise(p * 2.3 - t * 0.9) - 0.5) * 0.25 * (1.0 + uRain * 3.0);
        return h;
      }

      void main() {
        vec2 m = vec2(vWorld.x, -vWorld.z);
        vec2 uv = (m - uBounds.xy) / uBounds.zw;
        vec4 t = texture2D(uDist, uv);
        float d = t.r * 510.0;
        float cenote = t.g;
        // organic band edges
        float warp = (noise(m * 0.015) - 0.5) * 18.0 + (noise(m * 0.06) - 0.5) * 6.0;
        float dd = max(0.0, d + warp * smoothstep(2.0, 30.0, d));
        if (cenote > 0.5) dd = d * 14.0;

        vec3 col = uShades[0];
        for (int i = 1; i < 7; i++) {
          float k = smoothstep(uStops[i] - 2.5, uStops[i] + 2.5, dd);
          col = mix(col, uShades[i], k);
        }

        // real lagoon colors from Sentinel-2 (brightened), blended with the seven bands
        if (uSatMix > 0.0) {
          vec3 sat = texture2D(uSat, uv).rgb;
          sat = min(vec3(1.0), sat * 2.2 + vec3(0.0, 0.01, 0.03));
          col = mix(col, sat, uSatMix * smoothstep(3.0, 20.0, d) * (1.0 - cenote));
        }
        // normal from wave height field
        float e = 0.6;
        float h0 = waves(m);
        float hx = waves(m + vec2(e, 0.0));
        float hz = waves(m + vec2(0.0, e));
        vec3 n = normalize(vec3(-(hx - h0) * 0.35, 1.0, (hz - h0) * 0.35));

        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
        vec3 sky = uSkyColor;
        float light = 0.25 + 0.75 * uDay;
        vec3 base = col * light;
        base = mix(base, sky, fres * 0.55);

        vec3 R = reflect(-V, n);
        float sunUp = smoothstep(-0.05, 0.1, uSunDir.y);
        float spec = pow(max(dot(R, uSunDir), 0.0), 220.0) * 6.0 + pow(max(dot(R, uSunDir), 0.0), 30.0) * 0.25;
        base += uSunColor * spec * sunUp * (1.0 - uRain * 0.8);

        // foam line at the shore
        float foam = (1.0 - smoothstep(0.3, 2.2, d)) * (0.6 + 0.4 * noise(m * 0.8 + uTime));
        base = mix(base, vec3(0.95) * light, foam * 0.6);

        float alpha = mix(0.62, 0.96, smoothstep(0.0, 25.0, dd));
        alpha = max(alpha, fres);
        gl_FragColor = vec4(base, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });

  const w = field.maxX - field.minX, h = field.maxY - field.minY;
  const geo = new THREE.PlaneGeometry(w, h, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set((field.minX + field.maxX) / 2, 0, -(field.minY + field.maxY) / 2);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  mesh.name = 'lagoon';
  return { mesh, uniforms };
}
