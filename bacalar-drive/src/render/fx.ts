import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/** Layer for sprites and glow effects that ambient occlusion must ignore. */
export const OVERLAY_LAYER = 1;

/** Warm grade with a soft vignette, applied after tone mapping. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uStrength: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uStrength; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, 1.0 + 0.16 * uStrength);          // a little more saturation
      c.rgb *= mix(vec3(1.0), vec3(1.03, 1.0, 0.96), uStrength);    // warm tropical light
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - dot(d, d) * 0.55 * uStrength;                  // vignette
      gl_FragColor = c;
    }`,
};

/**
 * Light post-processing for desktop: ground-truth ambient occlusion and a color grade. (Bloom was
 * tried and removed: the HDR sky washed the whole frame out.) Phones and ?low render straight to the screen.
 */
export class Effects {
  private composer: EffectComposer | null = null;
  private ao: GTAOPass | null = null;
  enabled: boolean;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.Camera, enable: boolean) {
    camera.layers.enable(OVERLAY_LAYER);
    this.enabled = enable && !/[?&]fx=0\b/.test(location.search);
    if (!this.enabled) return;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 2 });
    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    const ao = new GTAOPass(scene, camera, size.x, size.y);
    ao.updateGtaoMaterial({ radius: 2.2, distanceExponent: 1.4, thickness: 1.2, scale: 1.25, samples: 8 });
    ao.blendIntensity = 0.85;
    // Sprites, light beams and other overlays live on layer 1: they must not enter the
    // depth / normal pass, or they show up as dark boxes.
    const aoRender = ao.render.bind(ao);
    ao.render = (...args: Parameters<typeof aoRender>) => {
      camera.layers.disable(OVERLAY_LAYER);
      aoRender(...args);
      camera.layers.enable(OVERLAY_LAYER);
    };
    composer.addPass(ao);
    this.ao = ao;
    composer.addPass(new OutputPass());
    composer.addPass(new ShaderPass(GradeShader));
    this.composer = composer;
  }

  setSize(w: number, h: number) {
    this.composer?.setSize(w, h);
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Turn ambient occlusion off when the frame rate is too low. */
  setAo(on: boolean) { if (this.ao) this.ao.enabled = on; }
}
