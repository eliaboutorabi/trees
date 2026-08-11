/**
 * Foliage — the material that carries most of the golden-hour look.
 *
 * The blade outline is baked into the geometry, so there is no alpha test.
 * What sells it instead is subsurface scattering: leaves between the camera
 * and a low sun glow from behind, which is what makes evening canopies read
 * as translucent rather than as flat green cards.
 */
import { DoubleSide, MeshStandardNodeMaterial } from 'three/webgpu';
import { cameraPosition, float, mix, normalWorld, positionWorld, smoothstep, step, uv } from 'three/tsl';
import { growthPosition, treeParams, type TreeUniforms } from './shared';

export function createLeafMaterial(u: TreeUniforms): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.side = DoubleSide;
  material.positionNode = growthPosition(u, { thickenBase: 0.5, flutter: true });

  const st = uv();
  const { seed: rawSeed, occlusion } = treeParams();
  const isBlossom = step(1.5, rawSeed);
  const seed = rawSeed.fract();

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
  const foliage = mix(summer, u.leafAutumn.mul(seed.mul(0.4).add(0.8)), turned);
  const petal = u.blossom.mul(seed.mul(0.25).add(0.85));

  const base = mix(foliage, petal, isBlossom);
  const withVeins = mix(base, base.mul(1.3).add(0.015), veins);

  // The inside of a canopy sees almost no sky. Without this the whole crown
  // reads as one flat green mass however many leaves it has.
  const shade = occlusion.mul(u.occlusionStrength);
  material.colorNode = withVeins.mul(shade.mul(0.78).oneMinus());
  // Leaves are waxy — a little sheen picks the outer canopy out against the sky.
  material.roughnessNode = float(0.52).sub(veins.mul(0.1)).add(shade.mul(0.3));
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

  material.emissiveNode = base.mul(u.sunColor).mul(scatter).mul(u.translucency).mul(1.7);

  return material;
}
