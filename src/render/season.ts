/**
 * The four seasons, as a table of everything each one changes.
 *
 * A season is not a dimmer on a summer scene. Light, ground, foliage, weather
 * and wildlife all move together, and they move in ways that are not a single
 * axis: a winter sun is low *and* weak *and* the sky it fills the shadows with
 * is brighter than its beam, because the light is coming off cloud and snow
 * rather than through clear air. Autumn is the opposite — a strong, very low,
 * very warm beam through thick air. Interpolating between a "summer" and a
 * "winter" number would give neither.
 *
 * So each season is written out in full, and picking one writes its values into
 * the same parameters the sliders drive. Every one of them stays editable
 * afterwards: a season is a starting point, exactly as a species preset is.
 */
import { Color } from 'three';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface SeasonLook {
  id: Season;
  name: string;
  blurb: string;

  // -------------------------------------------------------------- foliage
  /** How far the leaves have turned, 0–1. */
  autumn: number;
  /** Fraction of leaves kept, on a broadleaf. */
  leafDensity: number;
  /** Fraction kept on a conifer, which does not drop its needles. */
  needleDensity: number;
  /** Multiplies the species' own blossom; spring puts flowers on a bare tree. */
  blossom: number;
  /** Floor on blossom density, for species that carry none by default. */
  blossomFloor: number;
  /** Whether shaking the tree sheds leaves. */
  leafFall: number;
  /** Backlit glow through the blade. Thin autumn leaves pass more light. */
  translucency: number;
  /**
   * How far the leaves still on the tree have gone past turning, to dead. A
   * turned leaf is scarlet; a leaf that has hung on through December is brown,
   * and a handful of scarlet ones on a bare winter tree read as berries.
   */
  leafDry: number;

  // -------------------------------------------------------------- weather
  /** Settled snow on branches, grass and ground. */
  snow: number;
  /** Flakes in the air. */
  snowfall: number;
  /** Fraction of the meadow still in flower, and carrying butterflies. */
  meadowBloom: number;
  /** Multiplies the species' own windiness. */
  wind: number;

  // ------------------------------------------------------------------ sky
  sunElevation: number;
  sunIntensity: number;
  skyLight: number;
  haze: number;

  // --------------------------------------------------------------- ground
  grassDeep: number;
  grassMid: number;
  grassDry: number;
  dirt: number;
  /** The warm band the distance fades through, and where it ends up. */
  horizon: number;
  aerialFar: number;
}

export const SEASONS: readonly SeasonLook[] = [
  {
    id: 'spring',
    name: 'Spring',
    blurb: 'New leaf, blossom, a high clear sun',
    autumn: 0,
    leafDensity: 0.82,
    needleDensity: 1,
    blossom: 1,
    blossomFloor: 0.3,
    leafFall: 0,
    translucency: 1.25,
    leafDry: 0,
    snow: 0,
    snowfall: 0,
    meadowBloom: 1,
    wind: 1,
    sunElevation: 26,
    sunIntensity: 5,
    skyLight: 1.1,
    haze: 0.2,
    grassDeep: 0x2d4a19,
    grassMid: 0x5f7d22,
    grassDry: 0x9db052,
    dirt: 0x6d5539,
    horizon: 0xd3bc94,
    aerialFar: 0x93a4c4,
  },
  {
    id: 'summer',
    name: 'Summer',
    blurb: 'Full canopy, low golden light',
    autumn: 0,
    leafDensity: 1,
    needleDensity: 1,
    blossom: 1,
    blossomFloor: 0,
    leafFall: 0,
    translucency: 1,
    leafDry: 0,
    snow: 0,
    snowfall: 0,
    meadowBloom: 1,
    wind: 1,
    sunElevation: 17,
    sunIntensity: 5,
    skyLight: 1,
    haze: 0.26,
    grassDeep: 0x33481d,
    grassMid: 0x5d7128,
    grassDry: 0x9a9a4a,
    dirt: 0x6d5539,
    horizon: 0xd8b183,
    aerialFar: 0x93a4c4,
  },
  {
    id: 'autumn',
    name: 'Autumn',
    blurb: 'Turned and ready to drop — brush the canopy',
    autumn: 1,
    leafDensity: 0.88,
    needleDensity: 1,
    blossom: 0,
    blossomFloor: 0,
    leafFall: 1,
    translucency: 1.35,
    leafDry: 0.12,
    snow: 0,
    snowfall: 0,
    meadowBloom: 0.3,
    wind: 1.25,
    sunElevation: 11,
    sunIntensity: 4.6,
    skyLight: 0.92,
    haze: 0.36,
    grassDeep: 0x414a1d,
    grassMid: 0x7a6a28,
    grassDry: 0xb09243,
    dirt: 0x6a4f31,
    horizon: 0xd3a071,
    aerialFar: 0x9aa6bd,
  },
  {
    id: 'winter',
    name: 'Winter',
    blurb: 'Bare, snowbound, and still snowing',
    autumn: 1,
    leafDensity: 0.04,
    needleDensity: 0.92,
    blossom: 0,
    blossomFloor: 0,
    leafFall: 0,
    translucency: 0.55,
    leafDry: 0.8,
    snow: 1,
    snowfall: 1,
    meadowBloom: 0,
    wind: 1.15,
    /*
     * Winter has to read *cold*, and the first attempt at it did not: a sun at
     * 8° through heavy haze came out the colour of a desert sunset, because the
     * sun's colour here is not picked, it follows from how much atmosphere the
     * light crosses — and at 8° that is 38 atmospheres of red.
     *
     * So the beam is weak but no longer horizontal, the air is clear rather
     * than thick, and most of the light in the scene comes from a sky turned up
     * past any other season's. That is also what is actually happening on a
     * snowy afternoon: the ground and the cloud base are doing the lighting,
     * and the sun is barely contributing.
     */
    sunElevation: 15,
    sunIntensity: 4.2,
    skyLight: 1.15,
    haze: 0.24,
    grassDeep: 0x4b5046,
    grassMid: 0x6e7265,
    grassDry: 0x939586,
    dirt: 0x5a5047,
    horizon: 0xc2cad6,
    aerialFar: 0xb3c0d6,
  },
];

export function getSeason(id: Season): SeasonLook {
  return SEASONS.find((s) => s.id === id) ?? SEASONS[1];
}

/** Snow and winter light are faintly blue; autumn's is not. */
export function snowTintFor(id: Season): Color {
  return new Color(id === 'winter' ? 0xe9eef7 : 0xeef1f6);
}
