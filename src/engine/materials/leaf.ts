/**
 * Foliage — the material that carries most of the golden-hour look.
 *
 * The blade outline is baked into the geometry, so there is no alpha test.
 * What sells it instead is subsurface scattering: leaves between the camera
 * and a low sun glow from behind, which is what makes evening canopies read
 * as translucent rather than as flat green cards.
 */
import { DoubleSide, MeshStandardNodeMaterial } from 'three/webgpu';
import {
  cameraPosition,
  float,
  mix,
  normalWorld,
  positionLocal,
  positionWorld,
  smoothstep,
  step,
  uniformArray,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import type { Vector4 } from 'three';
import type Node from 'three/src/nodes/core/Node.js';
import {
  growthPosition,
  hoverAt,
  LEAF_RELEASE_BUCKETS,
  rotateAboutAxis,
  treeParams,
  vec3Attribute,
  type TreeUniforms,
} from './shared';

export interface LeafMaterial {
  material: MeshStandardNodeMaterial;
  /**
   * Push the release queue to the GPU. Same hand-rolled sync the fruit needs,
   * and for the same reason — see `createFruitMaterial`.
   */
  syncFall(): boolean;
}

/**
 * Metres per second, on average. A leaf reaches terminal velocity almost at
 * once, so this is a speed and not an acceleration: leaves that accelerate like
 * fruit read as wet paper. Each leaf varies around it by ±30%, because a shower
 * that all falls at one speed descends as a sheet.
 */
const DESCENT = 1.0;
/** Where a leaf comes to rest — clear of the ground by more than its flattened thickness. */
const LITTER_Y = 0.035;
/** How far one unit of wind carries a leaf, in metres per second. */
const WIND_CARRY = 2.4;
/** Seconds over which the leaves sharing a bucket of the release queue come away. */
const RELEASE_SPREAD = 0.45;

type FloatNode = Node<'float'>;
type Vec4Node = Node<'vec4'>;

/**
 * @param releaseTimes The release queue: when the tree's running shed passed
 *   each bucket, or -1 for buckets it has not reached. `LEAF_RELEASE_SLOTS`
 *   long, four buckets to a slot. See `LEAF_RELEASE_SLOTS`.
 */
export function createLeafMaterial(u: TreeUniforms, releaseTimes: Vector4[]): LeafMaterial {
  const material = new MeshStandardNodeMaterial();
  material.side = DoubleSide;
  const st = uv();
  const { seed: rawSeed, occlusion } = treeParams();
  const isBlossom = step(1.5, rawSeed);
  const seed = rawSeed.fract();

  // Thinning happens on the GPU: a leaf whose hash falls above the density
  // threshold collapses to a point. The hash is decorrelated from `seed` so
  // thinning does not also bias the colour and flutter variation.
  const keep = step(rawSeed.mul(97.31).fract(), u.leafCull);
  const radial = u.leafSize.mul(keep);
  const { position: hanging, pivot } = growthPosition(u, {
    thickenBase: 0.5,
    flutter: true,
    radial,
  });

  // ---------------------------------------------------------- letting go
  //
  // The leaf's place in the queue is a hash of its seed, so neighbours are
  // nowhere near each other in line and the crown thins evenly all over. The
  // bucket's release time comes out of a packed vec4 by a one-hot dot product,
  // which is how a dynamic lane index is taken without a branch.
  const center = vec3Attribute('aCenter');
  const order = seed.mul(431.71).fract();
  const queued = order.mul(LEAF_RELEASE_BUCKETS);
  const bucket = queued.floor();
  const slot = bucket.div(4).floor();
  const lane = bucket.sub(slot.mul(4));
  const releaseArray = uniformArray(releaseTimes, 'vec4');
  // `element()` loses the element type on the way out; assert it back.
  const four = releaseArray.element(slot.toInt()) as unknown as Vec4Node;
  const pick = vec4(
    float(1).sub(step(0.5, lane)),
    step(0.5, lane).sub(step(1.5, lane)),
    step(1.5, lane).sub(step(2.5, lane)),
    step(2.5, lane),
  );
  const released = four.dot(pick);
  const letGo = released.add(queued.fract().mul(RELEASE_SPREAD));
  const loose = step(0, released).mul(step(letGo, u.fallClock));

  // Three more decorrelated draws, for the leaf's own way of falling.
  const r1 = seed.mul(53.17).fract();
  const r2 = seed.mul(91.33).fract();
  const r3 = seed.mul(17.71).fract();

  const speed = float(DESCENT).mul(r1.mul(0.6).add(0.7));
  const landsAt = center.y.sub(LITTER_Y).max(0).div(speed);
  const age = u.fallClock.sub(letGo).max(0).min(landsAt);

  /*
   * The leaf leaves from where it was drawn and settles where still air would
   * have put it — `settle` carries it from the swaying pivot to the fixed
   * anchor, and from the fluttering blade to the rest blade, over the first
   * half second. Every other motion below starts from zero and is scaled in by
   * the same ramp, so nothing pops at the moment of release.
   */
  const settle = smoothstep(0, 0.5, age);
  const aloft = smoothstep(0, 0.6, landsAt.sub(age));
  const landed = aloft.oneMinus();
  const anchor = mix(pivot, center, settle);
  const blade = mix(hanging.sub(pivot), positionLocal.sub(center).mul(radial), settle);

  /*
   * Carried by the wind — the same wind the tree is swaying in.
   *
   * The branches are driven by `0.38 + 0.62·gust`, where the gust is a sum of
   * three sines in time. A leaf in that air drifts at a speed proportional to
   * it, so its displacement is the *integral* of the drive over its flight,
   * and the integral of a sum of sines is a sum of cosines: closed form, no
   * state, exact for any frame rate. So leaves surge downwind in exactly the
   * gusts that bend the crown, hang almost still in the lulls between them,
   * and a high leaf, longer in the air, is carried further than a low one.
   *
   * Taken over a fixed window — release to release-plus-age, with age frozen
   * at touchdown — so a leaf lying in the grass is not slid along by gusts that
   * blow after it has landed.
   */
  const windDir = vec3(u.windDir.x, 0, u.windDir.y).normalize();
  const across = vec3(windDir.z, 0, windDir.x.negate());
  const ws = u.windSpeed.max(0.05);
  const gustIntegral = (t: FloatNode): FloatNode => {
    const c = t.mul(ws);
    return c
      .cos()
      .mul(-0.5)
      .sub(c.mul(1.63).add(1.3).cos().mul(0.3 / 1.63))
      .sub(c.mul(0.37).cos().mul(0.2 / 0.37))
      .div(ws);
  };
  const driveRun = age.mul(0.38).add(gustIntegral(letGo.add(age)).sub(gustIntegral(letGo)).mul(0.62));
  const catchesWind = r2.mul(0.8).add(0.6);
  const carried = windDir.mul(u.wind.mul(WIND_CARRY).mul(catchesWind).mul(driveRun));

  // Turbulence. The air under a canopy is not a steady stream, so each leaf
  // also wanders on two slow incommensurate sines of its own, across the wind
  // and along it, by more the windier it is. Offset by their starting value so
  // they begin at zero.
  const stir = u.wind.mul(0.9).add(0.22);
  const phaseA = r1.mul(6.283);
  const phaseB = r3.mul(6.283);
  const wanderA = age.mul(r3.mul(0.5).add(0.55)).add(phaseA).sin().sub(phaseA.sin());
  const wanderB = age.mul(r2.mul(0.4).add(0.4)).add(phaseB).sin().sub(phaseB.sin());
  const wander = across.mul(wanderA).add(windDir.mul(wanderB.mul(0.6))).mul(stir).mul(0.75);

  /*
   * The see-saw. A falling leaf glides one way, stalls, tips, and glides back —
   * a pendulum about a horizontal axis of its own. It rises a little at the end
   * of each glide (twice per period, hence the doubled phase), and rocks as it
   * goes, tilted hardest mid-glide. The rise is faded out before touchdown so
   * the landing height stays exact.
   */
  const swingDir = vec3(phaseB.cos(), 0, phaseB.sin());
  const swingRate = r1.mul(1.5).add(2.1);
  const swingPhase = age.mul(swingRate).add(r2.mul(6.283));
  const glide = swingDir.mul(swingPhase.sin().mul(r3.mul(0.22).add(0.2))).mul(settle);
  const rise = swingPhase.mul(2).cos().oneMinus().mul(0.05).mul(settle).mul(aloft);

  const rockAxis = vec3(swingDir.z.negate(), 0, swingDir.x);
  const yawed = rotateAboutAxis(blade, vec3(0, 1, 0), age.mul(r2.sub(0.5).mul(2.4)));
  const rocked = rotateAboutAxis(yawed, rockAxis, swingPhase.cos().mul(0.7).mul(settle).mul(aloft));

  // Laid down over the last moments of the fall. Squashing the blade's own
  // vertical extent lays it flat whatever angle it was tumbling through, which
  // a rotation to horizontal could not do without knowing that angle.
  const lying = vec3(rocked.x, rocked.y.mul(mix(float(1), float(0.08), landed)), rocked.z);

  const descent = vec3(0, age.mul(speed).sub(rise), 0);
  const fallen = anchor.sub(descent).add(glide).add(wander).add(carried).add(lying);
  material.positionNode = mix(hanging, fallen, loose);

  // Veins: a bright midrib plus a fan of laterals.
  const offCentre = st.x.sub(0.5).abs();
  const midrib = smoothstep(0.06, 0.0, offCentre);
  const laterals = st.y.mul(13.0).add(offCentre.mul(10.0)).sin().abs().pow(7.0).mul(0.35);
  const veins = midrib.mul(0.7).add(laterals).clamp(0, 1);

  const exposure = occlusion.oneMinus();

  // Every leaf gets its own tint and its own moment of turning. Leaves on the
  // outside of the crown catch the most sun and turn first, as they do on a
  // real tree, so autumn sweeps inward instead of switching on all at once.
  const summer = mix(u.leafBase, u.leafTip, st.y.mul(0.5).add(seed.mul(0.35)).add(exposure.mul(0.25)));
  const turned = u.autumn.mul(1.8).sub(seed.mul(0.45)).sub(occlusion.mul(0.6)).clamp(0, 1);
  const autumnal = mix(summer, u.leafAutumn.mul(seed.mul(0.4).add(0.8)), turned);
  const foliage = mix(autumnal, u.litterColor.mul(seed.mul(0.5).add(0.75)), u.leafDry.mul(turned));
  const petal = u.blossom.mul(seed.mul(0.25).add(0.85));

  const base = mix(foliage, petal, isBlossom);
  const withVeins = mix(base, base.mul(1.3).add(0.015), veins);

  // Leaf margins are thinner and often paler or scorched, and the eye reads a
  // slightly lighter rim as a physical edge rather than as a cut-out.
  const margin = smoothstep(0.36, 0.5, offCentre).add(smoothstep(0.86, 1.0, st.y)).clamp(0, 1);
  const edged = mix(withVeins, withVeins.mul(1.18).add(0.01), margin.mul(0.55));

  // The inside of a canopy sees almost no sky. Without this the whole crown
  // reads as one flat green mass however many leaves it has.
  // Occlusion is baked at full density, so thinning the canopy has to lighten
  // it too or a sparse crown stays as dark as a full one.
  // A leaf on the ground is out of the canopy it was shaded by, and drying.
  const litter = mix(edged, u.litterColor.mul(seed.mul(0.4).add(0.8)), loose.mul(landed).mul(0.75));
  const canopy = occlusion.mul(u.occlusionStrength).mul(u.leafCull.mul(0.7).add(0.3));
  const shade = mix(canopy, canopy.mul(0.25), loose);

  // Snow lies on the leaves still up there, not on the litter under them.
  const settled = smoothstep(0.25, 0.85, normalWorld.y.abs()).mul(u.snow).mul(loose.oneMinus()).mul(0.8);
  material.colorNode = mix(litter.mul(shade.mul(0.78).oneMinus()), u.snowColor, settled);
  // Leaves are waxy, but not uniformly so — a cuticle varies leaf to leaf and
  // dulls in shade. One roughness for the whole canopy is most of what makes
  // foliage read as moulded plastic.
  material.roughnessNode = float(0.46)
    .add(seed.mul(0.22))
    .sub(veins.mul(0.08))
    .add(shade.mul(0.34))
    .add(margin.mul(0.12))
    .add(settled.mul(0.3))
    .clamp(0.1, 1);
  material.metalnessNode = float(0);

  // Subsurface: bright when the sun is behind the leaf, brightest when the
  // camera is also looking into the sun.
  const view = cameraPosition.sub(positionWorld).normalize();
  const backLit = u.sunDir.negate().dot(normalWorld).clamp(0, 1);
  const looksIntoSun = view.dot(u.sunDir.negate()).clamp(0, 1).pow(3.5);
  const thinness = st.y.mul(0.45).add(0.55);
  // Only leaves that can actually see the sun glow — a buried leaf has nothing
  // shining through it.
  const scatter = backLit.mul(float(0.3).add(looksIntoSun.mul(0.7))).mul(thinness).mul(exposure);

  // A leaf that turns toward the pointer would catch more light, so it also
  // brightens very slightly. Movement alone is easy to miss in a dense canopy
  // and impossible to see at all on a leaf already in deep shade; a touch of
  // light is what makes the response read from across the tree. Kept well under
  // the scattering term so it never looks like a selection highlight.
  const near = hoverAt(u, vec3Attribute('aCenter'));
  material.emissiveNode = base
    .mul(u.sunColor)
    .mul(scatter)
    .mul(u.translucency)
    .mul(1.7)
    .add(base.mul(near).mul(0.16))
    // Nothing shines through a leaf lying face down in the grass.
    .mul(loose.mul(0.85).oneMinus());

  return {
    material,
    syncFall: () => {
      const node = releaseArray as unknown as { value: Float32Array | null; update(): void };
      if (node.value === null) return false;
      node.update();
      return true;
    },
  };
}
