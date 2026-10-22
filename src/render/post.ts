/**
 * Cinematic output chain: a multisampled scene → bloom → depth of field →
 * grade → vignette/grain.
 *
 * Edges are smoothed by the GPU's multisampling, in the scene pass, not by a
 * filter at the end. FXAA guessed at edges from the finished picture: it
 * softened everything it touched, and on thin geometry — twigs, grass blades,
 * a distant flower a pixel across — it could not tell an edge from detail, so
 * those crawled and sparkled as anything moved. Four samples per pixel cover
 * a thin blade for what it is, and it holds still as it turns.
 */
import type { Camera, Scene } from 'three';
import { RenderPipeline, type WebGPURenderer } from 'three/webgpu';
import { float, pass, saturation, screenCoordinate, screenUV, smoothstep, time, uniform, vec3, vec4, vibrance } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';

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
  const toggles: PostToggles = { bloom: true, dof: true, grain: true, antialias: true };

  /*
   * Glow and focus blur are both measured in the frame's own pixels, so left
   * alone they change size on screen whenever the drawing scale does: at twice
   * the density the bokeh was half as wide, and the glow was computed over four
   * times the pixels for the same soft result. Both are kept in the screen's
   * CSS pixels instead — the glow drawn at half of those whatever the density
   * (it is a blur; it has no detail to lose), and the bokeh scaled up with the
   * density so it stays the same width on screen.
   */
  let pixelRatio = 1;
  let bokehBase = 1.6;
  const applyScale = () => {
    bloomPass?.setResolutionScale(0.5 / pixelRatio);
    uniforms.bokeh.value = bokehBase * (pixelRatio / 1.5);
  };

  // The scene pass, and the bloom fed from it, are made again only when the
  // sample count changes — that is the one setting that needs new targets.
  let samples = -1;
  let scenePass!: ReturnType<typeof pass>;
  let sceneColor!: ReturnType<ReturnType<typeof pass>['getTextureNode']>;
  let viewZ!: ReturnType<ReturnType<typeof pass>['getViewZNode']>;
  let bloomPass!: ReturnType<typeof bloom>;

  function makeScenePass(): void {
    const want = toggles.antialias ? 4 : 0;
    if (want === samples) return;
    samples = want;
    scenePass?.dispose();
    bloomPass?.dispose();
    scenePass = pass(scene, camera, { samples });
    sceneColor = scenePass.getTextureNode('output');
    viewZ = scenePass.getViewZNode();
    bloomPass = bloom(sceneColor, uniforms.bloomStrength, uniforms.bloomRadius, uniforms.bloomThreshold);
    applyScale();
  }

  function rebuild(): void {
    makeScenePass();
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
      /*
       * Film grain, weighted like film grain.
       *
       * A flat `rgb + noise` is what made the scene shimmer when you pull the
       * camera back. Measured on a static frame with everything else frozen,
       * the grain alone moved 61% of the pixels — and zoomed out, those pixels
       * are the smooth meadow, where the eye reads uniform full-field noise as
       * heat haze. Zoomed in the identical grain is invisible, because busy
       * foliage masks it. Nothing about the grain changes with distance; what
       * changes is how much flat surface it has to sit on.
       *
       * The fix is to make the noise *proportional to the signal* rather than
       * added on top of it. Grain runs before the output transform, and the
       * sRGB curve is near-vertical at the bottom, so a tiny linear delta in
       * the shadows becomes a large visible one — which is why simply weighting
       * an additive term by luminance does not work, and why the darkest 5% of
       * the frame was moving *more* than anything else. Multiplying instead
       * makes the perturbation a constant *fraction* of each pixel, so it is
       * perceptually even across the range and goes to exactly zero in black.
       *
       * It is also quantised to roughly 24Hz rather than redrawn every frame,
       * so it reads as film rather than as digital fizz: at 60fps an
       * unquantised hash decorrelates completely every frame, which is more
       * than twice the temporal energy of the thing it is imitating.
       */
      const seed = time.mul(24).floor().mul(37.0);
      const noise = screenCoordinate.x
        .mul(12.9898)
        .add(screenCoordinate.y.mul(78.233))
        .add(seed)
        .sin()
        .mul(43758.5453)
        .fract()
        .sub(0.5);
      // Eased off in the highlights too — blown film has no grain left to show.
      const lum = rgb.dot(vec3(0.2126, 0.7152, 0.0722));
      const rolloff = smoothstep(2.2, 0.5, lum).mul(0.75).add(0.25);
      rgb = rgb.mul(float(1).add(noise.mul(uniforms.grain).mul(2.2).mul(rolloff)));
    }

    pipeline.outputNode = vec4(rgb, 1);
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
    /** The renderer's pixel ratio, so the effects keep their size on screen. */
    setPixelRatio(ratio: number): void {
      pixelRatio = ratio;
      applyScale();
    },
    /** How strongly out-of-focus things blur, in screen terms; 0 for none. */
    setBokeh(amount: number): void {
      bokehBase = amount;
      applyScale();
    },
    render(): Promise<void> | void {
      return pipeline.render();
    },
    dispose(): void {
      pipeline.dispose();
    },
  };
}
