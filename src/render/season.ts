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
export type Weather = 'clear' | 'rain' | 'snow';

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
  /** What it is doing when you arrive in this season. You can change it. */
  weather: Weather;
  /** Fraction of the meadow still in flower, and carrying butterflies. */
  meadowBloom: number;
  /** The pond: frozen over, 0–1; how many lily pads; how many of them in flower. */
  pondIce: number;
  lilyPads: number;
  lilyFlowers: number;
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
    weather: 'clear',
    meadowBloom: 1,
    pondIce: 0,
    lilyPads: 0.75,
    lilyFlowers: 0.4,
    wind: 1,
    sunElevation: 26,
    sunIntensity: 5,
    skyLight: 1.1,
    haze: 0.2,
    grassDeep: 0x2d4a19,
    grassMid: 0x5f7d22,
    grassDry: 0x9db052,
    dirt: 0x6d5539,
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
    weather: 'clear',
    meadowBloom: 1,
    pondIce: 0,
    lilyPads: 1,
    lilyFlowers: 1,
    wind: 1,
    sunElevation: 17,
    sunIntensity: 5,
    skyLight: 1,
    haze: 0.26,
    grassDeep: 0x33481d,
    grassMid: 0x5d7128,
    grassDry: 0x9a9a4a,
    dirt: 0x6d5539,
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
    weather: 'clear',
    meadowBloom: 0.3,
    pondIce: 0,
    lilyPads: 0.6,
    lilyFlowers: 0,
    wind: 1.25,
    sunElevation: 11,
    sunIntensity: 4.6,
    skyLight: 0.92,
    haze: 0.36,
    grassDeep: 0x414a1d,
    grassMid: 0x7a6a28,
    grassDry: 0xb09243,
    dirt: 0x6a4f31,
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
    weather: 'snow',
    meadowBloom: 0,
    pondIce: 1,
    lilyPads: 0,
    lilyFlowers: 0,
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
  },
];

export function getSeason(id: Season): SeasonLook {
  return SEASONS.find((s) => s.id === id) ?? SEASONS[1];
}

/** Snow and winter light are faintly blue; autumn's is not. */
export function snowTintFor(id: Season): Color {
  return new Color(id === 'winter' ? 0xe9eef7 : 0xeef1f6);
}

/**
 * Weather, on top of a season.
 *
 * Rain is mostly not the rain. It is the sky closing over, the light losing its
 * direction and its colour, the distance pulling in, and every surface going
 * dark and glossy — the streaks are the least of it, and rain drawn into a
 * golden-hour scene reads as a broken sprinkler. So a weather is mostly a
 * change to the sky, and `overcast` is a real control of its own: a cloudy day
 * without rain is just as good a choice.
 */
export interface WeatherLook {
  id: Weather;
  name: string;
  blurb: string;
  /** Cloud cover, 0–1. Dims and greys the sun as well as the sky. */
  overcast: number;
  /** Added to the season's haze: falling water is aerosol too. */
  haze: number;
  /** Multiplies the season's sky light. */
  skyLight: number;
  /** Multiplies the species' windiness. */
  wind: number;
}

export const WEATHERS: readonly WeatherLook[] = [
  { id: 'clear', name: 'Clear', blurb: '', overcast: 0, haze: 0, skyLight: 1, wind: 1 },
  {
    id: 'rain',
    name: 'Rain',
    blurb: 'A closed grey sky, soaked bark and splashes in the grass',
    overcast: 0.92,
    haze: 0.22,
    skyLight: 0.9,
    wind: 1.25,
  },
  {
    id: 'snow',
    name: 'Snow',
    blurb: 'Flakes in the air; the cover itself is the Snow slider',
    overcast: 0.45,
    haze: 0.08,
    skyLight: 1,
    wind: 1,
  },
];

export function getWeather(id: Weather): WeatherLook {
  return WEATHERS.find((w) => w.id === id) ?? WEATHERS[0];
}
