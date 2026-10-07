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
  sin,
  smoothstep,
  step,
  uniformArray,
  uv,
  vec3,
} from 'three/tsl';
import {
  growthPosition,
  hoverAt,
  LEAF_GRID,
  rotateAboutAxis,
  treeParams,
  vec3Attribute,
  type TreeUniforms,
} from './shared';

export interface LeafMaterial {
  material: MeshStandardNodeMaterial;
  /**
   * Push the litter grid to the GPU. Same hand-rolled sync the fruit needs, and
   * for the same reason — see `createFruitMaterial`.
   */
  syncFall(): boolean;
}

/** Metres per second. A leaf reaches terminal velocity almost at once, so this
 *  is a speed and not an acceleration: leaves that accelerate like fruit read
 *  as wet paper, which is the single thing that gives falling foliage away. */
const DESCENT = 1.15;
/** Where a leaf comes to rest. Just clear of the ground so it is not z-fighting. */
const LITTER_Y = 0.02;

/**
 * @param fallGrid One slot per canopy cell: the clock reading when that cell
 *   was shaken, or -1 while its leaves are still attached. `LEAF_GRID_CELLS`
 *   long; see the note on `LEAF_GRID` for why the state is per cell.
 */
export function createLeafMaterial(u: TreeUniforms, fallGrid: number[]): LeafMaterial {
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

  /*
   * Shaken loose.
   *
   * The leaf reads its cell out of the litter grid and falls from the moment
   * that cell was shaken, staggered by its own seed so a cluster comes away
   * over about half a second rather than all at once.
   *
   * Everything about the descent is the opposite of the fruit's. Fruit
   * accelerates, drops plumb and lands where it was hanging; a leaf is at
   * terminal velocity within its own length, see-saws about its long axis the
   * whole way down, and ends up metres downwind. Giving leaves the fruit's
   * parabola is what makes them read as something heavy painted to look like a
   * leaf.
   */
  const center = vec3Attribute('aCenter');
  const cellMax = vec3(LEAF_GRID.x - 1, LEAF_GRID.y - 1, LEAF_GRID.z - 1);
  const cell = center.sub(u.leafGridMin).mul(u.leafGridInvCell).floor().clamp(vec3(0, 0, 0), cellMax);
  const cellIndex = cell.y.mul(LEAF_GRID.z).add(cell.z).mul(LEAF_GRID.x).add(cell.x);
  // Same cast as the fruit's: `element()` loses the scalar-ness of 'float'.
  const fallArray = uniformArray(fallGrid, 'float');
  const shaken = fallArray.element(cellIndex.toInt()) as unknown as ReturnType<typeof float>;

  const letGo = shaken.add(seed.mul(0.55));
  const loose = step(0, shaken).mul(step(letGo, u.fallClock));
  const landsAt = center.y.sub(LITTER_Y).max(0).div(DESCENT);
  const age = u.fallClock.sub(letGo).max(0).min(landsAt);

  /*
   * The leaf leaves from where it was drawn and settles where still air would
   * have put it — `settle` carries it from the swaying pivot to the fixed
   * anchor, and from the fluttering blade to the rest blade, over the first
   * half second. Without that first half a leaf detaches with a jerk on a windy
   * preset; without the second, a leaf lying on the ground goes on flapping in
   * time with a tree it is no longer attached to.
   */
  const settle = smoothstep(0, 0.5, age);
  const anchor = mix(pivot, center, settle);
  const blade = mix(hanging.sub(pivot), positionLocal.sub(center).mul(radial), settle);

  const wind = vec3(u.windDir.x, 0, u.windDir.y).normalize();
  // Side to side across the line of fall, which is what a falling leaf does;
  // drifting only downwind gives a shower of darts.
  const across = vec3(wind.z, 0, wind.x.negate());
  const swing = sin(age.mul(2.3).add(seed.mul(37.0))).mul(0.38);
  const drift = wind.mul(u.wind.mul(0.9).add(0.25)).mul(age.mul(0.55));
  const descent = vec3(0, age.mul(DESCENT), 0);

  const spinAxis = vec3(seed.mul(19.0).sin(), 0.28, seed.mul(5.0).cos()).normalize();
  const tumbled = rotateAboutAxis(blade, spinAxis, age.mul(seed.mul(2.1).add(1.5)));

  // Flattened onto the ground over the last third of a second. Squashing the
  // blade's own vertical extent lays it down whatever angle it was tumbling
  // through, which a rotation to horizontal could not do without knowing that
  // angle.
  const landed = smoothstep(landsAt.sub(0.3), landsAt, age);
  const lying = vec3(tumbled.x, tumbled.y.mul(mix(float(1), float(0.08), landed)), tumbled.z);

  const fallen = anchor.sub(descent).add(across.mul(swing)).add(drift).add(lying);
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
      const node = fallArray as unknown as { value: Float32Array | null; update(): void };
      if (node.value === null) return false;
      node.update();
      return true;
    },
  };
}
