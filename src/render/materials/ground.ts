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
  fog,
  mix,
  normalWorld,
  positionWorld,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { createNoiseTexture } from '../noiseTexture';

export type GroundUniforms = ReturnType<typeof createGroundMaterial>['uniforms'];

/**
 * Scene-wide aerial perspective, for `scene.fogNode`.
 *
 * This has to be a fog node rather than something each material folds into its
 * own colour: fog nodes are applied to the *shaded output*, and haze mixed into
 * an albedo gets multiplied by the lighting afterwards — so the hazier a
 * surface is meant to be, the brighter it renders. A distant treeline done that
 * way glows white against the hills it is standing on.
 *
 * Distance is measured from the tree rather than from the camera, so the
 * horizon stays put while the camera orbits.
 */
export function aerialPerspective(u: GroundUniforms) {
  const outward = positionWorld.xz.length();
  // Beer-Lambert extinction: fast over the first couple of hundred units, then
  // flattening, which is what stacks distant ridges into distinct planes rather
  // than one grey wall. It never reaches 1 — a ridge that matches the sky
  // exactly has no silhouette left to read.
  const depth = float(1).sub(outward.div(u.fadeDistance).negate().exp());
  // Short wavelengths scatter hardest, so what survives the distance shifts
  // blue. Doing only the wash and not the shift is what makes procedural
  // mountains look like cardboard.
  const color = mix(u.horizon, u.aerialFar, depth.mul(0.75));
  return fog(color, depth.mul(0.92));
}

/** Baked once and shared: every terrain material samples the same fields. */
let noiseMap: ReturnType<typeof createNoiseTexture> | null = null;

