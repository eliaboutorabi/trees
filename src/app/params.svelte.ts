import { DEFAULT_PRESET_ID, getPreset, PRESETS } from '../lsystem';
import type { Quality, StudioParams } from '../render/studio';

export interface AppParams extends StudioParams {
  /** Seconds-ish rate for the growth animation. */
  growthSpeed: number;
  /** Replay the growth animation whenever the tree is rebuilt. */
  autoGrow: boolean;
}

export const presets = PRESETS;

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

    barkDetail: 0.55,
    moss: 0.4,
    autumn: 0,
    translucency: 1,

    wind: 0.35 * p.windiness,
    windSpeed: 1,
    windDirection: 35,
    sunElevation: 17,
    sunAzimuth: 140,
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
  'barkDetail',
] as const satisfies readonly (keyof AppParams)[];

export function applyPreset(id: string): void {
  Object.assign(params, paramsFromPreset(id));
}
