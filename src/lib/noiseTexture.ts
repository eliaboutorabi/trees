/**
 * A tileable, multi-channel fbm texture.
 *
 * Evaluating fractal noise per pixel is the honest way to shade procedural
 * terrain and also the wrong one here: the ground covers essentially the whole
 * frame, and profiling put its material at 12ms of a 32ms frame with the noise
 * as the bulk of it. Baking the same fields into a texture once and sampling
 * them costs three filtered fetches instead of a dozen-odd octaves.
 *
 * Mipmapping is the second, less obvious win. Procedural noise has no
 * derivatives the hardware can use, so it aliases into shimmer as soon as its
 * features fall below a pixel; a mipmapped texture averages itself down for
 * free and simply goes smooth at distance instead.
 *
 * The cost is tiling. Every channel repeats at the world scale it is sampled
 * at, so callers are expected to mix two samples at incommensurate scales —
 * which is enough to break the grid in practice, and is the same trick texture
 * bombing uses.
 */
import { DataTexture, LinearMipmapLinearFilter, LinearFilter, RGBAFormat, RepeatWrapping } from 'three';

/**
 * Value noise on a lattice that wraps every `period` cells, which is what makes
 * the result tileable. A plain hash would produce a seam at the texture edge.
 */
function periodicHash(x: number, y: number, period: number, seed: number): number {
  const xi = ((x % period) + period) % period;
  const yi = ((y % period) + period) % period;
  let h = Math.imul(xi | 0, 374761393) ^ Math.imul(yi | 0, 668265263) ^ Math.imul(seed | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function periodicValueNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = periodicHash(xi, yi, period, seed);
  const b = periodicHash(xi + 1, yi, period, seed);
  const c = periodicHash(xi, yi + 1, period, seed);
  const d = periodicHash(xi + 1, yi + 1, period, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Octaves double in frequency, so the wrap period has to double with them. */
function periodicFbm(x: number, y: number, base: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = base;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += periodicValueNoise(x * freq, y * freq, freq, seed + i * 1013) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export interface NoiseChannel {
  /** Cells across the texture at the first octave. */
  base: number;
  octaves: number;
}

const DEFAULT_CHANNELS: [NoiseChannel, NoiseChannel, NoiseChannel, NoiseChannel] = [
  { base: 3, octaves: 5 },
  { base: 6, octaves: 4 },
  { base: 12, octaves: 3 },
  { base: 2, octaves: 4 },
];

/**
 * Four decorrelated fbm fields packed into one RGBA texture, so a single fetch
 * returns four usable values.
 */
export function createNoiseTexture(size = 256, seed = 1, channels = DEFAULT_CHANNELS): DataTexture {
  const data = new Uint8Array(size * size * 4);

  for (let c = 0; c < 4; c++) {
    const { base, octaves } = channels[c];
    const channelSeed = seed + c * 7919;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = periodicFbm(x / size, y / size, base, octaves, channelSeed);
        data[(y * size + x) * 4 + c] = Math.max(0, Math.min(255, Math.round(n * 255)));
      }
    }
  }

  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
