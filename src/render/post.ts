/** Cinematic output chain: bloom → depth of field → grade → vignette/grain → AA. */
import type { Camera, Scene } from 'three';
import { RenderPipeline, type WebGPURenderer } from 'three/webgpu';
import { float, pass, saturation, screenCoordinate, screenUV, time, uniform, vec4, vibrance } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';

export interface PostToggles {
  bloom: boolean;
  dof: boolean;
  grain: boolean;
  antialias: boolean;
}

export function createPostPipeline(renderer: WebGPURenderer, scene: Scene, camera: Camera) {
  const uniforms = {
    bloomStrength: uniform(0.32),
    bloomRadius: uniform(0.6),
    // High enough that only the sun disc and specular hits bloom — a low
    // threshold makes the whole sky glow and washes the tree out.
    bloomThreshold: uniform(1.15),

    focusDistance: uniform(12),
    focalLength: uniform(15),
    bokeh: uniform(2.2),

    vibrance: uniform(0.3),
    saturation: uniform(1.06),
    vignette: uniform(0.58),
    grain: uniform(0.026),
  };

  const pipeline = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode('output');
  const viewZ = scenePass.getViewZNode();

  const bloomPass = bloom(sceneColor, uniforms.bloomStrength, uniforms.bloomRadius, uniforms.bloomThreshold);

  const toggles: PostToggles = { bloom: true, dof: true, grain: true, antialias: true };

  function rebuild(): void {
    // Effect nodes are wrapped in a proxy at runtime that the published
    // typings do not model, so the chain needs a nudge to stay vec4.
    const asColor = (n: unknown) => n as typeof sceneColor;

    let node = toggles.bloom ? sceneColor.add(bloomPass) : sceneColor;
    if (toggles.dof) {
      node = asColor(dof(node, viewZ, uniforms.focusDistance, uniforms.focalLength, uniforms.bokeh));
    }

    // Grading works on colour only — `vibrance` and `saturation` return vec3.
    let rgb = saturation(vibrance(node.rgb, uniforms.vibrance), uniforms.saturation);

    const falloff = screenUV.sub(0.5).length().mul(uniforms.vignette);
    rgb = rgb.mul(float(1).sub(falloff.mul(falloff)).clamp(0, 1));

    if (toggles.grain) {
      const noise = screenCoordinate.x
        .mul(12.9898)
        .add(screenCoordinate.y.mul(78.233))
        .add(time.mul(37.0))
        .sin()
        .mul(43758.5453)
        .fract()
        .sub(0.5);
      rgb = rgb.add(noise.mul(uniforms.grain));
    }

    const graded = vec4(rgb, 1);
    pipeline.outputNode = toggles.antialias ? fxaa(graded) : graded;
    pipeline.needsUpdate = true;
  }

  rebuild();

  return {
    pipeline,
    uniforms,
    toggles,
    setToggles(next: Partial<PostToggles>): void {
      let changed = false;
      for (const key of Object.keys(next) as (keyof PostToggles)[]) {
        const value = next[key];
        if (value !== undefined && toggles[key] !== value) {
          toggles[key] = value;
          changed = true;
        }
      }
      if (changed) rebuild();
    },
    render(): Promise<void> | void {
      return pipeline.render();
    },
    dispose(): void {
      pipeline.dispose();
    },
  };
}
