/**
 * Uniforms shared by every tree material, plus the growth and wind vertex program.
 *
 * Growth is entirely a GPU effect: the geometry is built once at full size and
 * each vertex is collapsed back toward `aOrigin` until the growth wavefront
 * reaches its `aBirth` time. Nothing is rebuilt as the tree grows.
 *
 * Wind is two nested *rotations*, never a translation:
 *
 *   1. The whole tree leans about its base, by an angle that varies smoothly
 *      with height. Because the weight is a smooth function of position, two
 *      neighbouring pieces of geometry always move together — which is what
 *      stops leaves from shearing through each other.
 *   2. Each leaf then turns about its own attachment point. Anchoring the
 *      rotation there bounds how far a leaf can travel by its own length,
 *      however hard the wind blows.
 *
 * Displacing vertices instead would stretch branches and let leaves slide off
 * the twigs that carry them.
 */
import { Color, Vector2, Vector3 } from 'three';
import { attribute, float, mix, positionLocal, smoothstep, time, uniform, vec3 } from 'three/tsl';
// `three/webgpu` re-exports the concrete node classes but not the base `Node`
// type itself, which is what every TSL operator actually returns.
import type Node from 'three/src/nodes/core/Node.js';

export type TreeUniforms = ReturnType<typeof createTreeUniforms>;

// `attribute()` infers its node type from the argument, which widens to
// `string` and loses every operator. Pinning the type parameter keeps the
// returned node fully typed.
export const vec3Attribute = (name: string) => attribute<'vec3'>(name, 'vec3');
export const vec4Attribute = (name: string) => attribute<'vec4'>(name, 'vec4');

/**
 * The four per-vertex scalars, packed into one attribute. WebGPU only
 * guarantees 8 vertex buffers and a scalar each would need 9.
 */
export function treeParams() {
  const p = vec4Attribute('aParams');
  return { birth: p.x, flex: p.y, seed: p.z, occlusion: p.w };
}

export function createTreeUniforms() {
  return {
    /** 0 = seed, 1 = fully grown. */
    growth: uniform(0),
    /** Width of the growth wavefront in birth-time units. */
    growthWindow: uniform(0.28),

    wind: uniform(0.5),
    windSpeed: uniform(1.0),
    windDir: uniform(new Vector2(1, 0.35)),
    /** Peak lean of the crown, in radians, at wind = 1. */
    windBend: uniform(0.22),
    /** Peak turn of a single leaf about its stem, in radians, at wind = 1. */
    leafFlutter: uniform(0.5),

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
    /** Birch-style horizontal lenticel dashes. */
    lenticels: uniform(0),

    // Live rescaling. Geometry is baked once at the preset's radius and leaf
    // size; these carry the ratio so the sliders need no rebuild.
    radiusScale: uniform(1),
    leafSize: uniform(1),
    /** Keep leaves whose hash falls under this — the foliage-density slider. */
    leafCull: uniform(1),

    leafBase: uniform(new Color(0x2f5320)),
    leafTip: uniform(new Color(0x86a83c)),
    leafAutumn: uniform(new Color(0xc06a1e)),
    blossom: uniform(new Color(0xffd7e4)),
    translucency: uniform(1.0),
    /** How dark the inside of the canopy goes. */
    occlusionStrength: uniform(0.85),
  };
}

type Vec3Node = Node<'vec3'>;
type FloatNode = Node<'float'>;

/** Rodrigues' rotation of `v` about a unit `axis`. Preserves length. */
function rotateAboutAxis(v: Vec3Node, axis: Vec3Node, angle: FloatNode): Vec3Node {
  const c = angle.cos();
  const s = angle.sin();
  return v.mul(c).add(axis.cross(v).mul(s)).add(axis.mul(axis.dot(v).mul(c.oneMinus())));
}

export interface GrowthOptions {
  /** Radial scale a vertex already has the moment it is born. */
  thickenBase: number;
  /** Add per-leaf turning about the attachment point. Foliage only. */
  flutter: boolean;
  /**
   * Live multiplier on a vertex's offset from its pivot — branch thickness or
   * leaf size. Setting it to zero collapses the vertex, which is how leaves
   * are culled without rebuilding the mesh.
   */
  radial?: FloatNode;
}

/**
 * Returns a replacement for `positionLocal`: the vertex, grown into place and
 * moved by the wind.
 */
export function growthPosition(u: TreeUniforms, opts: GrowthOptions) {
  const origin = vec3Attribute('aOrigin');
  const center = vec3Attribute('aCenter');
  const { birth, flex, seed } = treeParams();

  // ------------------------------------------------------------- growth
  const w = u.growthWindow;
  // Push the wavefront slightly past 1 so the tips finish exactly at growth = 1.
  const front = u.growth.mul(float(1).add(w));
  const extend = smoothstep(0, 1, front.sub(birth).div(w).clamp(0, 1));

  // Vertices keep filling out after they appear, so the tree thickens with age.
  const base = float(opts.thickenBase);
  const fill = extend.mul(base.add(base.oneMinus().mul(u.growth)));

  const radial = positionLocal.sub(center).mul(opts.radial ?? float(1));
  const grown = mix(origin, center, extend).add(radial.mul(fill));

  // --------------------------------------------------------------- wind
  const t = time.mul(u.windSpeed);
  const windDir = vec3(u.windDir.x, 0, u.windDir.y).normalize();

  // A gust front travelling downwind, so the whole tree does not pulse at once.
  const travel = grown.x.mul(windDir.x).add(grown.z.mul(windDir.z)).mul(0.2);
  const gust = t
    .sub(travel)
    .sin()
    .mul(0.5)
    .add(t.mul(1.63).sub(travel.mul(1.7)).add(1.3).sin().mul(0.3))
    .add(t.mul(0.37).sub(travel.mul(0.5)).sin().mul(0.2));

  // Wind leans a tree downwind and gusts around that, rather than swinging
  // symmetrically through the rest position.
  const drive = gust.mul(0.62).add(0.38);

  let displaced = grown;

  if (opts.flutter) {
    const local = grown.sub(center);
    const fseed = seed.fract();
    const ft = t.mul(2.7).add(fseed.mul(Math.PI * 10));
    const swing = ft.sin().mul(0.6).add(ft.mul(1.87).add(1.1).sin().mul(0.4));
    const angle = swing.mul(u.wind).mul(u.leafFlutter).mul(gust.abs().mul(0.55).add(0.45));
    const axis = vec3(fseed.mul(17.0).sin(), 0.4, fseed.mul(11.0).cos()).normalize();
    displaced = center.add(rotateAboutAxis(local, axis, angle));
  }

  const bendAxis = vec3(0, 1, 0).cross(windDir).normalize();
  const bend = drive.mul(u.wind).mul(flex).mul(extend).mul(u.windBend);
  return rotateAboutAxis(displaced, bendAxis, bend);
}
