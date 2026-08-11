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
import { floatAttribute, growthPosition, type TreeUniforms } from './shared';

export function createLeafMaterial(u: TreeUniforms): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.side = DoubleSide;
  material.positionNode = growthPosition(u, { thickenBase: 0.5, windScale: 1.6 });

  const st = uv();
  const rawSeed = floatAttribute('aSeed');
  const isBlossom = step(1.5, rawSeed);
  const seed = rawSeed.fract();

  // Veins: a bright midrib plus a fan of laterals.
  const offCentre = st.x.sub(0.5).abs();
  const midrib = smoothstep(0.06, 0.0, offCentre);
  const laterals = st.y.mul(13.0).add(offCentre.mul(10.0)).sin().abs().pow(7.0).mul(0.35);
  const veins = midrib.mul(0.7).add(laterals).clamp(0, 1);

  // Every leaf gets its own tint and its own moment of turning.
  const summer = mix(u.leafBase, u.leafTip, st.y.mul(0.55).add(seed.mul(0.45)));
  const turned = u.autumn.mul(1.5).sub(seed.mul(0.5)).clamp(0, 1);
  const foliage = mix(summer, u.leafAutumn.mul(seed.mul(0.4).add(0.8)), turned);
  const petal = u.blossom.mul(seed.mul(0.25).add(0.85));

  const base = mix(foliage, petal, isBlossom);
  const withVeins = mix(base, base.mul(1.3).add(0.015), veins);

  material.colorNode = withVeins;
  material.roughnessNode = float(0.62).sub(veins.mul(0.12));
  material.metalnessNode = float(0);

  // Subsurface: bright when the sun is behind the leaf, brightest when the
  // camera is also looking into the sun.
  const view = cameraPosition.sub(positionWorld).normalize();
  const backLit = u.sunDir.negate().dot(normalWorld).clamp(0, 1);
  const looksIntoSun = view.dot(u.sunDir.negate()).clamp(0, 1).pow(3.5);
  const thinness = st.y.mul(0.45).add(0.55);
  const scatter = backLit.mul(float(0.3).add(looksIntoSun.mul(0.7))).mul(thinness);

  material.emissiveNode = base.mul(u.sunColor).mul(scatter).mul(u.translucency).mul(1.6);

  return material;
}
