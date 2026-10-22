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
import { Vector3, type Camera, type Scene } from 'three';
import { RenderPipeline, type WebGPURenderer } from 'three/webgpu';
import { float, pass, saturation, screenCoordinate, screenUV, smoothstep, time, uniform, vec3, vec4, vibrance } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { stableDepthOfField } from './dof';

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
    /** How far either side of the focal plane things go fully out of focus. */
    focalLength: uniform(15),
    /** 0 for no focus blur, 1 for the full effect. */
    dofAmount: uniform(1),

    vibrance: uniform(0.45),
    saturation: uniform(1.1),
    vignette: uniform(0.58),
    grain: uniform(0.026),
    /** 0–1, eased: how much of the grain is showing (see `fade`). */
    grainAmount: uniform(1),
    /** A cool cast for night: the eye in moonlight sees blue, and little colour. */
    tint: uniform(new Vector3(1, 1, 1)),
  };

  const pipeline = new RenderPipeline(renderer);
  const toggles: PostToggles = { bloom: true, dof: true, grain: true, antialias: true };
  const fades = { dof: { target: 1 }, grain: { target: 1 } };

  /*
   * The glow is measured in the frame's own pixels, so left alone it changed
   * size on screen whenever the drawing scale did, and at twice the density it
   * was computed over four times the pixels for the same soft result. It is
   * drawn at half the screen's CSS pixels instead, whatever the density: it is
   * a blur, and has no detail to lose.
   */
  let pixelRatio = 1;
  const applyScale = () => {
    bloomPass?.setResolutionScale(0.5 / pixelRatio);
  };

  // The glow, as one number driving several. The scene's mid-tones sit well
  // under 1, so a threshold near 1 only ever caught the sun's disc; and a hard
  // threshold makes a lit patch either glow or not, in blotches. So turning it
  // up lowers the threshold into the mid-tones, over a soft knee, and widens
  // the spread: at the top end the whole lit side of the scene glows a little,
  // the way a lens with a breath of haze on it does.
  let colour = 1;
  let night = 0;
  const applyColour = () => {
    uniforms.vibrance.value = (0.1 + 0.35 * colour) * (1 - 0.7 * night);
    uniforms.saturation.value = (0.86 + 0.24 * colour) * (1 - 0.4 * night);
    uniforms.tint.value.set(1 - 0.16 * night, 1 - 0.07 * night, 1 + 0.1 * night);
  };

  let glow = 0.5;
  const applyGlow = () => {
    const t = glow / 1.5;
    uniforms.bloomStrength.value = glow * 0.7;
    uniforms.bloomThreshold.value = 0.95 - 0.83 * Math.sqrt(t);
    uniforms.bloomRadius.value = 0.5 + 0.4 * t;
    if (bloomPass) bloomPass.smoothWidth.value = 0.5;
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
    applyGlow();
  }

  function rebuild(): void {
    makeScenePass();
    // Effect nodes are wrapped in a proxy at runtime that the published
    // typings do not model, so the chain needs a nudge to stay vec4.
    const asColor = (n: unknown) => n as typeof sceneColor;

    let node = toggles.bloom ? sceneColor.add(bloomPass) : sceneColor;
    if (toggles.dof) {
      node = asColor(stableDepthOfField(node, viewZ, uniforms.focusDistance, uniforms.focalLength, uniforms.dofAmount));
    }

    // Grading works on colour only — `vibrance` and `saturation` return vec3.
    let rgb = saturation(vibrance(node.rgb, uniforms.vibrance), uniforms.saturation).mul(uniforms.tint);

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
      rgb = rgb.mul(float(1).add(noise.mul(uniforms.grain).mul(uniforms.grainAmount).mul(2.2).mul(rolloff)));
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
    /** The Glow slider, 0–1.5 (see `applyGlow`). */
    setGlow(amount: number): void {
      glow = Math.min(1.5, Math.max(0, amount));
      applyGlow();
    },
    /**
     * How much colour, 0 muted → 1 natural → 2 vivid. Vibrance does most of
     * the work, since it lifts the muted colours (the meadow, the bark, the
     * hills) more than the ones that are already strong (the sunlit leaves);
     * a little plain saturation goes with it.
     */
    setColour(amount: number): void {
      colour = Math.min(2, Math.max(0, amount));
      applyColour();
    },
    /** Day 0 → night 1: colour drains and the picture cools, as it does to the eye. */
    setNight(amount: number): void {
      night = amount;
      applyColour();
    },
    /**
     * Focus blur and grain on or off — faded, not switched. Each eases to its
     * target over a third of a second (see `tick`), and only leaves the chain
     * once it has faded to nothing; turning one on puts it back at nothing
     * first. Rebuilding the chain is a shader compile, so it used to be a
     * hitch *and* a cut; now the rebuild happens where it cannot be seen.
     */
    setFocusBlur(on: boolean): void {
      fades.dof.target = on ? 1 : 0;
      if (on && !toggles.dof) {
        uniforms.dofAmount.value = 0;
        toggles.dof = true;
        rebuild();
      }
    },
    setGrain(on: boolean): void {
      fades.grain.target = on ? 1 : 0;
      if (on && !toggles.grain) {
        uniforms.grainAmount.value = 0;
        toggles.grain = true;
        rebuild();
      }
    },
    /** Land every fade where it is heading at once — for the first look. */
    settleFades(): void {
      uniforms.dofAmount.value = fades.dof.target;
      uniforms.grainAmount.value = fades.grain.target;
      const dof = fades.dof.target > 0;
      const grain = fades.grain.target > 0;
      if (dof !== toggles.dof || grain !== toggles.grain) {
        toggles.dof = dof;
        toggles.grain = grain;
        rebuild();
      }
    },
    /** Advance the fades; call once a frame. */
    tick(dt: number): void {
      const k = 1 - Math.exp(-dt / 0.33);
      let rebuildNeeded = false;
      for (const key of ['dof', 'grain'] as const) {
        const f = fades[key];
        const u = key === 'dof' ? uniforms.dofAmount : uniforms.grainAmount;
        u.value += (f.target - u.value) * k;
        if (f.target === 0 && u.value < 0.004 && toggles[key]) {
          u.value = 0;
          toggles[key] = false;
          rebuildNeeded = true;
        }
      }
      if (rebuildNeeded) rebuild();
    },
    render(): Promise<void> | void {
      return pipeline.render();
    },
    dispose(): void {
      pipeline.dispose();
    },
  };
}
