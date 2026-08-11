/** Cinematic output chain: bloom → depth of field → grade → vignette/grain → AA. */
import type { Camera, Scene } from 'three';
import { RenderPipeline, type WebGPURenderer } from 'three/webgpu';
import { float, pass, saturation, screenCoordinate, screenUV, time, uniform, vec4, vibrance } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';

/**
 * Depth of field is by far the most expensive thing in this frame — profiling
 * put it at 11ms of 27ms at 2x device pixel ratio, more than the tree, the
 * terrain and every other effect combined. Almost all of that is two 64-tap
 * bokeh gathers.
 *
 * three runs those gathers at half the input resolution. Bokeh is low-frequency
 * by construction, so a quarter works too: the sample *step* stays keyed to the
 * full-resolution texel size, which means the blur keeps exactly the same
 * radius on screen and only its sampling density drops. The circle-of-confusion
 * pass and the final composite stay at full resolution, so everything in focus
 * stays sharp — it is only the parts that are meant to be blurred that are
 * computed coarsely.
 *
 * `setSize` is public and recomputed from the input texture every frame, so
 * overriding it on the instance is enough; there is no need to fork the node.
 */
function shrinkDofBlurTargets(node: unknown, divisor: number): void {
  const dofNode = node as {
    _invSize: { value: { set(x: number, y: number): void } };
    _CoCRT: { setSize(w: number, h: number): void };
    _compositeRT: { setSize(w: number, h: number): void };
    _CoCBlurredRT: { setSize(w: number, h: number): void };
    _blur64RT: { setSize(w: number, h: number): void };
    _blur16NearRT: { setSize(w: number, h: number): void };
    _blur16FarRT: { setSize(w: number, h: number): void };
    setSize(w: number, h: number): void;
  };

  dofNode.setSize = (width: number, height: number) => {
    dofNode._invSize.value.set(1 / width, 1 / height);
    dofNode._CoCRT.setSize(width, height);
    dofNode._compositeRT.setSize(width, height);

    const w = Math.max(1, Math.round(width / divisor));
    const h = Math.max(1, Math.round(height / divisor));
    dofNode._CoCBlurredRT.setSize(w, h);
    dofNode._blur64RT.setSize(w, h);
    dofNode._blur16NearRT.setSize(w, h);
    dofNode._blur16FarRT.setSize(w, h);
  };
}

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
      const dofNode = dof(node, viewZ, uniforms.focusDistance, uniforms.focalLength, uniforms.bokeh);
      shrinkDofBlurTargets(dofNode, 4);
      node = asColor(dofNode);
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
