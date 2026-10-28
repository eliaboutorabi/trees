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
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  Color,
  CubeCamera,
  HalfFloatType,
  Mesh,
  NoBlending,
  Scene,
  SphereGeometry,
  Vector3,
  type CubeTexture,
} from 'three';
import { CubeRenderTarget, MeshBasicNodeMaterial, NodeMaterial, type WebGPURenderer } from 'three/webgpu';
import {
  abs,
  acos,
  clamp,
  cos,
  exp2,
  mat2,
  pow,
  dot,
  exp,
  float,
  Fn,
  fract,
  If,
  Loop,
  mix,
  vec2,
  mx_fractal_noise_float,
  mx_noise_float,
  sin,
  step,
  cameraPosition,
  normalWorldGeometry,
  positionWorld,
  positionWorldDirection,
  smoothstep,
  time,
  uniform,
  vec3,
} from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';

export interface SkySettings {
  /** Degrees above the horizon. */
  elevation: number;
  /** Degrees, 0 = +Z. */
  azimuth: number;
  /** 0 clear, 1 thick haze. */
  haze: number;
  /** 0 a clear sky, 1 a closed grey ceiling. Dims and greys the sun with it. */
  overcast?: number;
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
/** The underside of rain cloud: a little blue, and darker overhead than at the horizon. */
const CLOUD_LOW = new Color(0x9aa1a8);
const CLOUD_HIGH = new Color(0x6f777f);
/** What light that has come through cloud looks like — no colour of its own. */
const DIFFUSE_WHITE = new Color(0xdfe3e8);

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
    /** Cloud cover, 0–1. */
    overcast: uniform(0),
    cloudLow: uniform(new Color(0x9aa1a8)),
    cloudHigh: uniform(new Color(0x6f777f)),
    /** How much of a rainbow is showing, 0–1. Never set on the environment sky. */
    rainbow: uniform(0),
    /** 0 day, 1 night, eased between. */
    night: uniform(0),
    /** Where the moon is. */
    moonDir: uniform(new Vector3(0, 0.5, -1).normalize()),
    /** 1 for the sky you see; 0 for the environment bake, which wants no stars or moon disc. */
    detail: uniform(1),
    /** How much aurora is showing, 0–1; it only ever shows at night. */
    aurora: uniform(0),
    /** The direction (horizontal) the curtains hang in. */
    auroraDir: uniform(new Vector3(0, 0, -1)),
  };
}

/** A hue, 0 red → 0.78 violet, as a fully saturated colour. */
function spectrum(hue: Node<'float'>): Vec3Node {
  return abs(fract(vec3(hue).add(vec3(1, 2 / 3, 1 / 3))).mul(6).sub(3)).sub(1).clamp(0, 1) as unknown as Vec3Node;
}

export type SkyUniforms = ReturnType<typeof createSkyUniforms>;

type Vec3Node = Node<'vec3'>;

/*
 * The aurora.
 *
 * Curtains of light hanging in the upper air, drawn the way they usually are
 * in real time: the sky above is sliced into a stack of thin layers, each a
 * plane a little higher than the last, and where the view ray crosses each
 * one it looks up a cheap warped "triangle" noise that folds into long,
 * rippling filaments. Accumulating the layers gives the curtains their height.
 *
 * Colour follows height, as it does in the real thing: a magenta fringe at the
 * very bottom (nitrogen), the green of oxygen through the body of the
 * curtains, shading through violet to the red that oxygen gives off highest
 * up; and some stretches of the display run pinker than others. It moves:
 * the folds twist, the whole display drifts slowly across the sky, waves run
 * along the curtains, and patches brighten and dim.
 */
// TSL nodes are proxied at runtime and their typings do not follow these
// chains through swizzles and matrices; loosely typed here, as in dof.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

const tri = (x: N) => fract(x).sub(0.5).abs();
const tri2 = (p: N) => vec2(tri(p.x.add(tri(p.y.mul(2)))), tri(p.y.add(tri(p.x.mul(2)))));
const turn = (a: N) => mat2(cos(a), sin(a), sin(a).negate(), cos(a));
const FOLD = mat2(0.95534, 0.29552, -0.29552, 0.95534);

