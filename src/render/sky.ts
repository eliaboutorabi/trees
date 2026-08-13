/**
 * The sky, the sun, and the light the sun casts — one atmosphere, on the GPU.
 *
 * This used to bake a 1024x512 equirectangular texture in JavaScript every time
 * the sun moved. Measured: **128ms of blocking main thread per change**, which
 * is why nudging the sun slider felt exactly like triggering a rebuild, and why
 * the sky lagged behind the shadows that were already moving. The gradient is
 * now a TSL node used directly as `scene.backgroundNode`, so sun position, haze
 * and light are plain uniforms and move at frame rate.
 *
 * Image-based lighting still needs a texture, so the *same node* is rendered
 * into a small cube map on the GPU. Rendering it rather than baking a second
 * copy in JavaScript is not just faster — it makes it impossible for the sky
 * you see and the sky that lights the tree to disagree, which is precisely the
 * class of bug that once had the painted sun on the opposite side from its own
 * shadows.
 *
 * ## The sun is derived, not chosen
 *
 * Sun colour and brightness are not art-directed constants that happen to look
 * warm. They come from atmospheric extinction along the path the light takes to
 * reach us: air mass from Kasten–Young, Rayleigh scattering weighted by
 * wavelength, plus an aerosol term the haze slider drives. That is why a low
 * sun goes orange on its own and a high one goes white — and why the sky, the
 * disc and the key light can never drift apart, because all three read the same
 * numbers.
 */
import {
  BackSide,
  BoxGeometry,
  Color,
  CubeCamera,
  HalfFloatType,
  Mesh,
  NoBlending,
  Scene,
  Vector3,
  type CubeTexture,
} from 'three';
import { CubeRenderTarget, NodeMaterial, type WebGPURenderer } from 'three/webgpu';
import { float, mix, normalWorldGeometry, positionWorldDirection, smoothstep, uniform } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';

export interface SkySettings {
  /** Degrees above the horizon. */
  elevation: number;
  /** Degrees, 0 = +Z. */
  azimuth: number;
  /** 0 clear, 1 thick haze. */
  haze: number;
}

/**
 * Rayleigh optical depth at the zenith, per channel.
 *
 * From `0.0088 * lambda^-4.15` at 630 / 532 / 465 nm. The steep wavelength
 * dependence is the whole reason a sunset is red: by the time light has taken
 * the long way through the atmosphere, the blue end has been scattered out of
 * the beam and only the red end is left travelling in a straight line.
 */
const RAYLEIGH = [0.0599, 0.1207, 0.2112] as const;

/** Aerosol extinction, relative per channel (`lambda^-1.3`). Much flatter. */
const MIE = [1.82, 2.27, 2.71] as const;

/** Aerosol loading: clear air through to a thick, milky haze. */
const MIE_CLEAR = 0.05;
const MIE_HAZY = 0.32;

/**
 * Full extinction over-reddens, because it accounts only for light removed
 * from the beam and not for light scattered back into it. Raising transmittance
 * to a power below 1 is the standard cheat for the multiple scattering that is
 * missing, and it is the difference between a believable sunset and a laser.
 */
const SCATTER_SOFTEN = 0.75;

const ZENITH = new Color(0x1d3f77);
const HORIZON_WARM = new Color(0xffb367);
const HORIZON_COOL = new Color(0xa8bcd8);
const GROUND_HAZE = new Color(0x5a4a38);
/** What thick haze drains every sky colour toward. */
const HAZE_GREY = new Color(0xb9bec4);

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

