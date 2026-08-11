/**
 * Uniforms shared by every tree material, plus the growth/wind vertex program.
 *
 * Growth is entirely a GPU effect: the geometry is built once at full size and
 * each vertex is collapsed back toward `aOrigin` until the growth wavefront
 * reaches its `aBirth` time. Nothing is rebuilt as the tree grows.
 */
import { Color, Vector2, Vector3 } from 'three';
import { attribute, float, mix, positionLocal, smoothstep, time, uniform, vec3 } from 'three/tsl';

export type TreeUniforms = ReturnType<typeof createTreeUniforms>;

// `attribute()` infers its node type from the argument, which widens to
// `string` and loses every operator. Pinning the type parameter keeps the
// returned node fully typed.
export const vec3Attribute = (name: string) => attribute<'vec3'>(name, 'vec3');
export const floatAttribute = (name: string) => attribute<'float'>(name, 'float');

export function createTreeUniforms() {
  return {
    /** 0 = seed, 1 = fully grown. */
    growth: uniform(0),
    /** Width of the growth wavefront in birth-time units. */
    growthWindow: uniform(0.28),

    wind: uniform(0.5),
    windSpeed: uniform(1.0),
    windDir: uniform(new Vector2(1, 0.35)),

    /** Direction from a surface toward the sun. */
    sunDir: uniform(new Vector3(-0.55, 0.28, 0.78)),
    sunColor: uniform(new Color(0xffcf9b)),

    /** 0 = high summer, 1 = full autumn. */
    autumn: uniform(0),

    barkDark: uniform(new Color(0x2b2018)),
    barkLight: uniform(new Color(0x8a755c)),
    barkTwig: uniform(new Color(0x6b6141)),
    barkMoss: uniform(new Color(0x4d5c2e)),
    barkBump: uniform(0.5),
    // Roughly the number of bark furrows around a branch, per unit of radius.
    barkScale: uniform(16.0),
    mossAmount: uniform(0.45),

    leafBase: uniform(new Color(0x2f5320)),
    leafTip: uniform(new Color(0x86a83c)),
    leafAutumn: uniform(new Color(0xc06a1e)),
    blossom: uniform(new Color(0xffd7e4)),
    translucency: uniform(1.0),
  };
}

export interface GrowthOptions {
  /** Radial scale a vertex already has the moment it is born. */
  thickenBase: number;
  /** Multiplier on this material's wind response. */
  windScale: number;
}

/**
 * Returns a replacement for `positionLocal`: the vertex, grown into place and
 * pushed around by the wind.
 */
export function growthPosition(u: TreeUniforms, opts: GrowthOptions) {
  const origin = vec3Attribute('aOrigin');
  const center = vec3Attribute('aCenter');
  const birth = floatAttribute('aBirth');
  const flex = floatAttribute('aFlex');
  const seed = floatAttribute('aSeed');

  const w = u.growthWindow;
  // Push the wavefront slightly past 1 so the tips finish exactly at growth = 1.
  const front = u.growth.mul(float(1).add(w));
  const extend = smoothstep(0, 1, front.sub(birth).div(w).clamp(0, 1));

  // Vertices keep filling out after they appear, so the tree thickens with age.
  const base = float(opts.thickenBase);
  const fill = extend.mul(base.add(base.oneMinus().mul(u.growth)));

  const grown = mix(origin, center, extend).add(positionLocal.sub(center).mul(fill));

  // Wind: two slow gusts plus a fast flutter, all keyed off world position so
  // neighbouring vertices move together instead of shimmering.
  const t = time.mul(u.windSpeed);
  const phase = grown.x.mul(0.33).add(grown.z.mul(0.27));
  const gust = t.add(phase).sin().mul(0.62).add(t.mul(1.71).add(phase.mul(1.9)).sin().mul(0.38));
  const flutter = t.mul(4.7).add(grown.y.mul(2.1)).add(seed.mul(21.7)).sin().mul(0.22);

  const amp = u.wind.mul(flex).mul(extend).mul(opts.windScale);
  const sway = gust.add(flutter).mul(amp);
  const dir = vec3(u.windDir.x, 0, u.windDir.y).normalize();

  return grown.add(dir.mul(sway)).add(vec3(0, gust.mul(amp).mul(0.13), 0));
}