export function createGroundMaterial() {
  const noise = (noiseMap ??= createNoiseTexture(256, 20250811));

  const uniforms = {
    grassDeep: uniform(new Color(0x33481d)),
    grassMid: uniform(new Color(0x5d7128)),
    grassDry: uniform(new Color(0x9a9a4a)),
    dirt: uniform(new Color(0x6d5539)),
    rock: uniform(new Color(0x6b665c)),
    snow: uniform(new Color(0xf0e6dc)),
    horizon: uniform(new Color(0xd8b183)),
    /** Where distance scatters toward, past the warm horizon band. */
    aerialFar: uniform(new Color(0x93a4c4)),
    /**
     * Extinction distance. Aerial perspective follows Beer-Lambert, so the
     * fade is exponential rather than a ramp between two distances: it climbs
     * fast over the first couple of hundred units and then flattens, which is
     * what stacks the ridges into distinct planes instead of one grey wall.
     */
    fadeDistance: uniform(230),
    /**
     * Peaks start whitening here and are fully covered by `snowEnd`. This has
     * to sit well above the foothills: a snow line low enough to catch them
     * puts white patches on green hills a few hundred metres out, which reads
     * as a shader bug rather than as weather.
     */
    snowStart: uniform(104),
    snowEnd: uniform(168),
  };

  const material = new MeshStandardNodeMaterial();

  const p = positionWorld;
  const camDist = cameraPosition.sub(p).length();

  // Detail is only worth evaluating where it can actually be resolved.
  const nearness = smoothstep(70, 8, camDist);

  // Noise comes out of a baked, mipmapped texture rather than from per-pixel
  // fbm. This material covers most of the frame, and profiling put its fractal
  // noise at the bulk of a 12ms draw; three filtered fetches replace roughly a
  // dozen octaves. Mipmaps also mean the detail averages itself away at
  // distance instead of shimmering, which no amount of procedural noise does.
  //
  // Sampling is planar on world XZ. That smears on a cliff face, so the steep
  // parts of the range take a second sample projected down the vertical instead
  // — the two-plane half of triplanar, which is all a surface with no
  // overhangs actually needs.
  const flatUv = p.xz;
  const sideUv = vec2(p.x.add(p.z).mul(0.7071), p.y);
  const sample = (scale: number, offset: number) => {
    const flat = texture(noise, flatUv.mul(scale).add(offset));
    const side = texture(noise, sideUv.mul(scale).add(offset));
    return mix(flat, side, steepness);
  };

  // 0 on the flat, 1 on a cliff face. Needed before sampling, to pick the
  // projection.
  const slope = normalWorld.y.clamp(0, 1).oneMinus();
  const steepness = smoothstep(0.35, 0.8, slope);

  // Two scales per field, at incommensurate ratios, so the tile does not read
  // as a grid across a 600-unit world.
  const macroA = sample(0.0061, 0);
  const macroB = sample(0.0139, 0.37);
  const patchTex = sample(0.052, 0.11);
  const detailTex = sample(0.85, 0.63);

  const region = macroA.r.mul(0.62).add(macroB.a.mul(0.38));
  const patch = patchTex.g.mul(0.7).add(macroB.b.mul(0.3));
  const detail = detailTex.r;

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

  const bedrock = mix(soil, uniforms.rock, rockMask);

  // Snow line. Height alone puts snow on vertical cliff faces where it would
  // never settle, so it is gated on slope as well, and the line itself is
  // pushed around by the macro noise so it is not a perfect contour.
  const altitude = smoothstep(uniforms.snowStart, uniforms.snowEnd, p.y.add(region.sub(0.5).mul(26)));
  const snowMask = altitude.mul(smoothstep(0.62, 0.24, slope));
  const surface = mix(bedrock, uniforms.snow, snowMask);

  // Macro variation: a very low frequency tint, warm on the highs and cool in
  // the hollows, so no two parts of the field read as the same green. Driven off
  // the region field rather than its own lookup — the terrain shader covers the
  // whole screen, so a noise call here is one of the most expensive things in
  // the frame.
  const tint = mix(vec3(0.86, 0.92, 1.02), vec3(1.14, 1.06, 0.86), region);
  const shade = region.sub(0.5).mul(0.26).add(1);

  // Surface normal. The mesh is smooth, so without this the ground is a sheet
  // of flat-shaded polygons no matter how good the albedo is. `_vec3` noise
  // gives three decorrelated channels for the price of one lookup, which is
  // enough of a gradient field to read as a rough surface.
  //
  // Amplitude has to stay small. A unit normal tilted by even 0.3 swings ~17°,
  // and at golden hour the sun is grazing enough that a 17° tilt flips a pixel
  // between lit and unlit — which reads as dirt speckle, not as grass.
  //
  // One lookup, not two: the frequency is interpolated with distance instead,
  // so near ground gets fine grain and distant slopes get broad relief out of
  // the same call. Two lookups at fixed frequencies cost twice as much and look
  // no better, because only one of them is ever visible at a given depth.
  // Two channels of the detail sample stand in for a gradient. It is not the
  // true derivative of anything, but a decorrelated random field is exactly
  // what a rough surface's normal map is.
  const bumpAmount = mix(float(0.13), float(0.2), nearness);
  const bump = vec3(detailTex.g.sub(0.5), 0, detailTex.b.sub(0.5)).mul(bumpAmount).mul(2);
  material.normalNode = normalWorld.add(bump).normalize();

  // Aerial perspective. Distance is measured from the tree, not the camera, so
  // the horizon stays put while the camera orbits.
  //
  // Two things happen with distance, and only doing the first is what makes
  // procedural mountains look like cardboard: light is scattered *out* of the
  // view, washing the surface toward the sky, and short wavelengths scatter
  // hardest, so what remains shifts blue. The mix never reaches 1 — a range
  // that matches the sky exactly has no silhouette left to read.
  // Aerial perspective is not applied here. It belongs after lighting — mixing
  // haze into the albedo and then lighting the result makes distant geometry
  // *brighter* the hazier it gets, which is how a treeline ends up glowing.
  // `scene.fogNode` runs on the shaded output instead. See `aerialPerspective`.
  material.colorNode = surface.mul(shade).mul(tint);
  // Dry grass and bare soil catch a little more light than lush growth does.
  material.roughnessNode = float(0.97)
    .sub(dryness.mul(0.12))
    .sub(detail.mul(0.06).mul(nearness))
    .add(rockMask.mul(0.02))
    .sub(snowMask.mul(0.2));
  material.metalnessNode = float(0);

  return { material, uniforms };
}
