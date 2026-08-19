import { DEFAULT_PRESET_ID, getPreset, PRESETS } from '../engine';
import type { Quality, StudioParams } from '../render/studio';

export interface AppParams extends StudioParams {
  /** Seconds-ish rate for the growth animation. */
  growthSpeed: number;
  /** Replay the growth animation whenever the tree is rebuilt. */
  autoGrow: boolean;
}

export const presets = PRESETS;

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export function paramsFromPreset(id: string): AppParams {
  const preset = getPreset(id);
  const p = preset.params;
  return {
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
    leafDensity: 1,

    flowerDensity: p.flowerDensity ?? 0,
    flowerSize: p.flowerSize ?? 1,
    flowerColor: hex(preset.palette.flowerColor ?? 0xf6d9e8),
    flowerCore: hex(preset.palette.flowerCore ?? 0xf2c455),
    fruitDensity: p.fruitDensity ?? 0,
    fruitSize: p.fruitSize ?? 0.65,
    fruitShape: (p.fruitShape ?? 0) as 0 | 1,
    fruitColor: hex(preset.palette.fruitColor ?? 0xb8231f),
    fruitRipeness: 0.9,
    fruitBlush: 0.18,
    fruitWax: 0.1,
    fruitGloss: 0.45,

    barkDetail: 0.55,
    moss: 0.4,
    autumn: 0,
    translucency: 1,

    wind: 0.35 * p.windiness,
    windSpeed: 1,
    windDirection: 35,
    sunElevation: 17,
    sunAzimuth: 140,
    sunIntensity: 5,
    skyLight: 1,
    haze: 0.26,
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

export function applyPreset(id: string): void {
  Object.assign(params, paramsFromPreset(id));
}
