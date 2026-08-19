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

/**
 * Gloss, as the scalar `specularIntensity` the renderer actually reads.
 *
 * Well under a polished dielectric's 1.0 even at the top of the slider: the
 * environment here is an unobstructed sky, and a fruit hanging inside a canopy
 * does not see one.
 */
export function fruitSpecularFor(gloss: number): number {
  return 0.05 + Math.min(1, Math.max(0, gloss)) * 0.4;
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
  // The stalk and the blossom end. The stalk rides in the same mesh as the
  // fruit, tagged with a UV outside [0, 1] rather than given a material of its
  // own — a dozen triangles do not justify a second draw call. The calyx is
  // just the dark scar at the bottom, which is `st.y` near zero for both fruit
  // shapes, so berries get a blossom end out of it too.
  const woody = step(1.05, st.y);
  const calyx = smoothstep(0.05, 0.0, st.y).mul(woody.oneMinus());
  const dressed = mix(
    mix(skin.mul(shade.oneMinus()), vec3(0.13, 0.09, 0.05), calyx.mul(0.8)),
    vec3(0.17, 0.115, 0.062),
    woody,
  );
  material.colorNode = mix(dressed, vec3(0.58, 0.56, 0.52), grazing.mul(u.fruitWax).mul(0.45).mul(woody.oneMinus()));

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
  /*
   * Why the specular has to be kept on a short leash — and why the obvious way
   * to do it does nothing.
   *
   * A saturated red skin has *near-zero* green and blue. Measured on one apple
   * masked out of the frame: with image-based lighting switched off it renders
   * rgb(47, 4, 2), a deep red, and with it back on the same fruit is
   * rgb(116, 47, 37). The sky's reflection is nearly achromatic, so it is
   * invisible against the red channel and decisive against the other two.
   * Saturation is destroyed by the channels that are dark, not the bright one.
   *
   * F90 is the culprit rather than F0. A dielectric reflects ~4% head-on and
   * ~100% at grazing, and on a sphere the grazing rim is most of what faces the
   * camera. A photograph of a real apple survives that because the apple is
   * reflecting dark leaves; ours reflects a smooth, uniformly bright sky over
   * its whole upper hemisphere, because that is all the environment map holds.
   *
   * `specularIntensity` scales F0 *and* F90, so it is the right lever — but it
   * has to be set as a plain material property. `material.specularIntensityNode`
   * exists on MeshPhysicalNodeMaterial and is never read by anything in three:
   * `setupSpecular` reads `materialSpecularIntensity`, which is a
   * `materialReference` to the scalar. Assigning the node silently does nothing,
   * exactly like `bumpMap()` on a procedural height field. `Tree.applyLook`
   * drives the scalar from the gloss slider instead.
   */
  material.specularIntensity = fruitSpecularFor(0.45);
  material.roughnessNode = mix(float(0.68), float(0.13), u.fruitGloss)
    .add(belly.mul(0.08))
    .add(woody.mul(0.5))
    .clamp(0.05, 1);
  material.metalnessNode = float(0);

  return material;
}
