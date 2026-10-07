import { DEFAULT_PRESET_ID, getPreset, PRESETS } from '../engine';
import { getSeason, type Season } from '../render/season';
import type { Quality, StudioParams } from '../render/studio';

export interface AppParams extends StudioParams {
  /** Seconds-ish rate for the growth animation. */
  growthSpeed: number;
  /** Replay the growth animation whenever the tree is rebuilt. */
  autoGrow: boolean;
}

export const presets = PRESETS;

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export function paramsFromPreset(id: string, season: Season = 'summer'): AppParams {
  const preset = getPreset(id);
  const p = preset.params;
  const s = getSeason(season);
  // A conifer keeps its needles through the winter; everything else does not.
  const evergreen = p.leafShape === 1;
  const blossom = p.flowerDensity ?? 0;
  return {
    season,
    presetId: preset.id,

    axiom: preset.axiom,
    rules: preset.rules,
    iterations: p.iterations,
    angle: p.angle,
    step: p.step,
    shrink: p.shrink,
    trunkRadius: p.trunkRadius,
    tropism: p.tropism,
    pipeExponent: p.pipeExponent,
    seed: 1337,

    leafScale: p.leafScale,
    leafShape: p.leafShape,
    leafDensity: evergreen ? s.needleDensity : s.leafDensity,

    // Spring puts blossom on a species that carries none by default; autumn and
    // winter take it off one that does.
    flowerDensity: evergreen ? blossom * s.blossom : Math.max(blossom * s.blossom, s.blossomFloor),
    flowerSize: p.flowerSize ?? 1,
    flowerColor: hex(preset.palette.flowerColor ?? 0xf6d9e8),
    flowerCore: hex(preset.palette.flowerCore ?? 0xf2c455),
    fruitDensity: p.fruitDensity ?? 0,
    fruitSize: p.fruitSize ?? 0.65,
    fruitShape: (p.fruitShape ?? 0) as 0 | 1 | 2,
    fruitColor: hex(preset.palette.fruitColor ?? 0xb8231f),
    fruitRipeness: 0.9,
    fruitBlush: 0.18,
    fruitWax: 0.1,
    fruitGloss: 0.32,

    barkDetail: 0.55,
    moss: 0.4,
    autumn: s.autumn,
    translucency: s.translucency,
    snow: s.snow,
    leafFall: s.leafFall,

    wind: 0.35 * p.windiness * s.wind,
    windSpeed: 1,
    windDirection: 35,
    sunElevation: s.sunElevation,
    sunAzimuth: 140,
    sunIntensity: s.sunIntensity,
    skyLight: s.skyLight,
    haze: s.haze,
    exposure: 1,

    bloom: 0.5,
    depthOfField: true,
    grain: true,
    antialias: true,
    autoRotate: false,
    quality: 'auto' as Quality,

    growthSpeed: 0.3,
    autoGrow: true,
  };
}

export const params: AppParams = $state(paramsFromPreset(DEFAULT_PRESET_ID));

/** Structural fields — changing any of these means re-deriving the grammar. */
export const STRUCTURAL_KEYS = [
  'axiom',
  'rules',
  'iterations',
  'angle',
  'step',
  'shrink',
  'trunkRadius',
  'tropism',
  'pipeExponent',
  'seed',
  'leafScale',
  'leafShape',
  'leafDensity',
  'fruitShape',
  'barkDetail',
] as const satisfies readonly (keyof AppParams)[];

export function applyPreset(id: string, season: Season = params.season): void {
  Object.assign(params, paramsFromPreset(id, season));
}

/**
 * Switch season without losing the species.
 *
 * Everything a season touches is rewritten from the preset rather than nudged
 * from where it is, so Spring → Winter → Spring lands back exactly on Spring.
 * The price is that hand-tuned foliage and sky settings are lost when the
 * season changes — which is the same bargain picking a species already makes,
 * and the alternative is a scene that drifts a little further from every season
 * each time you cycle through them.
 */
export function applySeason(season: Season): void {
  Object.assign(params, paramsFromPreset(params.presetId, season));
}
