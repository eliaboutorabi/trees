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
 *   Height blending    layers meet along a noise "height" contour instead of a
 *                      linear fade, so grass creeps into dirt in fingers rather
 *                      than dissolving into it. This one trick is most of the
 *                      difference between hand-painted and photographed ground.
 *   Distance resampling  fine detail and normal perturbation fade out with
 *                      camera distance so they neither alias nor disappear.
 *   Macro variation    a very low frequency tint over the whole terrain. This
 *                      is the single biggest realism lever: without it, ground
 *                      reads as one flat colour no matter how much fine noise
 *                      is piled on top.
 *
 * The mesh itself is smooth, so all of the surface texture people read as
 * "grass" comes from the perturbed normal, not from geometry.
 */
import { Color } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  cameraPosition,
  float,
  mix,
  mx_fractal_noise_float,
  mx_fractal_noise_vec3,
  normalWorld,
  positionWorld,
  smoothstep,
  uniform,
  vec3,
} from 'three/tsl';

export type GroundUniforms = ReturnType<typeof createGroundMaterial>['uniforms'];

export function createGroundMaterial() {
  const uniforms = {
    grassDeep: uniform(new Color(0x33481d)),
    grassMid: uniform(new Color(0x5d7128)),
    grassDry: uniform(new Color(0x9a9a4a)),
    dirt: uniform(new Color(0x6d5539)),
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
  const nearness = smoothstep(70, 8, camDist);

  // Full 3D noise coordinates — this is what makes the projection triplanar
  // without any of the usual three-axis blending work.
  const noise = (scale: number, octaves: number) =>
    mx_fractal_noise_float(p.mul(scale), octaves, 2.0, 0.55, 1.0).mul(0.5).add(0.5);

  // Domain warp. Sampling the macro field at a position that has itself been
  // pushed around by a lower frequency makes patch boundaries meander instead
  // of following the noise lattice, which is what stops large-scale procedural
  // terrain from reading as a grid.
  const warp = mx_fractal_noise_vec3(p.mul(0.011), 2, 2.0, 0.5, 1.0).mul(9);
  const region = mx_fractal_noise_float(p.add(warp).mul(0.0135), 4, 2.0, 0.55, 1.0).mul(0.5).add(0.5);

  const patch = noise(0.052, 3);
  const detail = noise(0.85, 2);

  // 0 on the flat, 1 on a cliff face.
  const slope = normalWorld.y.clamp(0, 1).oneMinus();

  // Ragged thresholds: a clean smoothstep on slope alone gives contour banding.
  const rockMask = smoothstep(0.24, 0.52, slope.add(region.sub(0.5).mul(0.4)));

  // Grass runs deep-to-mid on the patch noise, then bleaches toward dry where
  // the macro region is high — sun-baked ridges rather than random speckle.
  const lush = mix(uniforms.grassDeep, uniforms.grassMid, patch.mul(0.75).add(detail.mul(0.25)));
  const dryness = smoothstep(0.54, 0.86, region.add(patch.sub(0.5).mul(0.25)));
  const grass = mix(lush, uniforms.grassDry, dryness);

  // Bare earth only where the ground is both dry and worn.
  //
  // Height blending, rather than `mix`. A linear fade puts a soft even gradient
  // between two materials, which is the thing that makes procedural ground look
  // sprayed on. Weighting each layer by its own surface height and keeping only
  // what lies within `depth` of the taller one lets the noise decide the
  // boundary, so grass advances into soil in fingers and islands the way it
  // actually does.
  const bare = smoothstep(0.72, 0.95, region.mul(0.6).add(patch.mul(0.4)));
  const grassHeight = detail.add(bare.oneMinus());
  const dirtHeight = patch.oneMinus().add(bare);
  const peak = grassHeight.max(dirtHeight).sub(0.22);
  const kGrass = grassHeight.sub(peak).max(0);
  const kDirt = dirtHeight.sub(peak).max(0);
  const soil = grass.mul(kGrass).add(uniforms.dirt.mul(kDirt)).div(kGrass.add(kDirt).max(0.0001));

  const surface = mix(soil, uniforms.rock, rockMask);

  // Macro variation: a very low frequency tint, warm on the highs and cool in
  // the hollows, so no two parts of the field read as the same green.
  const drift = noise(0.0072, 2);
  const tint = mix(vec3(0.86, 0.92, 1.02), vec3(1.14, 1.06, 0.86), drift);
  const shade = region.sub(0.5).mul(0.26).add(1);

  // Surface normal. The mesh is smooth, so without this the ground is a sheet
  // of flat-shaded polygons no matter how good the albedo is. `_vec3` noise
  // gives three decorrelated channels for the price of one lookup, which is
  // enough of a gradient field to read as a rough surface.
  //
  // Amplitude has to stay small. A unit normal tilted by even 0.3 swings ~17°,
  // and at golden hour the sun is grazing enough that a 17° tilt flips a pixel
  // between lit and unlit — which reads as dirt speckle, not as grass.
  const bumpNear = mx_fractal_noise_vec3(p.mul(0.75), 2, 2.0, 0.5, 1.0);
  const bumpFar = mx_fractal_noise_vec3(p.mul(0.1), 2, 2.0, 0.5, 1.0);
  const bump = bumpNear.mul(nearness.mul(0.16)).add(bumpFar.mul(0.1));
  material.normalNode = normalWorld.add(vec3(bump.x, 0, bump.z)).normalize();

  // Aerial perspective. Distance is measured from the tree, not the camera, so
  // the horizon stays put while the camera orbits.
  const outward = p.xz.length();
  const haze = smoothstep(uniforms.fadeStart, uniforms.fadeEnd, outward);

  material.colorNode = mix(surface.mul(shade).mul(tint), uniforms.horizon, haze);
  // Dry grass and bare soil catch a little more light than lush growth does.
  material.roughnessNode = float(0.97)
    .sub(dryness.mul(0.12))
    .sub(detail.mul(0.06).mul(nearness))
    .add(rockMask.mul(0.02));
  material.metalnessNode = float(0);

  return { material, uniforms };
}