const curtainNoise = Fn(([start]: [N]) => {
  const p = vec2(start).toVar();
  const z = float(1.8).toVar();
  const z2 = float(2.5).toVar();
  const rz = float(0).toVar();
  p.assign(turn(p.x.mul(0.06)).mul(p));
  const bp = vec2(p).toVar();
  Loop(4, () => {
    const dg = tri2(bp.mul(1.85)).mul(0.75).toVar();
    // The folds twist at a pace you can see.
    dg.assign(turn(time.mul(0.19)).mul(dg));
    p.subAssign(dg.div(z2));
    bp.mulAssign(1.3);
    z2.mulAssign(0.45);
    z.mulAssign(0.42);
    p.mulAssign(float(1.21).add(rz.sub(1).mul(0.02)));
    rz.addAssign(tri(p.x.add(tri(p.y))).mul(z));
    p.assign(FOLD.mul(p).negate());
  });
  return clamp(float(1).div(pow(rz.mul(29), 1.3)), 0, 0.55);
});

const AURORA_LAYERS = 22;
/** The layers spread over the height a fifty-layer stack would cover, so the curtains keep their length. */
const STRETCH = 50 / AURORA_LAYERS;
const FRINGE = vec3(0.92, 0.22, 0.78);
const GREEN = vec3(0.12, 1.0, 0.45);
const VIOLET = vec3(0.62, 0.22, 0.95);
const RED = vec3(0.95, 0.22, 0.32);
const PINK = vec3(1.0, 0.42, 0.72);

const auroraLight = Fn(([direction, amount]: [N, N]) => {
  const d = vec3(direction).toVar();
  const out = vec3(0).toVar();
  If(amount.greaterThan(0.001).and(d.y.greaterThan(0.02)), () => {
    // Some stretches of the display run pinker than others, and the regions drift.
    const region = mx_noise_float(vec3(d.x.div(d.y).mul(0.55), d.z.div(d.y).mul(0.55), time.mul(0.03)))
      .mul(0.5)
      .add(0.5)
      .toVar();
    const acc = vec3(0).toVar();
    Loop(AURORA_LAYERS, ({ i }: { i: N }) => {
      const fs = float(i).mul(STRETCH).toVar();
      const h = fs.div(50).toVar();
      const height = float(0.8).add(fs.pow(1.4).mul(0.002));
      const along = height.div(d.y.mul(2).add(0.4));
      const ground = vec2(d.z, d.x).mul(along).add(vec2(2.3, -1.1)).toVar();
      // The display drifting across the sky, and waves running along the curtains.
      ground.addAssign(vec2(time.mul(0.045), time.mul(0.012)));
      ground.assign(vec2(ground.x.add(sin(ground.y.mul(0.8).add(time.mul(0.35))).mul(0.22)), ground.y));
      const strength = curtainNoise(ground);
      // Colour by height: magenta fringe, green body, violet, red at the top.
      const body = mix(GREEN, VIOLET, smoothstep(0.32, 0.72, h));
      const high = mix(body, RED, smoothstep(0.7, 1, h));
      const coloured = mix(FRINGE, high, smoothstep(0, 0.1, h));
      const tint = mix(coloured, PINK, smoothstep(0.55, 0.85, region).mul(0.55).mul(smoothstep(0.08, 0.4, h)));
      // Patches brightening and dimming.
      const pulse = sin(time.mul(0.4).add(ground.x.mul(0.6)).add(ground.y.mul(0.3))).mul(0.25).add(0.75);
      acc.assign(mix(acc, tint.mul(strength).mul(pulse), 0.5));
      out.addAssign(acc.mul(exp2(fs.mul(-0.05).sub(2.5))).mul(smoothstep(0, 5, fs)).mul(STRETCH));
    });
    out.mulAssign(smoothstep(0.02, 0.18, d.y));
    // Dark sky between the curtains: the faintest light is let go, so they
    // stand out against the night instead of hazing the whole sky.
    const lum = dot(out, vec3(0.2, 0.7, 0.1));
    out.mulAssign(smoothstep(0.035, 0.14, lum));
  });
  return out.mul(amount).mul(0.62);
});

/**
 * The aurora as a dome of its own, drawn over the sky.
 *
 * Not part of the sky shader: its loops make a large shader, and the first
 * time a browser meets a new one it can take many seconds to compile, during
 * which everything crawls — which every visitor paid on arrival, by day, for
 * something seen only at night and only when asked for. As a separate dome it
 * is built, and compiled in the background, the first time it is wanted.
 * Added over the sky (it is light), behind everything solid, following the
 * camera so it is always at the sky's distance.
 */
