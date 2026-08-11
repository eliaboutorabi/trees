/**
 * Flowers and fruit.
 *
 * Both hang off the same attachment points as the leaves, and both are baked at
 * full density and then culled on the GPU: an ornament whose rank sits above
 * the density uniform collapses to a point. That is what lets the density,
 * size and colour sliders all take effect without re-deriving the grammar.
 *
 * The rank doubles as the per-ornament random seed — hashing it gives colour
 * and size variation for free, which matters because a crown of identically
 * coloured berries reads as plastic.
 */
import { DoubleSide, MeshStandardNodeMaterial } from 'three/webgpu';
import { cameraPosition, float, mix, normalWorld, positionWorld, smoothstep, step, uv } from 'three/tsl';
import { growthPosition, treeParams, type TreeUniforms } from './shared';

export function createFlowerMaterial(u: TreeUniforms): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.side = DoubleSide;

  const st = uv();
  const { seed: rank, occlusion } = treeParams();
  const keep = step(rank, u.flowerDensity);
  const vary = rank.mul(97.31).fract();

  material.positionNode = growthPosition(u, {
    thickenBase: 0.4,
    flutter: true,
    radial: u.flowerSize.mul(vary.mul(0.3).add(0.85)).mul(keep),
  });

  // Petals pale toward the tip and the throat carries the stamens' colour.
  const throat = smoothstep(0.42, 0.02, st.y);
  const petal = u.flowerColor.mul(vary.mul(0.18).add(0.91));
  const base = mix(petal, u.flowerCore, throat);

  const shade = occlusion.mul(u.occlusionStrength).mul(0.55);
  material.colorNode = base.mul(shade.oneMinus());
  material.roughnessNode = float(0.72).sub(throat.mul(0.15));
  material.metalnessNode = float(0);

  // Petals are thinner than leaves, so they light up harder from behind.
  const view = cameraPosition.sub(positionWorld).normalize();
  const backLit = u.sunDir.negate().dot(normalWorld).clamp(0, 1);
  const looksIntoSun = view.dot(u.sunDir.negate()).clamp(0, 1).pow(3.0);
  const scatter = backLit
    .mul(float(0.4).add(looksIntoSun.mul(0.6)))
    .mul(occlusion.oneMinus())
    .mul(st.y.mul(0.5).add(0.5));
  material.emissiveNode = base.mul(u.sunColor).mul(scatter).mul(u.translucency).mul(1.4);

  return material;
}

export function createFruitMaterial(u: TreeUniforms): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();

  const st = uv();
  const { seed: rank, occlusion } = treeParams();
  const keep = step(rank, u.fruitDensity);
  const vary = rank.mul(131.7).fract();

  material.positionNode = growthPosition(u, {
    thickenBase: 0.2,
    flutter: true,
    // Fruit ripens later than it sets, so size still eases in with growth.
    radial: u.fruitSize.mul(vary.mul(0.36).add(0.82)).mul(keep),
  });

  // Ripeness varies fruit to fruit, and the sunward side of any one fruit
  // colours first — the top of a berry is redder than its shaded underside.
  const ripeness = vary.mul(0.4).add(0.8);
  const belly = smoothstep(0.75, 0.05, st.y);
  const skin = u.fruitColor.mul(ripeness).mul(belly.mul(0.35).oneMinus());

  const shade = occlusion.mul(u.occlusionStrength).mul(0.5);
  material.colorNode = skin.mul(shade.oneMinus());
  // A polished skin is what makes fruit catch the sun and pick itself out of
  // the canopy; a matte one disappears into the leaves.
  material.roughnessNode = float(0.62).sub(u.fruitGloss.mul(0.45));
  material.metalnessNode = float(0);

  return material;
}
