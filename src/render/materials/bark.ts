/** Procedural bark — furrows, ridges, moss and young-twig blending, no textures. */
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { bumpMap, float, mix, mx_fractal_noise_float, positionGeometry, smoothstep, uv, vec3 } from 'three/tsl';
import { floatAttribute, growthPosition, vec3Attribute, type TreeUniforms } from './shared';

export function createBarkMaterial(u: TreeUniforms): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.positionNode = growthPosition(u, { thickenBase: 0.34, windScale: 1 });

  const st = uv();
  const center = vec3Attribute('aCenter');
  const seed = floatAttribute('aSeed');

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
  const grain = mx_fractal_noise_float(p.mul(6.0), 3, 2.0, 0.5, 1.0).mul(0.5).add(0.5);
  const height = crevice.oneMinus().mul(0.72).add(grain.mul(0.28)).clamp(0, 1);

  // Thin twigs are smooth and greenish rather than furrowed.
  const twigness = smoothstep(0.052, 0.012, radius);

  const wood = mix(u.barkDark, u.barkLight, height.pow(1.25));
  const withTwig = mix(wood, u.barkTwig, twigness);

  // Moss creeps up from the base, and only into the crevices.
  const mossMask = smoothstep(2.4, 0.15, positionGeometry.y)
    .mul(height.oneMinus().pow(1.5))
    .mul(u.mossAmount)
    .mul(twigness.oneMinus())
    .clamp(0, 1);

  material.colorNode = mix(withTwig, u.barkMoss, mossMask);
  material.roughnessNode = float(0.98).sub(height.mul(0.22)).sub(twigness.mul(0.18));
  material.metalnessNode = float(0);
  // The slider is 0–1; bark needs a good deal more relief than that to read.
  material.normalNode = bumpMap(height, u.barkBump.mul(2.6).mul(twigness.oneMinus().mul(0.85).add(0.15)));

  return material;
}