export function createAuroraDome(u: SkyUniforms): Mesh {
  const material = new MeshBasicNodeMaterial();
  material.side = BackSide;
  material.transparent = true;
  material.depthWrite = false;
  material.blending = AdditiveBlending;
  material.fog = false;
  const dir = positionWorld.sub(cameraPosition).normalize();
  // Cloud draws over it, as it does over the stars.
  const clear = u.overcast.mul(0.85).oneMinus();
  material.colorNode = auroraLight(dir, u.aurora.mul(u.night).mul(clear)).mul(u.intensity);
  const dome = new Mesh(new SphereGeometry(1200, 32, 16), material);
  dome.frustumCulled = false;
  dome.renderOrder = -1;
  return dome;
}

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
  /*
   * Built as a function with branches on uniforms, so a part that cannot show
   * is skipped outright rather than computed and multiplied by zero. The sky
   * is a large share of the screen, and profiling under load found it the
   * most expensive surface in the frame per pixel — because every pixel of it
   * was working out stars, the Milky Way, the moon's seas, a cloud layer and
   * a rainbow, by day under a clear sky. Each branch tests a uniform, the
   * same for the whole frame, so taking or skipping it costs nothing.
   */
  return Fn(() => {
    const dir = direction.normalize().toVar();
    const y = dir.y;
    const haze = u.haze;

    // Gradient, compressed toward the horizon and flattened further by haze.
    const t = y.clamp(0, 1).pow(float(0.42).add(haze.mul(0.3))).toVar();
    const sky = mix(u.horizon, u.zenith, t).toVar();

    // Warm forward scatter: a tight halo on the sun, and a broad band along its
    // azimuth that hugs the horizon. Haze widens both, because that is what more
    // aerosol does — it spreads the sun's light over more of the sky.
    const cosSun = dir.dot(u.sunDir).clamp(0, 1);
    const halo = cosSun.pow(mix(float(16), float(4), haze)).mul(0.5).add(cosSun.pow(mix(float(4), float(1.5), haze)).mul(0.11));
    const band = y.abs().mul(float(7).sub(haze.mul(4))).negate().exp().mul(cosSun.pow(1.5)).mul(0.26);
    sky.addAssign(u.sunTint.mul(halo.add(band).mul(haze.mul(0.5).add(1))));

    // The disc. Bright enough to bloom, dim enough to stay orange rather than
    // clipping to white — and switched off entirely for the environment map,
    // because a specular lobe at any real roughness integrates a wide cone, so a
    // disc carrying 30x the surrounding radiance smears over every rough surface
    // in the scene. A black-albedo sphere still rendered as a pale grey ball.
    const disc = smoothstep(0.99978, 0.99995, cosSun).mul(u.disc).mul(float(1).sub(haze.mul(0.5)));
    sky.addAssign(u.sunTint.mul(disc));

    /*
     * The rainbow. It is a circle about the point directly opposite the sun:
     * the primary bow 40.6–42.4° out, violet inside and red outside; a fainter
     * secondary at 50–53.6° with its colours the other way round; the sky
     * brighter inside the primary, and Alexander's darker band between the two.
     * Because it is centred on the antisolar point, it is only ever in the half
     * of the sky facing away from the sun, and the higher the sun the lower it
     * sits — above 42° there is none. Drawn into the sky before the cloud, so a
     * closed sky hides it.
     */
    If(u.rainbow.mul(u.night.oneMinus()).greaterThan(0.001), () => {
      const theta = acos(dir.dot(u.sunDir.negate()).clamp(-1, 1)).mul(180 / Math.PI);
      const x1 = theta.sub(40.4).div(2.2);
      const bow1 = smoothstep(0, 0.22, x1).mul(smoothstep(1, 0.78, x1));
      const x2 = theta.sub(50.0).div(3.6);
      const bow2 = smoothstep(0, 0.25, x2).mul(smoothstep(1, 0.75, x2));
      const colour1 = mix(spectrum(mix(float(0.78), float(0), x1.clamp(0, 1))), vec3(1), 0.12);
      const colour2 = mix(spectrum(mix(float(0), float(0.78), x2.clamp(0, 1))), vec3(1), 0.2);
      const shows = u.rainbow.mul(smoothstep(-0.01, 0.03, y)).mul(u.overcast.mul(0.8).oneMinus()).mul(u.night.oneMinus());
      const darkBand = smoothstep(42.2, 43.4, theta).mul(smoothstep(50.4, 49.2, theta));
      const brighterInside = smoothstep(40.6, 26, theta);
      sky.assign(
        sky
          .mul(float(1).sub(darkBand.mul(0.1).mul(shows)))
          .add(sky.mul(brighterInside.mul(0.07).mul(shows)))
          .add(colour1.mul(bow1).mul(0.3).add(colour2.mul(bow2).mul(0.11)).mul(shows)),
      );
    });

    // A brighter line right along the horizon, which is where the most air is.
    const hug = y.abs().mul(26).negate().exp().mul(float(0.05).add(haze.mul(0.3)));
    sky.addAssign(u.horizon.mul(hug));

    /*
     * Cloud. A layer projected onto a plane overhead — dividing by the height of
     * the ray is what makes it recede into the horizon with the right
     * perspective, cells large overhead and crowding into a band low down — and
     * shaded by a few octaves of noise, drifting, so a closed sky is a ceiling
     * with weight and texture rather than a flat grey card. It also swallows the
     * sun's halo and disc, which were added above; that is the point. Under a
     * clear sky none of it is computed.
     */
    const billow = float(0).toVar();
    const cloudMask = float(0).toVar();
    If(u.overcast.greaterThan(0.001), () => {
      const plane = vec3(dir.x, 0, dir.z).div(y.max(0.045)).mul(0.42);
      const drift = time.mul(0.012);
      billow.assign(mx_fractal_noise_float(vec3(plane.x.add(drift), plane.z, drift.mul(0.4)), 4, 2.0, 0.5, 1.0));
      const ceiling = mix(u.cloudLow, u.cloudHigh, t).mul(billow.mul(0.32).add(0.92));
      // Patchy as it thickens: at half cover there are gaps, at full there are none.
      const coverage = smoothstep(
        float(0.62).sub(u.overcast.mul(0.95)),
        float(0.9).sub(u.overcast.mul(0.55)),
        billow.mul(0.5).add(0.5),
      ).max(u.overcast.sub(0.75).mul(4).clamp(0, 1));
      cloudMask.assign(coverage.mul(smoothstep(-0.02, 0.06, y)).mul(u.overcast.mul(4).clamp(0, 1)));
      sky.assign(mix(sky, ceiling, cloudMask));
    });

    // Below the horizon, fade to the dusty bounce coming off the ground.
    const below = smoothstep(0, 0.35, y.negate()).toVar();
    sky.assign(mix(sky, u.ground, below.mul(0.9)));

    /*
     * Night. A deep blue that is darker overhead than at the horizon; a moon
     * with its seas and a darker limb, a soft halo round it; stars, which are
     * hashed into a fine grid of cells on the sphere — only a few cells hold
     * one, each a small soft point of its own brightness, twinkling slowly and
     * thinning out toward the horizon where the air is thickest; and the faint
     * band of the Milky Way across them. Cloud covers all of it. By day, none
     * of it is computed.
     */
    If(u.night.greaterThan(0.001), () => {
      const nightSky = mix(vec3(0.03, 0.042, 0.078), vec3(0.006, 0.012, 0.034), t).toVar();

      const cosMoon = dir.dot(u.moonDir).clamp(-1, 1).toVar();
      const moonGlow = cosMoon.clamp(0, 1).pow(420).mul(0.22).add(cosMoon.clamp(0, 1).pow(18).mul(0.025)).toVar();
      nightSky.addAssign(vec3(0.55, 0.63, 0.82).mul(moonGlow));

      // Stars, the Milky Way and the moon's disc only in the sky you see: the
      // environment bake wants none of them, and cannot resolve them anyway.
      If(u.detail.greaterThan(0.5), () => {
        const above = smoothstep(0.0, 0.2, y);
        const cell = dir.mul(160);
        const id = cell.floor();
        const h = fract(sin(dot(id, vec3(127.1, 311.7, 74.7))).mul(43758.5453));
        const h2 = fract(h.mul(17.31));
        const point = smoothstep(0.17, 0.0, cell.fract().sub(0.5).length());
        const twinkle = sin(time.mul(h2.mul(2.5).add(1.2)).add(h.mul(90))).mul(0.22).add(0.78);
        const star = step(0.968, h).mul(point).mul(h2.pow(3).mul(2.4).add(0.3)).mul(twinkle);
        const milky = exp(dot(dir, vec3(0.32, 0.58, -0.75)).pow(2).mul(-26));
        const dust = mx_fractal_noise_float(dir.mul(5.5), 4, 2.0, 0.5, 1.0).mul(0.5).add(0.5);
        nightSky.addAssign(vec3(0.55, 0.6, 0.82).mul(milky.mul(dust).mul(0.06)).mul(above));
        nightSky.addAssign(vec3(0.92, 0.94, 1).mul(star).mul(above));

        const moonR = 0.026;
        const moonAngle = acos(cosMoon);
        const moonDisc = smoothstep(moonR, moonR * 0.93, moonAngle);
        const local = dir.sub(u.moonDir.mul(cosMoon)).div(moonR);
        const seas = smoothstep(0.38, 0.62, mx_noise_float(local.mul(1.7).add(3.1)).mul(0.5).add(0.5));
        const limb = moonAngle.div(moonR).clamp(0, 1).pow(2).oneMinus().sqrt();
        const moon = vec3(0.96, 0.94, 0.87).mul(mix(float(0.66), float(1), seas)).mul(mix(float(0.6), float(1), limb)).mul(1.15);
        nightSky.assign(mix(nightSky, moon, moonDisc));
      });

      // Night cloud: dark, lit a little at the edges by the moon.
      const nightCloud = vec3(0.028, 0.034, 0.05).mul(billow.mul(0.3).add(0.85)).add(vec3(0.3, 0.34, 0.45).mul(moonGlow.mul(0.6)));
      nightSky.assign(mix(nightSky, nightCloud, cloudMask));
      nightSky.assign(mix(nightSky, vec3(0.018, 0.022, 0.032), below.mul(0.9)));

      sky.assign(mix(sky, nightSky, u.night));
    });

    return sky.mul(u.intensity);
  })() as unknown as Vec3Node;
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
    this.envUniforms.detail.value = 0;

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
    const overcast = clamp01(settings.overcast ?? 0);
    sunLight(settings, this.light);
    // Cloud dims the beam, and takes the colour out of what gets through: under
    // a closed sky the light is a soft neutral from everywhere, not a warm beam
    // from one place. Dimming without the greying leaves a golden-hour scene
    // that has merely been turned down.
    this.light.strength *= 1 - 0.78 * overcast;
    this.light.color.lerp(DIFFUSE_WHITE, 0.65 * overcast);
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
    u.overcast.value = overcast;
    // Cloud lit from above by whatever sun is left, so a sunset over broken
    // cloud still warms its edges.
    u.cloudLow.value.copy(CLOUD_LOW).lerp(this.light.color, 0.25 * (1 - overcast));
    u.cloudHigh.value.copy(CLOUD_HIGH);

    // Mirror everything except the disc onto the environment sky.
    const e = this.envUniforms;
    e.sunDir.value.copy(u.sunDir.value);
    e.sunTint.value.copy(u.sunTint.value);
    e.haze.value = u.haze.value;
    e.horizon.value.copy(u.horizon.value);
    e.zenith.value.copy(u.zenith.value);
    e.ground.value.copy(u.ground.value);
    e.intensity.value = u.intensity.value;
    e.overcast.value = u.overcast.value;
    e.cloudLow.value.copy(u.cloudLow.value);
    e.cloudHigh.value.copy(u.cloudHigh.value);

    this.envDirty = true;
    return this.light;
  }

  /** How much aurora is showing, 0–1 (at night only; the day sky ignores it). */
  setAurora(amount: number, toward?: Vector3): void {
    this.uniforms.aurora.value = amount;
    if (toward) this.uniforms.auroraDir.value.copy(toward);
  }

  /** Day to night, 0–1, and where the moon is. */
  setNight(amount: number, moon: Vector3): void {
    this.uniforms.night.value = amount;
    this.envUniforms.night.value = amount;
    this.uniforms.moonDir.value.copy(moon);
    this.envUniforms.moonDir.value.copy(moon);
    this.envDirty = true;
  }

  /** How much of a rainbow is showing, 0–1. The environment sky never has one: it would tint the light. */
  setRainbow(amount: number): void {
    this.uniforms.rainbow.value = amount;
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
    // At most ten times a second. While the sun is dragged, or night falls,
    // the sky changes every frame, and re-rendering and refiltering the cube
    // that often was a large share of the frame for light that changes
    // slowly; the last change still always lands.
    const now = performance.now();
    if (now - this.lastRefresh < 100) return;
    this.lastRefresh = now;
    this.envDirty = false;
    this.envCamera.update(renderer, this.envScene);
  }

  private lastRefresh = -Infinity;

  dispose(): void {
    this.envMesh.geometry.dispose();
    (this.envMesh.material as NodeMaterial).dispose();
    this.envTarget.dispose();
  }
}
