/** Procedural bark — furrows, ridges, moss and young-twig blending, no textures. */
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { float, mix, mx_fractal_noise_float, positionGeometry, smoothstep, uv, vec3 } from 'three/tsl';
import { growthPosition, proceduralBump, treeParams, vec3Attribute, type TreeUniforms } from './shared';

export function createBarkMaterial(u: TreeUniforms): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.positionNode = growthPosition(u, { thickenBase: 0.34, flutter: false, radial: u.radiusScale });

  const st = uv();
  const center = vec3Attribute('aCenter');
  const { seed, occlusion } = treeParams();

  // Distance from the strand axis: the resting radius of this vertex.
  const radius = positionGeometry.sub(center).length();

  // Seamless cylindrical unwrap — going around uv.x must not create a seam in
  // the noise, so the angle is fed in as a circle rather than a linear ramp.
  const angle = st.x.mul(Math.PI * 2);
  const ringScale = radius.mul(u.barkScale).max(0.28);
  const p = vec3(angle.cos().mul(ringScale), angle.sin().mul(ringScale), st.y.mul(1.35).add(seed.mul(11.3)));

  // Furrows are the *zero crossings* of the noise widened into bands, which
  // gives dark channels separated by broad ridges — closer to real bark than
  // plain ridged noise, which comes out mostly light with thin dark streaks.
  const n = mx_fractal_noise_float(p, 5, 2.1, 0.5, 1.0);
  const crevice = smoothstep(0.62, 0.06, n.abs());

  // Cross-cracks. Bark does not just run in stripes: the ridges break into
  // plates, and it is the horizontal fracture between plates that stops a trunk
  // from reading as a bundle of extruded rods.
  const crossNoise = mx_fractal_noise_float(vec3(p.x.mul(0.35), p.y.mul(0.35), p.z.mul(2.6)), 3, 2.0, 0.5, 1.0);
  const crossCrack = smoothstep(0.5, 0.08, crossNoise.abs()).mul(crevice.oneMinus().mul(0.7).add(0.3));

  // Fine grain, kept low-frequency enough not to alias into sparkle once the
  // normal map amplifies it.
  const grain = mx_fractal_noise_float(p.mul(3.4), 2, 2.0, 0.5, 1.0).mul(0.5).add(0.5);
  const height = crevice
    .max(crossCrack.mul(0.85))
    .oneMinus()
    .mul(0.72)
    .add(grain.mul(0.28))
    .clamp(0, 1);

  // Thin twigs are smooth and greenish rather than furrowed.
  const twigness = smoothstep(0.052, 0.012, radius);

  const wood = mix(u.barkDark, u.barkLight, height.pow(0.85));
  const withTwig = mix(wood, u.barkTwig, twigness);

  // Moss creeps up from the base, and only into the crevices.
  const mossMask = smoothstep(2.4, 0.15, positionGeometry.y)
    .mul(height.oneMinus().pow(1.5))
    .mul(u.mossAmount)
    .mul(twigness.oneMinus())
    .clamp(0, 1);

  // Birch lenticels: dark dashes stretched around the trunk, not along it.
  const lenticel = mx_fractal_noise_float(vec3(angle.mul(ringScale.mul(0.35)), st.y.mul(26.0), 4.7), 2, 2.0, 0.5, 1.0)
    .abs()
    .oneMinus()
    .pow(6.0)
    .mul(u.lenticels)
    .mul(twigness.oneMinus())
    .clamp(0, 1);

  const withMoss = mix(withTwig, u.barkMoss, mossMask);
  const withLenticels = mix(withMoss, u.barkDark, lenticel);

  // Cavity occlusion. This, not the normal map, is what makes bark read as
  // deep: a furrow is dark because it can only see a sliver of sky, and no
  // amount of normal perturbation substitutes for that. A bump map alone gives
  // a trunk that looks embossed on a flat surface — which is exactly how this
  // material read before.
  //
  // It belongs on the *ambient* term, which is what `aoNode` is for — a furrow
  // is dark because it cannot see the sky, not because its pigment differs.
  // Multiplying it into the albedo as well double-counts it and takes the whole
  // trunk to near-black.
  const cavity = height.pow(0.75).mul(0.68).add(0.32);
  material.aoNode = cavity;

  // Branches buried inside the canopy sit in ambient shade.
  const canopyShade = occlusion.mul(u.occlusionStrength).mul(u.leafCull.mul(0.7).add(0.3)).mul(0.55);
  // A light touch on the albedo too: weathered ridges bleach, sheltered
  // crevices hold their colour and their damp.
  material.colorNode = withLenticels.mul(mix(float(0.78), float(1.06), height)).mul(canopyShade.oneMinus());

  // Ridges are worn smooth by weather and handling; the crevices they shelter
  // stay rough. A single roughness over the whole surface is a large part of
  // why untextured bark looks like moulded plastic.
  material.roughnessNode = float(1.0)
    .sub(height.mul(0.3))
    .sub(twigness.mul(0.2))
    .sub(mossMask.mul(0.05))
    .clamp(0.35, 1);
  material.metalnessNode = float(0);
  // The slider is 0–1; a screen-space height gradient is a small number, so it
  // takes a large multiplier before furrows read as depth rather than as a
  // faint sheen. Twigs keep a little relief but nowhere near a mature trunk's.
  material.normalNode = proceduralBump(height, u.barkBump.mul(22).mul(twigness.oneMinus().mul(0.88).add(0.12)));

  return material;
}
