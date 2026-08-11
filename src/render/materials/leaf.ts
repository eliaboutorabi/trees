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
  const st = uv();
  const { seed: rawSeed, occlusion } = treeParams();
  const isBlossom = step(1.5, rawSeed);
  const seed = rawSeed.fract();

  // Thinning happens on the GPU: a leaf whose hash falls above the density
  // threshold collapses to a point. The hash is decorrelated from `seed` so
  // thinning does not also bias the colour and flutter variation.
  const keep = step(rawSeed.mul(97.31).fract(), u.leafCull);
  material.positionNode = growthPosition(u, {
    thickenBase: 0.5,
    flutter: true,
    radial: u.leafSize.mul(keep),
  });

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

  // Leaf margins are thinner and often paler or scorched, and the eye reads a
  // slightly lighter rim as a physical edge rather than as a cut-out.
  const margin = smoothstep(0.36, 0.5, offCentre).add(smoothstep(0.86, 1.0, st.y)).clamp(0, 1);
  const edged = mix(withVeins, withVeins.mul(1.18).add(0.01), margin.mul(0.55));

  // The inside of a canopy sees almost no sky. Without this the whole crown
  // reads as one flat green mass however many leaves it has.
  // Occlusion is baked at full density, so thinning the canopy has to lighten
  // it too or a sparse crown stays as dark as a full one.
  const shade = occlusion.mul(u.occlusionStrength).mul(u.leafCull.mul(0.7).add(0.3));
  material.colorNode = edged.mul(shade.mul(0.78).oneMinus());
  // Leaves are waxy, but not uniformly so — a cuticle varies leaf to leaf and
  // dulls in shade. One roughness for the whole canopy is most of what makes
  // foliage read as moulded plastic.
  material.roughnessNode = float(0.46)
    .add(seed.mul(0.22))
    .sub(veins.mul(0.08))
    .add(shade.mul(0.34))
    .add(margin.mul(0.12));
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
