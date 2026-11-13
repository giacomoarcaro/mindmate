import * as THREE from 'three';

/** Tropical cumulus layer: one big plane with drifting noise, lit by the sun color. */
export class Clouds {
  readonly mesh: THREE.Mesh;
  private uniforms = {
    uTime: { value: 0 },
    uSun: { value: new THREE.Color(1, 1, 1) },
    uShade: { value: new THREE.Color(0.62, 0.68, 0.78) },
    uCover: { value: 0.46 },
    uDay: { value: 1 },
  };

  constructor() {
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
      vertexShader: 'varying vec3 vP; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `
        uniform float uTime; uniform vec3 uSun; uniform vec3 uShade; uniform float uCover; uniform float uDay;
        varying vec3 vP;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
        float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*noise(p); p = p*2.03 + 17.0; a *= 0.5; } return s; }
        void main(){
          vec2 p = vP.xz * 0.00042 + vec2(uTime * 0.004, uTime * 0.0015);
          float d = fbm(p * 2.0);
          float shape = smoothstep(1.0 - uCover, 1.0 - uCover + 0.22, d);
          // puffy lit tops, flat shaded bases
          float top = fbm(p * 2.0 + 0.03);
          vec3 col = mix(uShade, uSun, smoothstep(-0.05, 0.12, d - top + 0.06));
          col *= 0.18 + 0.82 * uDay;
          // fade toward the horizon so the plane edge is never visible
          float r = length(vP.xz - cameraPosition.xz);
          float fade = 1.0 - smoothstep(4500.0, 9000.0, r);
          gl_FragColor = vec4(col, shape * 0.92 * fade);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000).rotateX(-Math.PI / 2), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.layers.set(1);
  }

  update(time: number, cam: THREE.Vector3, sun: THREE.Color, day: number, rain: number) {
    this.uniforms.uTime.value = time;
    this.uniforms.uSun.value.copy(sun).lerp(new THREE.Color(1, 1, 1), 0.5);
    this.uniforms.uDay.value = day;
    this.uniforms.uCover.value = 0.46 + rain * 0.45;
    this.uniforms.uShade.value.setRGB(0.62 - rain * 0.25, 0.68 - rain * 0.27, 0.78 - rain * 0.3);
    this.mesh.position.set(cam.x, 1100, cam.z);
  }
}