function smoothstepJs(a: number, b: number, x: number): number {
  const t = clamp01(a === b ? 0 : (x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export function sunDirection(settings: SkySettings, out = new Vector3()): Vector3 {
  const e = (settings.elevation * Math.PI) / 180;
  const a = (settings.azimuth * Math.PI) / 180;
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)).normalize();
}

/**
 * Relative length of the path sunlight takes through the atmosphere.
 *
 * 1 at the zenith, ~38 at the horizon. A plain `1/sin(h)` diverges as the sun
 * sets, which is what makes naive sunsets go black rather than red; the
 * Kasten–Young correction accounts for the curvature of the atmosphere and
 * stays finite.
 */
export function airMass(elevationDeg: number): number {
  const h = elevationDeg;
  const denom = Math.sin((h * Math.PI) / 180) + 0.50572 * Math.pow(Math.max(0.5, h + 6.07995), -1.6364);
  return Math.min(80, Math.max(1, 1 / Math.max(1e-3, denom)));
}

export interface SunLight {
  /** Direct sunlight colour, normalised so the brightest channel is 1. */
  color: Color;
  /** 0–1 relative brightness of the direct beam, after extinction. */
  strength: number;
  /** Unnormalised transmittance, for tinting the sky's own scattered light. */
  transmittance: Color;
}

/**
 * What survives the trip through the atmosphere, and how much of it.
 *
 * Colour and brightness are separated deliberately. Physically they fall
 * together — at 2° elevation the beam is down to a fraction of a percent — but
 * a light that is both nearly black *and* deep red is unusable, so the hue is
 * normalised out and the dimming is applied as its own, gentler curve.
 */
export function sunLight(settings: SkySettings, out: SunLight = { color: new Color(), strength: 1, transmittance: new Color() }): SunLight {
  const am = airMass(settings.elevation);
  const beta = MIE_CLEAR + (MIE_HAZY - MIE_CLEAR) * clamp01(settings.haze);

  const t: number[] = [];
  for (let i = 0; i < 3; i++) t.push(Math.exp(-(RAYLEIGH[i] + beta * MIE[i]) * am));
  out.transmittance.setRGB(t[0], t[1], t[2]);

  const soft = t.map((x) => Math.pow(x, SCATTER_SOFTEN));
  const peak = Math.max(1e-6, soft[0], soft[1], soft[2]);
  out.color.setRGB(soft[0] / peak, soft[1] / peak, soft[2] / peak);

  // Luminance of what actually arrives, on a curve gentle enough that a low sun
  // still reads as a light source rather than switching off.
  const lum = 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
  out.strength = Math.min(1.1, Math.max(0.08, Math.pow(lum / 0.6, 0.45)));
  return out;
}

/** Uniforms the sky node reads. Every one of them is a CPU-side scalar or colour. */
export function createSkyUniforms() {
  return {
    sunDir: uniform(new Vector3(0, 0.3, 1)),
    /** The sun's own colour, shared with the directional light. */
    sunTint: uniform(new Color(0xffc98a)),
    haze: uniform(0.26),
    horizon: uniform(new Color(0xffb367)),
    zenith: uniform(new Color(0x1d3f77)),
    ground: uniform(new Color(0x5a4a38)),
    /** Brightness of the disc. Zero for the environment bake — see below. */
    disc: uniform(30),
    /** Overall sky brightness, so ambient light has a control of its own. */
    intensity: uniform(1),
  };
}

export type SkyUniforms = ReturnType<typeof createSkyUniforms>;

type Vec3Node = Node<'vec3'>;

/**
 * The sky in a given direction.
 *
 * Deliberately the same artistic gradient the CPU bake used, because that
 * version was tuned and it worked; what changed is where it runs and where its
 * sun colour comes from. An attempt at a full analytic Preetham sky was made
 * and reverted — its assumptions about exposure and turbidity fight a
 * tone-mapped background used simultaneously as an IBL source.
 */
export function skyNode(u: SkyUniforms, direction: Vec3Node): Vec3Node {
  const dir = direction.normalize();
  const y = dir.y;
  const haze = u.haze;

  // Gradient, compressed toward the horizon and flattened further by haze.
  const t = y.clamp(0, 1).pow(float(0.42).add(haze.mul(0.3)));
  let sky = mix(u.horizon, u.zenith, t);

  // Warm forward scatter: a tight halo on the sun, and a broad band along its
  // azimuth that hugs the horizon. Haze widens both, because that is what more
  // aerosol does — it spreads the sun's light over more of the sky.
  const cosSun = dir.dot(u.sunDir).clamp(0, 1);
  const halo = cosSun.pow(mix(float(16), float(4), haze)).mul(0.5).add(cosSun.pow(mix(float(4), float(1.5), haze)).mul(0.11));
  const band = y.abs().mul(float(7).sub(haze.mul(4))).negate().exp().mul(cosSun.pow(1.5)).mul(0.26);
  sky = sky.add(u.sunTint.mul(halo.add(band).mul(haze.mul(0.5).add(1))));

  // The disc. Bright enough to bloom, dim enough to stay orange rather than
  // clipping to white — and switched off entirely for the environment map,
  // because a specular lobe at any real roughness integrates a wide cone, so a
  // disc carrying 30x the surrounding radiance smears over every rough surface
  // in the scene. A black-albedo sphere still rendered as a pale grey ball.
  const disc = smoothstep(0.99978, 0.99995, cosSun).mul(u.disc).mul(float(1).sub(haze.mul(0.5)));
  sky = sky.add(u.sunTint.mul(disc));

  // A brighter line right along the horizon, which is where the most air is.
  const hug = y.abs().mul(26).negate().exp().mul(float(0.05).add(haze.mul(0.3)));
  sky = sky.add(u.horizon.mul(hug));

  // Below the horizon, fade to the dusty bounce coming off the ground.
  const below = smoothstep(0, 0.35, y.negate());
  sky = mix(sky, u.ground, below.mul(0.9));

  return sky.mul(u.intensity);
}

/**
 * The sky as a background node, plus a GPU-rendered cube map of the same sky
 * for image-based lighting.
 */
export class ProceduralSky {
  readonly uniforms = createSkyUniforms();

  /** Assign to `scene.backgroundNode`. Carries the sun disc, so it blooms. */
  readonly backgroundNode: Vec3Node;

  private readonly envUniforms = createSkyUniforms();
  private readonly envTarget = new CubeRenderTarget(96, { type: HalfFloatType });
  private readonly envScene = new Scene();
  private readonly envCamera: CubeCamera;
  private readonly envMesh: Mesh;
  private envDirty = true;
  private readonly light: SunLight = { color: new Color(), strength: 1, transmittance: new Color() };

  constructor() {
    // The background sphere hands the shading direction over as its own world
    // normal — for a unit sphere around the camera that *is* the view ray.
    this.backgroundNode = skyNode(this.uniforms, normalWorldGeometry as unknown as Vec3Node);

    // The environment bake gets its own copy of the uniforms purely so it can
    // hold `disc` at zero while sharing every other value; `update` mirrors the
    // rest across, so the two skies cannot drift.
    this.envUniforms.disc.value = 0;

    const material = new NodeMaterial();
    material.name = 'Sky.environment';
    material.colorNode = skyNode(this.envUniforms, positionWorldDirection as unknown as Vec3Node);
    material.side = BackSide;
    material.blending = NoBlending;
    material.depthTest = false;
    material.depthWrite = false;

    this.envMesh = new Mesh(new BoxGeometry(5, 5, 5), material);
    this.envMesh.frustumCulled = false;
    this.envScene.add(this.envMesh);
    this.envCamera = new CubeCamera(1, 10, this.envTarget);
  }

  /** The cube map to hand to `scene.environment`. Its contents update in place. */
  get environment(): CubeTexture {
    return this.envTarget.texture;
  }

  /**
   * Push a new sun position and haze. Uniform writes only — this is cheap
   * enough to call from a pointermove without a debounce, which is the whole
   * point of the rework.
   */
  update(settings: SkySettings): SunLight {
    const haze = clamp01(settings.haze);
    sunLight(settings, this.light);
    sunDirection(settings, this.uniforms.sunDir.value);

    // The lower the sun, the warmer and deeper the band along the horizon —
    // and the more haze, the further every colour drains toward grey.
    const lowness = 1 - smoothstepJs(0, 30, settings.elevation);
    const horizon = HORIZON_COOL.clone().lerp(HORIZON_WARM, 0.35 + 0.65 * lowness);
    // Tint the horizon by what the sun itself has left, so the band under a
    // deep-red sun cannot stay peach.
    horizon.lerp(this.light.color, 0.3 * lowness);
    const zenith = ZENITH.clone().lerp(horizon, 0.12 + 0.3 * haze);
    horizon.lerp(HAZE_GREY, haze * 0.5);
    zenith.lerp(HAZE_GREY, haze * 0.62);

    const u = this.uniforms;
    u.sunTint.value.copy(this.light.color);
    u.haze.value = haze;
    u.horizon.value.copy(horizon);
    u.zenith.value.copy(zenith);
    u.ground.value.copy(GROUND_HAZE).lerp(horizon, haze * 0.4);
    u.disc.value = 26;

    // Mirror everything except the disc onto the environment sky.
    const e = this.envUniforms;
    e.sunDir.value.copy(u.sunDir.value);
    e.sunTint.value.copy(u.sunTint.value);
    e.haze.value = u.haze.value;
    e.horizon.value.copy(u.horizon.value);
    e.zenith.value.copy(u.zenith.value);
    e.ground.value.copy(u.ground.value);
    e.intensity.value = u.intensity.value;

    this.envDirty = true;
    return this.light;
  }

  /** Overall sky brightness — the ambient half of the lighting controls. */
  setIntensity(value: number): void {
    this.uniforms.intensity.value = value;
    this.envUniforms.intensity.value = value;
    this.envDirty = true;
  }

  /**
   * Re-render the environment cube if the sun has moved. Six 96px faces and a
   * PMREM pass — small enough to run inline, and `CubeCamera.update` flags the
   * texture so the renderer refilters it for us.
   */
  refresh(renderer: WebGPURenderer): void {
    if (!this.envDirty) return;
    this.envDirty = false;
    this.envCamera.update(renderer, this.envScene);
  }

  dispose(): void {
    this.envMesh.geometry.dispose();
    (this.envMesh.material as NodeMaterial).dispose();
    this.envTarget.dispose();
  }
}
