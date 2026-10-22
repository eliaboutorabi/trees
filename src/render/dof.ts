/**
 * Depth of field that holds still.
 *
 * three's bokeh depth of field gathers 64 taps per pixel, at a quarter of the
 * resolution, straight from the full-resolution frame — and then dilates the
 * result, keeping the *brightest* of 16 neighbours. Both are fine for a big
 * soft background. They are not fine for a meadow: a white flower a pixel or
 * two across is caught by a tap in one frame and missed in the next as the
 * camera moves, and when it is caught, the dilation blows it up into a bright
 * blob. Every out-of-focus flower twinkled on and off, which was exactly the
 * part of the picture that looked broken.
 *
 * This one gives up the bokeh disc for stability:
 *
 * - The frame is blurred down a small pyramid — half resolution, then a
 *   quarter — with separable Gaussians. At half resolution each output texel
 *   centre falls between four source pixels, so a bilinear tap averages all
 *   of them: every pixel is counted, nothing is skipped, and a small bright
 *   thing contributes its true, small share in every frame.
 * - Each field is blurred with its own weights (premultiplied), so the sharp
 *   tree is left out of the background's blur — no halo of smeared trunk
 *   round the silhouette — and a near, out-of-focus stalk spreads its blur
 *   outward over what is behind it, as a lens does.
 * - The composite chooses between sharp, a little blurred and very blurred by
 *   each pixel's circle of confusion, all sampled from smooth textures.
 */
import { convertToTexture, max, mix, select, smoothstep, vec4 } from 'three/tsl';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
// TSL nodes are proxied at runtime and their published typings do not follow
// a chain like this one through `select` and swizzles; loosely typed here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/**
 * @param color   the frame, linear HDR
 * @param viewZ   view-space depth of the frame (negative in front of the camera)
 * @param focus   distance to the focal plane
 * @param range   how far either side of it things go fully out of focus
 * @param amount  0 for none, 1 for the full effect
 */
export function stableDepthOfField(color: N, viewZ: N, focus: N, range: N, amount: N): N {
  const signed = viewZ.negate().sub(focus);
  const coc = smoothstep(0, range, signed.abs()).mul(amount) as N;
  const far = select(signed.greaterThan(0), coc, 0) as N;
  const near = select(signed.lessThan(0), coc, 0) as N;

  // A floor on the weights keeps every texel defined where nothing in a
  // neighbourhood belongs to the field; the composite never uses those.
  const floor = 0.002;
  const farIn = convertToTexture(vec4(color.rgb, max(far, floor)));
  const nearIn = convertToTexture(vec4(color.rgb, max(near, floor)));

  const opts = (scale: number) => ({ premultipliedAlpha: true, resolutionScale: scale });
  const far1 = gaussianBlur(farIn, null, 2, opts(0.5));
  const far2 = gaussianBlur(far1.getTextureNode(), null, 3, opts(0.5));
  const near1 = gaussianBlur(nearIn, null, 2, opts(0.5));
  const near2 = gaussianBlur(near1.getTextureNode(), null, 3, opts(0.5));

  const f1 = far1.getTextureNode() as N;
  const f2 = far2.getTextureNode() as N;
  const n1 = near1.getTextureNode() as N;
  const n2 = near2.getTextureNode() as N;

  // Behind the focal plane: sharp → a little → a lot, by this pixel's CoC.
  const farBlur = mix(f1.rgb, f2.rgb, smoothstep(0.3, 1, far));
  let out = mix(color.rgb, farBlur, smoothstep(0, 0.3, far)) as N;

  // In front of it: by the *spread* near weight as well, so a blurred stalk
  // in the foreground softens over the edge of what is behind it.
  const spread = n2.a as N;
  const nearBlur = mix(n1.rgb, n2.rgb, smoothstep(0.3, 1, max(near, spread)));
  out = mix(out, nearBlur, smoothstep(0.02, 0.3, max(near, spread))) as N;

  return vec4(out, 1) as N;
}
