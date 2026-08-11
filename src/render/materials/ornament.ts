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
import { cameraPosition, float, mix, normalWorld, positionWorld, smoothstep, step, uv, vec3 } from 'three/tsl';
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

  // Ripeness varies fruit to fruit, and no piece of fruit is one flat colour:
  // the shaded underside stays green long after the crown of the fruit has
  // turned, and the side that gets the most sun turns first of all.
  // Deliberately dark. AgX compresses chroma as luminance rises, so a
  // saturated red lit to near-white desaturates and renders *pink* — which is
  // exactly what a plausible-looking 0.25 albedo did here. Sitting the skin
  // lower on the tone curve is what keeps it red.
  const ripeness = vary.mul(0.28).add(0.62);
  const belly = smoothstep(0.8, 0.1, st.y);
  const sunward = normalWorld.dot(u.sunDir).clamp(0, 1).pow(0.7);
  const ripe = u.fruitColor.mul(ripeness);
  const unripe = mix(ripe, u.fruitUnripe, belly.mul(0.72).add(sunward.oneMinus().mul(0.28)).clamp(0, 1));
  // The sunward cheek shifts toward orange rather than simply brightening,
  // for the same reason: extra luminance costs saturation.
  const skin = mix(unripe, mix(ripe, u.fruitSun, 0.55), sunward.mul(0.6));

  const shade = occlusion.mul(u.occlusionStrength).mul(0.5);

  // Bloom — the waxy dust on a plum or a fresh apple. It is what stops fruit
  // reading as painted plastic: a pale, view-dependent haze strongest at
  // glancing angles, sitting on top of the skin rather than tinting it.
  const view = cameraPosition.sub(positionWorld).normalize();
  const grazing = float(1).sub(view.dot(normalWorld).clamp(0, 1)).pow(5.0);
  material.colorNode = mix(skin.mul(shade.oneMinus()), vec3(0.55, 0.53, 0.5), grazing.mul(0.16));

  // Roughness that only ever gets so low. A near-mirror skin blows the specular
  // lobe out to white across half the sphere, which is exactly what made these
  // read as pink rather than red.
  material.roughnessNode = float(0.82)
    .sub(u.fruitGloss.mul(0.3))
    .add(belly.mul(0.1));
  material.metalnessNode = float(0);

  return material;
}
