import * as THREE from 'three';

/**
 * GPU rain: static random streaks in a box that wraps around the camera.
 * All motion happens in the vertex shader, so the CPU cost is one uniform update.
 */
export class Rain {
  readonly mesh: THREE.LineSegments;
  private uniforms: { uTime: { value: number }; uCam: { value: THREE.Vector3 }; uIntensity: { value: number }; uColor: { value: THREE.Color } };

  constructor(count = 9000, size = new THREE.Vector3(90, 50, 90)) {
    const pos = new Float32Array(count * 2 * 3);
    const end = new Float32Array(count * 2);
    const seed = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = Math.random() * size.x, y = Math.random() * size.y, z = Math.random() * size.z;
      const s = Math.random();
      for (let k = 0; k < 2; k++) {
        pos.set([x, y, z], (i * 2 + k) * 3);
        end[i * 2 + k] = k;
        seed[i * 2 + k] = s;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.uniforms = {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uIntensity: { value: 0 },
      uColor: { value: new THREE.Color('#cfd8df') },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uSize: { value: size } },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCam;
        uniform vec3 uSize;
        attribute float aEnd;
        attribute float aSeed;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          float speed = 22.0 + aSeed * 8.0;
          p.y = mod(p.y - uTime * speed, uSize.y);
          p.x = mod(p.x + uTime * 3.0 - uCam.x, uSize.x);
          p.z = mod(p.z - uCam.z, uSize.z);
          vec3 world = vec3(uCam.x + p.x - uSize.x * 0.5, uCam.y + p.y - uSize.y * 0.45, uCam.z + p.z - uSize.z * 0.5);
          // streak along the fall direction
          world += vec3(0.12, 1.0, 0.0) * aEnd * 0.9;
          vAlpha = mix(0.15, 0.6, aEnd);
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uIntensity;
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(uColor, vAlpha * uIntensity * 0.55);
        }`,
    });
    this.mesh = new THREE.LineSegments(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  update(time: number, cam: THREE.Vector3, intensity: number) {
    this.uniforms.uTime.value = time;
    this.uniforms.uCam.value.copy(cam);
    this.uniforms.uIntensity.value = intensity;
    this.mesh.visible = intensity > 0.01;
  }
}
