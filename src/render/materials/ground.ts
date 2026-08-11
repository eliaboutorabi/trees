/**
 * Terrain surface shading.
 *
 * Built on the standard terrain-shader vocabulary — splatting, triplanar
 * projection, distance resampling, macro variation — but all of it procedural,
 * since there is not a texture in this project.
 *
 *   Splatting          grass, dirt and rock chosen by slope and macro noise,
 *                      with a noise-perturbed threshold so the seams between
 *                      them are ragged rather than a clean contour line.
 *   Triplanar          comes free here. Texture-based terrain needs triplanar
 *                      projection because a top-down UV smears on cliffs; 3D
 *                      noise evaluated at the world position simply has no
 *                      projection to smear.
 *   Distance resampling  fine detail is faded out with camera distance so it
 *                      neither aliases in the distance nor disappears up close.
 *   Macro variation    a very low frequency tint over the whole terrain. This
 *                      is the single biggest realism lever: without it, ground
 *                      reads as one flat colour no matter how much fine noise
 *                      is piled on top.
 */
import { Color } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  cameraPosition,
  float,
  mix,
  mx_fractal_noise_float,
  normalWorld,
  positionWorld,
  smoothstep,
  uniform,
} from 'three/tsl';

export type GroundUniforms = ReturnType<typeof createGroundMaterial>['uniforms'];

export function createGroundMaterial() {
  const uniforms = {
    grassDeep: uniform(new Color(0x2c4a1c)),
    grassDry: uniform(new Color(0x7e8b3c)),
    dirt: uniform(new Color(0x6b5636)),
    rock: uniform(new Color(0x6b665c)),
    horizon: uniform(new Color(0xd8b183)),
    /** Where aerial perspective starts and finishes taking over. */
    fadeStart: uniform(65),
    fadeEnd: uniform(150),
  };

  const material = new MeshStandardNodeMaterial();

  const p = positionWorld;
  const camDist = cameraPosition.sub(p).length();

  // Detail is only worth evaluating where it can actually be resolved.
  const nearness = smoothstep(60, 6, camDist);

  // Full 3D noise coordinates — this is what makes the projection triplanar
  // without any of the usual three-axis blending work.
  const macro = mx_fractal_noise_float(p.mul(0.019), 3, 2.0, 0.55, 1.0).mul(0.5).add(0.5);
  const detail = mx_fractal_noise_float(p.mul(0.55), 2, 2.0, 0.5, 1.0).mul(0.5).add(0.5);

  // 0 on the flat, 1 on a cliff face.
  const slope = normalWorld.y.clamp(0, 1).oneMinus();

  // Ragged thresholds: a clean smoothstep on slope alone gives contour banding.
  const rockMask = smoothstep(0.22, 0.5, slope.add(macro.sub(0.5).mul(0.35)));
  const dryMask = smoothstep(0.66, 0.88, macro).mul(rockMask.oneMinus());

  // Grass tone varies with both macro patches and fine detail.
  const grassTone = macro.mul(0.65).add(detail.mul(0.35).mul(nearness.mul(0.6).add(0.4)));
  const grass = mix(uniforms.grassDeep, uniforms.grassDry, grassTone);

  const withDry = mix(grass, uniforms.dirt, dryMask);
  const surface = mix(withDry, uniforms.rock, rockMask);

  // Very low frequency brightness drift, so no two patches read identically.
  const shade = macro.sub(0.5).mul(0.22).add(1);

  // Aerial perspective. Distance is measured from the tree, not the camera, so
  // the horizon stays put while the camera orbits.
  const outward = p.xz.length();
  const haze = smoothstep(uniforms.fadeStart, uniforms.fadeEnd, outward);

  material.colorNode = mix(surface.mul(shade), uniforms.horizon, haze);
  material.roughnessNode = float(0.96).sub(detail.mul(0.08)).add(rockMask.mul(0.02));
  material.metalnessNode = float(0);

  return { material, uniforms };
}
