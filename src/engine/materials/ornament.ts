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
import { cameraPosition, float, mix, normalWorld, positionWorld, smoothstep, step, uv, vec2, vec3 } from 'three/tsl';
import { attribute } from 'three/tsl';
import { growthPosition, rotateAboutAxis, treeParams, vec3Attribute, type TreeUniforms } from './shared';

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

  const hanging = growthPosition(u, {
    thickenBase: 0.2,
    flutter: true,
    // Fruit ripens later than it sets, so size still eases in with growth.
    radial: u.fruitSize.mul(vary.mul(0.36).add(0.82)).mul(keep),
  });

  /*
   * Knocked loose.
   *
   * `aFall` holds the moment this piece of fruit came off, stamped by the host
   * when the pointer touched it, or -1 while it is still on the tree. That has
   * to be per-fruit state on the CPU: a shader cannot remember that something
   * was hit, and computing "falls while touched" statelessly would yo-yo the
   * fruit back onto the branch the moment the cursor moved away.
   *
   * The clock is `fallClock`, advanced by the host on the same `dt` it renders
   * with, rather than TSL's `time` — the CPU writes a number this subtracts
   * from, so the two must be the same clock or every fruit jumps as it detaches.
   *
   * Flight is clamped at the landing time rather than the position. Clamping
   * `y` would flatten the fruit onto the ground plane as each vertex hit it,
   * and freezing the spin by a height test would snap it back upright; capping
   * the *elapsed time* freezes fall and tumble together, still and intact.
   */
  const fall = attribute<'float'>('aFall', 'float');
  const loose = step(0, fall);
  const anchor = vec3Attribute('aCenter');

  const GRAVITY = 4.6;
  const REST = 0.06;
  // Stop when the *tip* reaches the ground. Clamping the anchor there instead
  // plants the whole cone underground, since the body hangs below it — which is
  // exactly what the first version did: they fell, and vanished.
  const restY = float(REST).add(u.fruitHang.mul(u.fruitSize));
  const drop = anchor.y.sub(restY).max(0);
  const landsAt = drop.div(GRAVITY).max(0).sqrt();
  const age = u.fallClock.sub(fall).max(0).min(landsAt);

  const spin = age.mul(vary.mul(3.0).add(2.2));
  const axis = vec3(vary.mul(19.0).sin(), 0.35, vary.mul(11.0).cos()).normalize();
  const tumbled = anchor.add(rotateAboutAxis(hanging.sub(anchor), axis, spin));
  // A cone does not drop plumb — it drifts as it goes.
  const drift = vec3(vary.mul(23.0).sin(), 0, vary.mul(29.0).cos()).mul(age.mul(0.22));
  const fallen = tumbled.add(drift).sub(vec3(0, age.mul(age).mul(GRAVITY), 0));

  material.positionNode = mix(hanging, fallen, loose);

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
  const plain = mix(mix(ripe, u.fruitUnripe, green), mix(ripe, u.fruitSun, 0.6), sunward.mul(u.fruitBlush));

  /*
   * Apple skin, which is the difference between an apple and a cherry.
   *
   * With the silhouette right and the colour finally red, the fruit read as
   * cherries — because a cherry *is* a uniform, saturated, glossy red ball, and
   * that is exactly what a single skin colour paints. What makes an apple
   * recognisable close up is that its red is never uniform:
   *
   *   Ground colour   a yellow-green the red only partly covers, strongest
   *                   around the calyx and on the shaded side.
   *   Striping        the red runs in irregular stripes from stem to calyx
   *                   rather than washing on evenly.
   *   Lenticels       pale freckles scattered over the skin. Small, but they
   *                   are the single most apple-specific marking there is.
   *
   * All three are driven by `fruitMarkings`, which the rebuild sets from the
   * fruit shape, so berries keep their plain skin.
   */
  // Stripes run stem-to-calyx but wander as they go; perfectly meridional ones
  // read as a melon.
  const around = st.x
    .mul(Math.PI * 2)
    .add(vary.mul(6.283))
    .add(st.y.mul(2.6).add(vary.mul(11.0)).sin().mul(0.4));
  // Integer harmonics, so the stripes meet themselves cleanly at the UV seam —
  // and high ones. Broad, low-frequency bands do not read as apple striping at
  // all; nine of them around a fruit reads as the ribbing on a pumpkin, which
  // is exactly what the first attempt produced.
  const stripe = around
    .mul(17)
    .sin()
    .mul(0.45)
    .add(around.mul(31).sin().mul(0.3))
    .add(around.mul(53).sin().mul(0.25))
    .mul(0.5)
    .add(0.5);

  // Red is the base and the ground colour shows *through* it, not the other way
  // round: strongest toward the calyx and on the shaded side, and never more
  // than partial, with the stripes making the boundary ragged.
  const bare = smoothstep(
    0.5,
    1.0,
    st.y.oneMinus().mul(0.45).add(sunward.oneMinus().mul(0.3)).add(stripe.mul(0.5)),
  );
  const striped = mix(plain, u.fruitGround, bare.mul(0.62));

  // Lenticels: one freckle per cell of a coarse grid, jittered and thinned out
  // so they do not read as a regular dot pattern.
  const cell = vec2(st.x.mul(30), st.y.mul(19));
  const id = cell.floor();
  const rand = (a: number, b: number) => id.dot(vec2(a, b)).sin().mul(43758.5453).fract();
  const speck = smoothstep(
    0.17,
    0.05,
    cell.fract().sub(vec2(rand(127.1, 311.7).mul(0.6).add(0.2), rand(269.5, 183.3).mul(0.6).add(0.2))).length(),
  ).mul(step(0.42, rand(419.2, 371.9)));
  const freckled = mix(striped, striped.mul(0.5).add(vec3(0.26, 0.22, 0.13)), speck.mul(0.8));

  const skin = mix(plain, freckled, u.fruitMarkings);

  /*
   * A pine cone is not fruit skin. None of the ripening machinery applies — no
   * green underside, no sunward blush, no waxy bloom — so it takes the chosen
   * colour flat, and its scales are shaded rather than modelled: only enough of
   * them are cut into the geometry to break the silhouette, because a cone is a
   * handful of pixels at any sane distance. The spiral matches the one the
   * template uses so the shading sits in the geometry's own grooves.
   */
  const shingle = st.y.mul(9).add(st.x.mul(5)).fract();
  // Dark in the notch under each scale, catching light along its lower lip.
  const scale = smoothstep(0.0, 0.22, shingle).mul(smoothstep(1.0, 0.62, shingle));
  const woodyCone = u.fruitColor
    .mul(vary.mul(0.2).add(0.72))
    .mul(scale.mul(0.75).add(0.3))
    .mul(smoothstep(0.0, 0.35, st.y).mul(0.35).add(0.65));
  const body = mix(skin, woodyCone, u.fruitCone);

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
    mix(body.mul(shade.oneMinus()), vec3(0.13, 0.09, 0.05), calyx.mul(0.8).mul(u.fruitCone.oneMinus())),
    vec3(0.17, 0.115, 0.062),
    woody,
  );
  material.colorNode = mix(
    dressed,
    vec3(0.58, 0.56, 0.52),
    grazing.mul(u.fruitWax).mul(0.45).mul(woody.oneMinus()).mul(u.fruitCone.oneMinus()),
  );

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
    // Dry, fibrous, and not remotely glossy.
    .add(u.fruitCone.mul(0.45))
    .clamp(0.05, 1);
  material.metalnessNode = float(0);

  return material;
}
