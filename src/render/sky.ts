/**
 * An analytic golden-hour sky, baked to an equirectangular half-float texture.
 *
 * It is used as both the background and the environment map, so the tree picks
 * up warm light from the sun side and cool bounce from the opposite sky — which
 * is most of what makes evening lighting look right.
 */
import {
  Color,
  DataTexture,
  DataUtils,
  EquirectangularReflectionMapping,
  HalfFloatType,
  LinearFilter,
  RGBAFormat,
  Vector3,
} from 'three';

export interface SkySettings {
  /** Degrees above the horizon. */
  elevation: number;
  /** Degrees, 0 = +Z. */
  azimuth: number;
  /** 0 clear, 1 thick haze. */
  haze: number;
  /** Overall sky brightness multiplier. */
  intensity: number;
}

const WIDTH = 1024;
const HEIGHT = 512;

// The environment map is baked separately, small and without the sun disc.
//
// A specular lobe at any real roughness integrates a wide cone of the
// environment, so a disc carrying 30x the radiance of the sky around it leaks
// into every rough reflection in the scene — enough that a black-albedo sphere
// still renders as a pale grey ball. The disc has to stay in the *background*
// for it to bloom, so background and environment cannot be the same texture.
const ENV_WIDTH = 256;
const ENV_HEIGHT = 128;

const ZENITH = new Color(0x1d3f77);
const HORIZON_WARM = new Color(0xffb367);
const HORIZON_COOL = new Color(0xa8bcd8);
const GROUND_HAZE = new Color(0x5a4a38);

const SUN_LOW = new Color(0xff9a52);
const SUN_HIGH = new Color(0xfff2e0);

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01(a === b ? 0 : (x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export function sunDirection(settings: SkySettings, out = new Vector3()): Vector3 {
  const e = (settings.elevation * Math.PI) / 180;
  const a = (settings.azimuth * Math.PI) / 180;
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)).normalize();
}

export function sunColorFor(settings: SkySettings, out = new Color()): Color {
  const t = smoothstep(0, 14, settings.elevation);
  return out.copy(SUN_LOW).lerp(SUN_HIGH, t);
}

function makeTexture(data: Uint16Array, width: number, height: number): DataTexture {
  const texture = new DataTexture(data, width, height, RGBAFormat, HalfFloatType);
  texture.mapping = EquirectangularReflectionMapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export class ProceduralSky {
  /** What the camera sees. Carries the sun disc, so it blooms. */
  readonly texture: DataTexture;
  /** What surfaces reflect. Same sky, no disc — see the note above. */
  readonly environment: DataTexture;
  private readonly data: Uint16Array;
  private readonly envData: Uint16Array;
  private readonly sun = new Vector3();
  private readonly sunTint = new Color();

  constructor() {
    this.data = new Uint16Array(WIDTH * HEIGHT * 4);
    this.envData = new Uint16Array(ENV_WIDTH * ENV_HEIGHT * 4);
    this.texture = makeTexture(this.data, WIDTH, HEIGHT);
    this.environment = makeTexture(this.envData, ENV_WIDTH, ENV_HEIGHT);
  }

  update(settings: SkySettings): void {
    sunDirection(settings, this.sun);
    sunColorFor(settings, this.sunTint);
    this.bake(this.data, WIDTH, HEIGHT, settings, true);
    this.bake(this.envData, ENV_WIDTH, ENV_HEIGHT, settings, false);
    this.texture.needsUpdate = true;
    this.environment.needsUpdate = true;
  }

  private bake(
    data: Uint16Array,
    width: number,
    height: number,
    settings: SkySettings,
    withDisc: boolean,
  ): void {

    const haze = clamp01(settings.haze);
    const intensity = settings.intensity;
    // The lower the sun, the warmer and deeper the band along the horizon.
    const lowness = 1 - smoothstep(0, 30, settings.elevation);
    const horizon = HORIZON_COOL.clone().lerp(HORIZON_WARM, 0.35 + 0.65 * lowness);
    const zenith = ZENITH.clone().lerp(horizon, 0.12 + 0.35 * haze);

    const sx = this.sun.x;
    const sy = this.sun.y;
    const sz = this.sun.z;

    let o = 0;
    for (let j = 0; j < height; j++) {
      const v = (j + 0.5) / height;
      const lat = (v - 0.5) * Math.PI;
      const y = Math.sin(lat);
      const cosLat = Math.cos(lat);

      for (let i = 0; i < width; i++) {
        const u = (i + 0.5) / width;
        const phi = (u - 0.5) * Math.PI * 2;
        // This has to invert exactly what three does when it samples an
        // equirect map: `u = atan2(dir.z, dir.x) / 2pi + 0.5`. Negating x here
        // — as this did — mirrors the whole sky about the X axis, so the
        // painted sun sits on the opposite side from the directional light that
        // was placed using the same azimuth. The shadows were right; the sky
        // was the lie.
        const x = Math.cos(phi) * cosLat;
        const z = Math.sin(phi) * cosLat;

        const up = clamp01(y);
        // Sky gradient, compressed near the horizon.
        const t = Math.pow(up, 0.42 + 0.3 * haze);
        let r = horizon.r + (zenith.r - horizon.r) * t;
        let g = horizon.g + (zenith.g - horizon.g) * t;
        let b = horizon.b + (zenith.b - horizon.b) * t;

        // Warm scatter around the sun, and a broad glow along its azimuth.
        const cosSun = clamp01(x * sx + y * sy + z * sz);
        const halo = Math.pow(cosSun, 16) * 0.5 + Math.pow(cosSun, 4) * 0.11;
        const band = Math.exp(-Math.abs(y) * (7 - 4 * haze)) * Math.pow(cosSun, 1.5) * 0.26;
        const nearSun = halo + band;
        r += this.sunTint.r * nearSun;
        g += this.sunTint.g * nearSun;
        b += this.sunTint.b * nearSun;

        // The disc itself, bright enough to bloom, dim enough to stay orange
        // instead of clipping white. Omitted from the environment bake.
        if (withDisc) {
          const disc = smoothstep(0.99978, 0.99995, cosSun) * (13 + 20 * (1 - haze));
          r += this.sunTint.r * disc;
          g += this.sunTint.g * disc;
          b += this.sunTint.b * disc;
        }

        // Haze band hugging the horizon line.
        const hug = Math.exp(-Math.abs(y) * 26) * (0.05 + 0.22 * haze);
        r += horizon.r * hug;
        g += horizon.g * hug;
        b += horizon.b * hug;

        if (y < 0) {
          // Below the horizon: dim toward a dusty ground bounce.
          const k = smoothstep(0, 0.35, -y);
          r += (GROUND_HAZE.r - r) * k * 0.9;
          g += (GROUND_HAZE.g - g) * k * 0.9;
          b += (GROUND_HAZE.b - b) * k * 0.9;
        }

        data[o++] = DataUtils.toHalfFloat(r * intensity);
        data[o++] = DataUtils.toHalfFloat(g * intensity);
        data[o++] = DataUtils.toHalfFloat(b * intensity);
        data[o++] = DataUtils.toHalfFloat(1);
      }
    }
  }

  dispose(): void {
    this.texture.dispose();
    this.environment.dispose();
  }
}
