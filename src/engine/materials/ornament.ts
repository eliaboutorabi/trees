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
import { DoubleSide, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
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

export function createFruitMaterial(u: TreeUniforms): MeshPhysicalNodeMaterial {
  // Physical rather than standard for one reason: `specularIntensityNode`.
  // See the note on gloss below — it is the control that actually fixes this.
  const material = new MeshPhysicalNodeMaterial();

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

  // No piece of fruit is one flat colour — the shaded underside stays green
  // longer than the crown, and the cheek that gets the most sun turns first.
  // But every one of those shifts used to be a hard-coded constant, and between
  // them they pulled a pure red so far toward olive and orange that the colour
  // picker barely mattered. They are now sliders, and at Ripeness 1 the fruit
  // is exactly the colour that was chosen.
  //
  // The base multiplier is deliberately dark. AgX compresses chroma as
  // luminance rises, so a saturated red lit to near-white desaturates and
  // renders *pink*. Sitting the skin lower on the tone curve is what keeps it
  // red — brightening it is the one thing that cannot help.
  const tonal = vary.mul(0.24).add(0.74);
  const belly = smoothstep(0.8, 0.1, st.y);
  const sunward = normalWorld.dot(u.sunDir).clamp(0, 1).pow(0.7);
  const ripe = u.fruitColor.mul(tonal);

  // Unripeness gathers on the underside and on whatever faces away from the sun.
  const green = belly.mul(0.7).add(sunward.oneMinus().mul(0.3)).clamp(0, 1).mul(u.fruitRipeness.oneMinus());
  const skin = mix(mix(ripe, u.fruitUnripe, green), mix(ripe, u.fruitSun, 0.6), sunward.mul(u.fruitBlush));

  const shade = occlusion.mul(u.occlusionStrength).mul(0.5);

  // Bloom — the waxy dust on a plum or a fresh apple. It is what stops fruit
  // reading as painted plastic: a pale, view-dependent haze strongest at
  // glancing angles, sitting on top of the skin rather than tinting it. Pale
  // enough that it was a quiet third contributor to the washing-out, so it gets
  // a control too.
  const view = cameraPosition.sub(positionWorld).normalize();
  const grazing = float(1).sub(view.dot(normalWorld).clamp(0, 1)).pow(5.0);
  material.colorNode = mix(skin.mul(shade.oneMinus()), vec3(0.58, 0.56, 0.52), grazing.mul(u.fruitWax).mul(0.45));

  /*
   * Gloss controls how much sky the skin mirrors, not just how sharply.
   *
   * This is what was actually washing the fruit out, and it took bisecting the
   * shader to find: with `scene.environmentIntensity` set to zero the fruit
   * renders deep red, and with it restored the same fruit goes pale lavender.
   * The culprit cannot be the diffuse half of image-based lighting — that term
   * is multiplied by the albedo, so a (0.75, 0, 0) skin can only ever come back
   * red. It was the specular half: a smooth sphere reflects the *entire* sky,
   * and Fresnel takes reflectance to 1 at the rim, which on a berry a dozen
   * pixels across is most of what you see.
   *
   * Roughness alone cannot fix that. Lowering it sharpens the reflection but
   * does not shrink it — the sphere still faces every part of the sky. What
   * does fix it is `specularIntensity`, which scales F0 *and* F90, so it
   * genuinely dims the rim. Fruit skin is a thin waxy cuticle over water, so
   * reflecting less than a polished dielectric is also the honest answer.
   */
  material.specularIntensityNode = mix(float(0.12), float(0.85), u.fruitGloss);
  material.roughnessNode = mix(float(0.68), float(0.13), u.fruitGloss).add(belly.mul(0.08));
  material.metalnessNode = float(0);

  return material;
}
