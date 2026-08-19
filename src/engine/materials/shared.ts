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
import {
  attribute,
  faceDirection,
  float,
  mix,
  normalView,
  positionLocal,
  positionView,
  smoothstep,
  time,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
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

    // Flowers and fruit. Sites are baked at rebuild time and culled here, so
    // every one of these is live.
    /** Fraction of baked sites that carry a flower. */
    flowerDensity: uniform(0),
    flowerSize: uniform(1),
    flowerColor: uniform(new Color(0xf6d9e8)),
    flowerCore: uniform(new Color(0xf2c455)),
    /** Fraction of baked sites that carry a fruit. */
    fruitDensity: uniform(0),
    fruitSize: uniform(0.65),
    fruitColor: uniform(new Color(0xb8231f)),
    /** Where the shaded underside of a fruit has not turned yet. */
    fruitUnripe: uniform(new Color(0x5c6a20)),
    /** The sunward cheek — warmer, not brighter. */
    fruitSun: uniform(new Color(0xd4581a)),
    /**
     * 1 = every fruit is the chosen skin colour; 0 = the crop is still green.
     * This used to be hard-coded high enough that a pure red came out olive on
     * its shaded half, with no way to turn it off.
     */
    fruitRipeness: uniform(0.9),
    /** How far the sunward cheek shifts toward orange. Also once hard-coded. */
    fruitBlush: uniform(0.18),
    /** The waxy rim dust on a plum. Pale, so a little goes a long way. */
    fruitWax: uniform(0.1),
    /** 0 matte like a plum, 1 polished like an apple. */
    fruitGloss: uniform(0.45),

    // Pointer response. A world-space ball of influence rather than a picked
    // object: see `hoverAt` for why that is the whole trick.
    hoverPoint: uniform(new Vector3(0, -1000, 0)),
    hoverRadius: uniform(1.1),
    /** 0 while the pointer is away, eased to 1 — never switched. */
    hoverStrength: uniform(0),
    /** How far foliage parts, in world units, at full strength. */
    hoverPush: uniform(0.09),
    /** Peak turn of a single leaf about its stem, in radians. */
    hoverTurn: uniform(0.5),

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

/**
 * Perturb the shading normal by a *procedural* height field.
 *
 * three's own `bumpMap()` cannot do this, and fails silently when asked to.
 * It takes its three height samples by re-evaluating the node with the UV
 * context overridden — a trick that only a `TextureNode` responds to. Hand it a
 * computed expression and all three samples come back identical, the gradient
 * is exactly zero, and the returned normal is the untouched one. The bark
 * relief slider moved a uniform that could not reach a single pixel: 0 and 40
 * produced byte-identical frames.
 *
 * So the gradient is taken directly, from screen-space derivatives of the
 * height value itself. The rest is Mikkelsen's surface-gradient construction,
 * which is what makes the perturbation independent of any UV parameterisation —
 * necessary here, since bark noise is evaluated in object space.
 */
export function proceduralBump(height: FloatNode, scale: FloatNode | number): Vec3Node {
  const h = height.toVar();
  const grad = vec2(h.dFdx(), h.dFdy()).mul(scale);

  // Normalised so the effect does not change strength with screen size.
  const sigmaX = positionView.dFdx().normalize();
  const sigmaY = positionView.dFdy().normalize();
  const n = normalView;

  const r1 = sigmaY.cross(n);
  const r2 = n.cross(sigmaX);
  const det = sigmaX.dot(r1).mul(faceDirection);
  const surfaceGrad = det.sign().mul(grad.x.mul(r1).add(grad.y.mul(r2)));

  return det.abs().mul(n).sub(surfaceGrad).normalize();
}

/**
 * How strongly the tree responds to the pointer at a given point in space.
 *
 * Deliberately a *field*, not a pick. Raycasting for the leaf under the cursor
 * and highlighting that one leaf gives exactly the discrete, snapping response
 * this is trying to avoid — the effect would jump from leaf to leaf, and a
 * raycast against baked geometry would be wrong anyway, because growth and wind
 * both move the mesh on the GPU where a CPU raycast cannot see it.
 *
 * Instead the pointer contributes one world-space point and everything falls
 * off smoothly with distance from it. Nothing is ever selected, so nothing can
 * pop: move the cursor and the response slides across the canopy, and thousands
 * of leaves each answer a little.
 *
 * Evaluate this at a vertex's *pivot* rather than at the vertex. Neighbouring
 * geometry then shares almost the same weight, which is what keeps a leaf rigid
 * and keeps it attached to the twig carrying it — the same reasoning the wind
 * relies on.
 */
export function hoverAt(u: TreeUniforms, pivot: Vec3Node): FloatNode {
  const near = float(1).sub(pivot.sub(u.hoverPoint).length().div(u.hoverRadius).clamp(0, 1));
  return smoothstep(0, 1, near).pow(1.4).mul(u.hoverStrength);
}

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
  const swayed = rotateAboutAxis(displaced, bendAxis, bend);

  // -------------------------------------------------------------- pointer
  //
  // The pivot is put through the same wind rotation before it is measured
  // against the pointer. Comparing the *rest* pivot instead would leave a
  // gusting canopy responding where it used to be, which on a windy preset is
  // most of a leaf's length away from where it is drawn.
  const pivot = rotateAboutAxis(center, bendAxis, bend);

  // Only what can actually move. Foliage always can; wood is compliant in
  // proportion to how thin it is, taken from the vertex's own distance to the
  // strand axis — which is precisely the branch radius there. So twigs stir and
  // the trunk does not, without needing another attribute to say which is which.
  const compliance = opts.flutter
    ? float(1)
    : smoothstep(0.14, 0.02, positionLocal.sub(center).length());
  const near = hoverAt(u, pivot).mul(compliance).mul(extend);

  // Part, rather than highlight. Foliage eases away from the pointer and lifts
  // a little, the way a canopy opens around a hand pushed into it. The lift is
  // what keeps it from reading as a flat repulsion field.
  const away = pivot.sub(u.hoverPoint);
  const outward = away.div(away.length().max(0.001));
  const parted = swayed.add(outward.add(vec3(0, 0.55, 0)).mul(near).mul(u.hoverPush));

  if (!opts.flutter) return parted;

  // Each leaf also turns on its own stem, about its own axis and by its own
  // amount. Turning them all alike is what would make this read as a machine
  // sweeping over the canopy rather than as leaves catching a disturbance.
  const fs = seed.fract();
  const turnAxis = vec3(fs.mul(23.0).sin(), 0.55, fs.mul(9.0).cos()).normalize();
  const turn = near.mul(u.hoverTurn).mul(fs.mul(0.7).add(0.5));
  const pivoted = rotateAboutAxis(parted.sub(pivot), turnAxis, turn);
  return pivot.add(pivoted);
}
