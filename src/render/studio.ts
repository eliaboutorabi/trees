/**
 * The three.js side of the app: renderer, scene, lighting, and the bridge
 * between L-system parameters and what ends up on screen.
 */
import {
  Group,
  Color,
  DirectionalLight,
  HemisphereLight,
  Matrix4,
  MathUtils,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
} from 'three';
import { NeutralToneMapping, WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getPreset, Tree, type Palette, type TreeInfo, type TreeStructure } from '../engine';
import { createLandscape, DEFAULT_LANDSCAPE } from './landscape';
import { createMeadow } from './meadow';
import { createPostPipeline } from './post';
import { ProceduralSky, sunDirection, type SkySettings } from './sky';
import { getSeason, snowTintFor, type Season, type Weather } from './season';
import { createRainfall, createSnowfall } from './weather';
import { Flock } from './birds';
import { aerialPerspective } from './materials/ground';

/** Re-exported so the UI has one place to import parameter shapes from. */
export type StructureParams = TreeStructure;

/** Uniform-only changes — applied instantly, no rebuild. */
export interface LookParams {
  season: Season;
  weather: Weather;
  /** How hard it is raining or snowing, 0–1. */
  precipitation: number;
  wind: number;
  windSpeed: number;
  windDirection: number;
  autumn: number;
  translucency: number;
  /** Settled snow on branches, grass and ground, 0–1. */
  snow: number;
  /** Whether shaking the tree sheds leaves. Set by the season, not by hand. */
  leafFall: number;
  barkDetail: number;
  moss: number;
  /** Rescaled against the baked mesh rather than rebuilt. */
  trunkRadius: number;
  leafScale: number;
  /** Culled on the GPU rather than rebuilt. */
  leafDensity: number;
  flowerDensity: number;
  flowerSize: number;
  flowerColor: string;
  flowerCore: string;
  fruitDensity: number;
  fruitSize: number;
  fruitColor: string;
  fruitRipeness: number;
  fruitBlush: number;
  fruitWax: number;
  fruitGloss: number;
  exposure: number;
  /** How much colour the picture carries: 0 muted, 1 natural, 2 vivid. */
  colour: number;
  bloom: number;
  depthOfField: boolean;
  grain: boolean;
  antialias: boolean;
  autoRotate: boolean;
  /** 'auto' scales render resolution to hold the frame budget. */
  quality: Quality;
}

export type Quality = 'auto' | 'low' | 'medium' | 'high';

/** Upper bound on device pixel ratio for each fixed quality step. */
const QUALITY_SCALE: Record<Exclude<Quality, 'auto'>, number> = {
  low: 1,
  medium: 1.5,
  high: 2,
};

/**
 * Sun and atmosphere. Uniform writes and one small cube render — cheap enough
 * to drive straight from a slider without a debounce.
 */
export interface SkyParams {
  sunElevation: number;
  sunAzimuth: number;
  haze: number;
  /** Strength of the direct beam, before atmospheric extinction. */
  sunIntensity: number;
  /** Brightness of the sky itself, which is what fills the shadows. */
  skyLight: number;
  /** Cloud cover, 0–1. Dims and greys the sun along with the sky. */
  overcast: number;
}

export type StudioParams = StructureParams & LookParams & SkyParams & { presetId: string };

export interface StudioStats {
  modules: number;
  nodes: number;
  leaves: number;
  branchTriangles: number;
  vertices: number;
  buildMs: number;
  fps: number;
  truncated: boolean;
  /** Device pixel ratio currently being rendered at. */
  renderScale: number;
  /** True while adaptive scaling is driving `renderScale`. */
  adaptive: boolean;
}

const MAX_LEAVES = 26_000;
/** How fast the old tree grows back into the ground on a species change: about a second. */
const UNGROW_SPEED = 1.15;
/** Seconds for the camera to glide to a new tree's framing. */
const GLIDE_SECONDS = 2.2;
/** The grey the near and far distance go to under a closed sky. */
const OVERCAST_NEAR = new Color(0xa6acb2);
const OVERCAST_FAR = new Color(0x8f979f);
const MAX_ORNAMENTS = 1_800;
/** Exposure under Neutral tone mapping that matches the old default brightness. */
const NEUTRAL_LIFT = 1.18;
/** How fast Orbit circles, in OrbitControls' units. */
const ORBIT_SPEED = 0.35;
/** How close to the ground the camera may come. */
const CAMERA_FLOOR = 0.7;

// Scratch objects for the shadow fit, which runs whenever the sun moves.
const _v1 = new Vector3();
const _v2 = new Vector3();
const _m1 = new Matrix4();
const _v3 = new Vector3();
const _v4 = new Vector3();
const UP_AXIS = new Vector3(0, 1, 0);

export class TreeStudio {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(38, 1, 0.1, 1400);

  private renderer!: WebGPURenderer;
  private controls!: OrbitControls;
  private post!: ReturnType<typeof createPostPipeline>;

  /** The portable half of this app. Everything else here is scaffolding. */
  private readonly tree = new Tree({ maxLeaves: MAX_LEAVES, maxOrnaments: MAX_ORNAMENTS });
  private readonly sky = new ProceduralSky();
  private readonly sun = new DirectionalLight(0xffd7ab, 3.4);
  private readonly fill = new HemisphereLight(0xbdd4ff, 0x6b5836, 0.35);
  private readonly landscape = createLandscape(this.tree.uniforms);
  private readonly groundUniforms = this.landscape.uniforms;
  // Wildflowers, and butterflies that perch on the ones actually placed.
  private readonly meadow = createMeadow(this.tree.uniforms, DEFAULT_LANDSCAPE);
  private readonly snowfall = createSnowfall(this.tree.uniforms);
  private readonly rainfall = createRainfall(this.tree.uniforms);
  /** How wet everything should be heading for; `wetness` eases toward it. */
  private wetTarget = 0;
  private wetness = 0;
  /** The exposure slider, and the sun's strength, which exposure partly follows. */
  private userExposure = 1;
  private sunPower = 5;
  private fadingWarmed = false;
  private orbitTarget = 0;
  private lookShown = false;
  /** The rainbow fades in and out rather than switching. */
  private rainbowTarget = 0;
  private rainbow = 0;
  private readonly flock = new Flock(this.tree);

  private readonly sunDir = new Vector3();
  private readonly sunTint = new Color();

  /** Where the season's scene dressing is heading; see `easeSeason`. */
  private readonly seasonTarget = {
    leafDry: 0,
    meadowBloom: 1,
    snowfall: 0,
    rainfall: 0,
    snowColor: new Color(),
    grassDeep: new Color(),
    grassMid: new Color(),
    grassDry: new Color(),
    dirt: new Color(),
  };
  private seasonShown = false;
  private treeHeight = 8;
  private treeRadius = 3;
  private growth = 0;
  private growthTarget = 1;
  /** Bumped by every rebuild request, so a slow one cannot land on top of a newer one. */
  private buildToken = 0;
  /** Waiting for the growth to reach zero; see `ungrow`. */
  private ungrown: (() => void)[] = [];
  private cameraGlide: {
    fromTarget: Vector3;
    fromPosition: Vector3;
    target: Vector3;
    position: Vector3;
    t: number;
  } | null = null;
  private growthSpeed = 0.32;
  private lastTime = 0;
  private frameTimes: number[] = [];
  /** Last size handed to the renderer, so a no-op resize stays a no-op. */
  private viewWidth = 0;
  private viewHeight = 0;

  // Adaptive resolution. Profiling showed this scene is almost entirely
  // fill-rate bound — hiding every leaf, branch and shadow changes the frame
  // time not at all, while dropping pixel ratio takes it straight to vsync. So
  // resolution, not geometry, is the dial worth turning automatically.
  private quality: Quality = 'auto';
  private renderScale = 2;
  private maxScale = 2;
  /** The lowest the governor will go: the screen's CSS pixels, never under. */
  private minScale = 1;
  private readonly adaptiveSamples: number[] = [];
  /** No frames are judged before this — loading, a rebuild, a change of size. */
  private settleUntil = 0;
  /** Bad and good spells running, since one alone is as often another app's moment. */
  private badSpells = 0;
  private goodSpells = 0;
  /** A scale that failed, and when it may be tried again (backing off each time). */
  private failedScale = Infinity;
  private retryAt = 0;
  private retryWait = 30_000;
  /** A change waiting for the hand to let go: never mid-gesture. */
  private pendingScale: number | null = null;
  private pointersDown = 0;
  /** Display refresh rate, measured — 60Hz is not a safe assumption. */
  private refreshHz = 60;
  private readonly refreshSamples: number[] = [];
  /** Last requested post-effect state, so a resolution change can revisit it. */
  private lookToggles = { bloom: true, dof: true, grain: true, antialias: true };
  private pendingCapture: ((url: string) => void) | null = null;
  private disposed = false;

  // Pointer response. Kept as a smoothly chased point rather than a hit test —
  // see `updateHover`.
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly lastPointer = new Vector2();
  private dragging = false;
  private pointerInside = false;
  private readonly hoverPoint = new Vector3(0, -1000, 0);
  private readonly hoverTarget = new Vector3(0, -1000, 0);
  private hoverStrength = 0;
  private hoverWanted = 0;

  stats: StudioStats = {
    modules: 0,
    nodes: 0,
    leaves: 0,
    branchTriangles: 0,
    vertices: 0,
    buildMs: 0,
    fps: 0,
    truncated: false,
    renderScale: 1,
    adaptive: true,
  };

  onStats: ((stats: StudioStats) => void) | null = null;
  /**
   * The camera's compass bearing from the tree, in degrees, in the same
   * convention as the sun's azimuth — for controls drawn relative to where
   * you are looking from. Fired when it changes by more than half a degree.
   */
  onBearing: ((degrees: number) => void) | null = null;
  private lastBearing = NaN;
  onGrowth: ((growth: number) => void) | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    // Aerial perspective, as a fog node so it lands after lighting.
    this.scene.fogNode = aerialPerspective(this.groundUniforms);
    // The sky is a shader, not a texture: moving the sun costs a uniform write.
    this.scene.backgroundNode = this.sky.backgroundNode;
    // Same sky, rendered small into a cube for image-based lighting. Assigned
    // once — `refresh` updates the contents in place.
    this.scene.environment = this.sky.environment;

    this.scene.add(this.landscape.group);
    this.scene.add(this.meadow.group);
    this.scene.add(this.snowfall);
    this.scene.add(this.rainfall);
    this.scene.add(this.flock.mesh);
    this.scene.add(this.tree.group);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 90;
    this.scene.add(this.sun, this.sun.target, this.fill);
  }

  async init(): Promise<void> {
    this.renderer = new WebGPURenderer({ canvas: this.canvas, antialias: false, alpha: false });
    // The screen's own density, up to twice: drawn under it and stretched up,
    // the picture is soft and fine twigs shimmer.
    this.maxScale = Math.min(window.devicePixelRatio, 2);
    this.minScale = Math.min(this.maxScale, 1);
    this.renderScale = this.maxScale;
    this.settle(4000);
    this.renderer.setPixelRatio(this.renderScale);
    // Khronos PBR Neutral rather than AgX. AgX is built to desaturate as it
    // compresses, which is right for film-like highlights and wrong for a
    // garden: everything but the brightest leaves came out olive-grey, and
    // turning the sun up washed the picture toward white. Neutral leaves hue
    // and saturation alone until a colour is genuinely close to white.
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    await this.renderer.init();

    this.controls = new OrbitControls(this.camera, this.canvas);
    // Your hand on the camera wins over any glide in progress.
    this.controls.addEventListener('start', () => (this.cameraGlide = null));
    this.controls.addEventListener('change', () => this.emitBearing());
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 120;
    // Low enough to stand under the crown and look up into it, or up at the
    // sky; the ground itself is kept clear in the frame loop (see `frame`).
    this.controls.maxPolarAngle = Math.PI * 0.62;
    this.controls.autoRotateSpeed = 0;

    this.post = createPostPipeline(this.renderer, this.scene, this.camera);
    this.post.setPixelRatio(this.renderScale);

    this.camera.position.set(9, 5, 12);
    this.controls.target.set(0, 3.2, 0);
    this.controls.update();

    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    // Anywhere on the page: a slider in a card counts as much as the camera.
    window.addEventListener('pointerdown', this.onAnyDown, true);
    window.addEventListener('pointerup', this.onAnyUp, true);
    window.addEventListener('pointercancel', this.onAnyUp, true);

    this.resize();
    // A handle for profiling from the console — hiding a mesh and watching the
    // frame time is the only reliable way to find out what a frame is spending
    // its budget on.
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__studio = this;
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  get isReady(): boolean {
    return !!this.renderer;
  }

  // ------------------------------------------------------------ structure

  /** Re-derives the L-system and rebuilds the tree, here and now. */
  rebuild(params: StructureParams): TreeInfo {
    return this.adopt(this.tree.rebuild(params));
  }

  /**
   * Rebuild off the main thread and swap the result in when it is ready, with
   * no animation — for a slider being dragged, where the tree should simply
   * become the new one. Only the newest request lands; anything it overtook is
   * dropped.
   */
  async rebuildQuietly(params: StructureParams): Promise<TreeInfo | null> {
    const token = ++this.buildToken;
    const data = await this.tree.prepare(params);
    if (token !== this.buildToken) return null;
    const before = { h: this.treeHeight, r: this.treeRadius };
    // Blended: where the structure is unchanged, the old shape morphs into
    // the new one rather than being swapped for it.
    const info = this.adopt(this.tree.apply(data, params, true));
    // A tree that has grown or shrunk a lot under the camera is reframed —
    // gently, so a drag reads as the camera keeping up, not as a cut.
    const scale = Math.max(this.treeHeight / before.h, before.h / this.treeHeight, this.treeRadius / before.r, before.r / this.treeRadius);
    if (info.ok && scale > 1.25) this.frameTree(true);
    return info;
  }

  /**
   * Change to a different tree, as a little piece of theatre rather than a cut.
   *
   * The tree standing grows back into the ground — tips first, the trunk last,
   * the growth animation run backwards — while the new one is built on a
   * worker, so nothing on screen stalls. Once both are done the new tree is
   * put in, still at nothing, the camera glides to frame it, and it grows out
   * of the same patch of ground. Switching again mid-way is fine: the newest
   * request wins and the rest are dropped.
   */
  async transitionTo(params: StructureParams, palette: Palette, growthSpeed: number): Promise<TreeInfo | null> {
    const token = ++this.buildToken;
    const [data] = await Promise.all([this.tree.prepare(params), this.ungrow()]);
    if (token !== this.buildToken) return null;
    const info = this.adopt(this.tree.apply(data, params));
    this.applyPalette(palette);
    this.frameTree(true);
    this.playGrowth(0, growthSpeed);
    return info;
  }

  private emitBearing(): void {
    const d = this.camera.position.clone().sub(this.controls.target);
    const bearing = (Math.atan2(d.x, d.z) * 180) / Math.PI;
    if (Math.abs(bearing - this.lastBearing) < 0.5) return;
    this.lastBearing = bearing;
    this.onBearing?.(bearing);
  }

  /** Run the growth back to nothing; resolves when it gets there. */
  private ungrow(): Promise<void> {
    this.growthTarget = 0;
    this.growthSpeed = UNGROW_SPEED;
    if (this.growth <= 0) return Promise.resolve();
    return new Promise((resolve) => this.ungrown.push(resolve));
  }

  private adopt(build: TreeInfo): TreeInfo {
    if (!build.ok) return build;
    if (!this.fadingWarmed) {
      this.fadingWarmed = true;
      // Once there is a tree to compile them against, build the stippled
      // materials a dissolve uses, in the background, so the first one does
      // not stall on shaders.
      const warm = new Group();
      for (const m of this.tree.warmFading()) warm.add(m);
      this.renderer.compileAsync(warm, this.camera, this.scene).catch(() => {});
    }

    this.treeHeight = build.height;
    this.treeRadius = build.radius;
    this.updateShadowVolume();
    // A new tree costs a few heavy frames to arrive; they are no measure.
    this.settle(2000);

    this.stats = {
      ...this.stats,
      modules: build.stats.modules,
      nodes: build.stats.nodes,
      leaves: build.leafCount,
      branchTriangles: build.branchTriangles,
      vertices: build.vertices,
      buildMs: build.stats.ms,
      truncated: build.stats.truncated,
    };
    this.onStats?.(this.stats);

    return build;
  }

  /**
   * Points the camera at the tree. `smooth` glides there over a couple of
   * seconds instead of cutting — used when the tree changes under the camera,
   * where a jump would undo the whole point of growing the new one in. Any
   * drag of your own cancels the glide.
   */
  frameTree(smooth = false): void {
    const h = this.treeHeight;

    // Fit the subject to whichever axis is tighter. A wide, low canopy in a
    // portrait viewport overflows badly if the distance comes from height alone.
    const halfV = MathUtils.degToRad(this.camera.fov) * 0.5;
    const halfH = Math.atan(Math.tan(halfV) * this.camera.aspect);
    const dist = Math.max(
      3,
      ((h * 0.6) / Math.tan(halfV)) * 1.12,
      (this.treeRadius / Math.tan(halfH)) * 1.12,
    );

    const dir = new Vector3().subVectors(this.camera.position, this.controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(1, 0.45, 1.2);
    dir.normalize();
    // Settle into a slightly low, cinematic angle.
    dir.y = MathUtils.clamp(dir.y, 0.18, 0.42);
    dir.normalize();
    const target = new Vector3(0, h * 0.44, 0);
    const position = target.clone().addScaledVector(dir, dist);
    if (smooth) {
      this.cameraGlide = {
        fromTarget: this.controls.target.clone(),
        fromPosition: this.camera.position.clone(),
        target,
        position,
        t: 0,
      };
      return;
    }
    this.cameraGlide = null;
    this.controls.target.copy(target);
    this.camera.position.copy(position);
    this.controls.update();
  }

  // ----------------------------------------------------------------- look

  applyPalette(palette: Palette): void {
    this.tree.applyPalette(palette);
  }

  applyLook(params: LookParams): void {
    this.tree.applyLook(params);
    this.seasonTarget.snowfall = params.weather === 'snow' ? params.precipitation : 0;
    this.seasonTarget.rainfall = params.weather === 'rain' ? params.precipitation : 0;
    this.applySeason(params.season);
    this.wetTarget = params.weather === 'rain' ? 0.45 + 0.55 * params.precipitation : 0;
    // One slider for every surface that holds snow, so the tree, the sward and
    // the ground under them are never dressed for different weather.
    this.groundUniforms.snowCover.value = params.snow;

    if (!this.renderer) return;
    this.userExposure = params.exposure;
    this.updateExposure();
    this.post.setGlow(params.bloom);
    this.post.setColour(params.colour);
    this.post.setFocusBlur(params.depthOfField);
    this.post.setGrain(params.grain);
    if (!this.lookShown) {
      this.lookShown = true;
      this.post.settleFades();
    }
    // Glow stays in the chain even at zero (it is cheap at its resolution),
    // so moving the slider through nothing does not rebuild it. Focus blur
    // and grain fade in and out on their own (see `setFocusBlur`).
    this.lookToggles = { ...this.lookToggles, antialias: params.antialias };
    this.refreshPost();
    // Orbit eases into its circling and out of it (see `frame`).
    this.orbitTarget = params.autoRotate ? ORBIT_SPEED : 0;
    this.applyQuality(params.quality);
  }

  /**
   * Everything a season owns that is not already a slider.
   *
   * The foliage, wind and sky values a season implies are written into the
   * parameters themselves, so the sliders show them and stay editable. What is
   * left here is the scene dressing with no control of its own: the ground
   * palette, the snow, and how much of the meadow is still in flower.
   */
  private applySeason(id: Season): void {
    const season = getSeason(id);
    const t = this.seasonTarget;
    t.leafDry = season.leafDry;
    t.meadowBloom = season.meadowBloom;
    t.snowColor.copy(snowTintFor(id));
    t.grassDeep.setHex(season.grassDeep);
    t.grassMid.setHex(season.grassMid);
    t.grassDry.setHex(season.grassDry);
    t.dirt.setHex(season.dirt);
    // The first look lands as it is; only changes after that are eased.
    if (!this.seasonShown) {
      this.seasonShown = true;
      this.easeSeason(Infinity);
    }
  }

  /**
   * Carry the scene dressing a season owns toward where it is heading.
   *
   * The values a season shares with the sliders glide in the app, which moves
   * the sliders with them; these have no slider, so they glide here, on the
   * same sort of timescale. Rain and snow in the air ease too: they thin by
   * per-drop threshold, so easing their intensity is a fade in or out rather
   * than every drop appearing at once.
   */
  private easeSeason(dt: number): void {
    const k = 1 - Math.exp(-dt / 0.85);
    const t = this.seasonTarget;
    const u = this.tree.uniforms;
    const g = this.groundUniforms;
    u.leafDry.value += (t.leafDry - u.leafDry.value) * k;
    u.meadowBloom.value += (t.meadowBloom - u.meadowBloom.value) * k;
    u.snowfall.value += (t.snowfall - u.snowfall.value) * k;
    u.rainfall.value += (t.rainfall - u.rainfall.value) * k;
    u.snowColor.value.lerp(t.snowColor, k);
    g.grassDeep.value.lerp(t.grassDeep, k);
    g.grassMid.value.lerp(t.grassMid, k);
    g.grassDry.value.lerp(t.grassDry, k);
    g.dirt.value.lerp(t.dirt, k);
  }

  /**
   * Exposure follows the sun part of the way, as a camera's would. Without
   * this the Sunlight slider was really a brightness control — the whole
   * frame went toward white as it rose. Now a stronger sun mostly means more
   * contrast between sun and shade, with the lit side keeping its colour.
   */
  private updateExposure(): void {
    if (!this.renderer) return;
    const follow = Math.pow(5 / Math.max(0.5, this.sunPower), 0.32);
    // Neutral sits a little darker in the mid-tones than AgX did; this puts
    // the default picture back where it was in brightness, with its colour.
    this.renderer.toneMappingExposure = NEUTRAL_LIFT * this.userExposure * follow;
  }

  /** Show or hide the rainbow; it fades either way. */
  setRainbow(on: boolean): void {
    this.rainbowTarget = on ? 1 : 0;
  }

  /**
   * Turn round to see the rainbow: it is always in the sky opposite the sun,
   * so the camera comes round to stand between the sun and the tree, low,
   * looking up past the crown — the bow is high and wide, and from the usual
   * slightly-downward view only its feet would be in the picture.
   */
  showRainbow(): void {
    const toSun = new Vector3(this.sunDir.x, 0, this.sunDir.z);
    if (toSun.lengthSq() < 1e-6) return;
    toSun.normalize();
    const h = Math.max(2, this.treeHeight);
    const flat = Math.max(9, Math.hypot(this.camera.position.x - this.controls.target.x, this.camera.position.z - this.controls.target.z));
    const target = new Vector3(0, h * 0.95, 0).addScaledVector(toSun, -h * 0.6);
    const position = new Vector3(toSun.x * flat, CAMERA_FLOOR + 0.9, toSun.z * flat);
    this.cameraGlide = {
      fromTarget: this.controls.target.clone(),
      fromPosition: this.camera.position.clone(),
      target,
      position,
      t: 0,
    };
  }

  /** A sparser season's leaves come down rather than disappearing. See `Tree.dropLeaves`. */
  dropLeaves(fromDensity: number, toDensity: number): void {
    this.tree.dropLeaves(fromDensity, toDensity);
  }

  /** Bring the canopy back, smoothly. See `Tree.regrowLeaves`. */
  regrowLeaves(): void {
    this.tree.regrowLeaves();
  }


  /**
   * Where the sun and sky are heading. They ease there over a fraction of a
   * second (see `easeSky`): dragging the sun still feels direct, but clicking
   * a spot on the dial, or a preset moving the light, glides instead of
   * jumping the shadows across the lawn in one frame.
   */
  applySky(params: SkyParams): void {
    const first = !this.skyTarget;
    this.skyTarget = { ...params };
    if (first) {
      this.skyNow = { ...params };
      this.applySkyNow(this.skyNow);
    }
  }

  private skyTarget: SkyParams | null = null;
  private skyNow: SkyParams | null = null;

  private easeSky(dt: number): void {
    const to = this.skyTarget;
    const now = this.skyNow;
    if (!to || !now) return;
    const k = 1 - Math.exp(-dt / 0.16);
    let moving = false;
    for (const key of ['sunElevation', 'haze', 'sunIntensity', 'skyLight', 'overcast'] as const) {
      const d = to[key] - now[key];
      if (Math.abs(d) > 1e-4) {
        now[key] += d * k;
        moving = true;
      } else now[key] = to[key];
    }
    // Azimuth the short way round.
    let d = to.sunAzimuth - now.sunAzimuth;
    d = ((((d + 180) % 360) + 360) % 360) - 180;
    if (Math.abs(d) > 1e-3) {
      now.sunAzimuth += d * k;
      moving = true;
    } else now.sunAzimuth = to.sunAzimuth;
    if (moving) this.applySkyNow(now);
  }

  private applySkyNow(params: SkyParams): void {
    const settings: SkySettings = {
      elevation: params.sunElevation,
      azimuth: params.sunAzimuth,
      haze: params.haze,
      overcast: params.overcast,
    };

    // One call, and every consumer of the sun reads the same answer: the disc
    // painted in the sky, the key light, the fill, the aerial perspective and
    // the tree's own backlighting.
    const light = this.sky.update(settings);
    this.sky.setIntensity(params.skyLight);
    sunDirection(settings, this.sunDir);
    this.sunTint.copy(light.color);

    // Keep the shadow map wrapped around the new light direction; a low sun
    // throws a much longer shadow than a high one.
    this.updateShadowVolume();
    this.sun.color.copy(this.sunTint);
    // `strength` is already the atmospheric dimming — a horizon sun is a
    // fraction of a noon one because its light has crossed 38 atmospheres.
    this.sun.intensity = params.sunIntensity * light.strength;
    this.sunPower = params.sunIntensity;
    this.updateExposure();

    this.tree.setSun(this.sunDir, this.sunTint);

    // The sky is the fill light, so its brightness has to move with the slider
    // that controls it, and its colour with the hour.
    this.scene.environmentIntensity = 0.85 * params.skyLight;
    const skyFill = this.sunTint.clone().lerp(new Color(0xbcd2ff), 0.55 + params.haze * 0.25);
    this.fill.color.copy(skyFill);
    this.fill.intensity = (0.5 + params.haze * 0.55) * params.skyLight;

    // Tie the haze and ground horizon to the sky so nothing looks pasted on.
    const horizon = this.sunTint.clone().lerp(new Color(0xcfd8e6), 0.26 + params.haze * 0.4).multiplyScalar(0.8 + params.haze * 0.3);
    // Haze is *the* aerial-perspective control: clear air lets you see the far
    // ridges, thick air stacks them into flat grey planes a few hundred units
    // out. A gentle range here was most of why the slider read as doing nothing.
    this.groundUniforms.fadeDistance.value = MathUtils.lerp(620, 95, params.haze * params.haze);
    this.groundUniforms.horizon.value.copy(horizon);
    // What distance scatters toward once the warm horizon band is behind you.
    // Keeping it cool and a shade darker than the sky is what leaves the
    // mountains a silhouette instead of dissolving them into it.
    this.groundUniforms.aerialFar.value
      .copy(horizon)
      .lerp(new Color(0x7d90bb), 0.72 - params.haze * 0.45)
      .multiplyScalar(0.92 + params.haze * 0.22);
    // Snow takes the sun's colour: at golden hour a snowfield is pink, not white.
    this.groundUniforms.snow.value.copy(this.sunTint).lerp(new Color(0xffffff), 0.35);

    // Under cloud the distance closes in and loses its colour: the warm band
    // and the blue far planes both go to the grey of the cloud base.
    const o = params.overcast;
    this.groundUniforms.fadeDistance.value *= 1 - 0.55 * o;
    this.groundUniforms.horizon.value.lerp(OVERCAST_NEAR, 0.75 * o);
    this.groundUniforms.aerialFar.value.lerp(OVERCAST_FAR, 0.8 * o);
  }

  // --------------------------------------------------------------- growth

  setGrowth(value: number): void {
    this.growth = MathUtils.clamp(value, 0, 1);
    this.growthTarget = this.growth;
    this.tree.setGrowth(this.growth);
    this.onGrowth?.(this.growth);
  }

  playGrowth(from = 0, speed = 0.32): void {
    this.growth = MathUtils.clamp(from, 0, 1);
    this.growthTarget = 1;
    this.growthSpeed = speed;
    this.tree.setGrowth(this.growth);
  }

  get currentGrowth(): number {
    return this.growth;
  }

  // ---------------------------------------------------------------- frame

  /**
   * Match the drawing buffer to the stage.
   *
   * Cheap to call, but never free: the post chain owns 35 render targets and a
   * quarter of a gigabyte of textures, and every one that depends on the
   * viewport is destroyed and rebuilt here. A caller that fires this on each
   * frame of a CSS transition is asking for hundreds of GPU texture
   * reallocations to animate a sidebar. The size guard makes repeat calls at a
   * settled size free, but it cannot help a size that is genuinely changing
   * every frame — that is the caller's problem to avoid.
   */
  resize(): void {
    if (!this.renderer) return;
    const parent = this.canvas.parentElement;
    const width = parent?.clientWidth || window.innerWidth;
    const height = parent?.clientHeight || window.innerHeight;
    if (width === this.viewWidth && height === this.viewHeight) return;
    this.viewWidth = width;
    this.viewHeight = height;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  capture(): Promise<string> {
    return new Promise((resolve) => {
      this.pendingCapture = resolve;
    });
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    // Arriving from outside is not a sweep across the canvas.
    if (!this.pointerInside) this.lastPointer.copy(this.pointer);
    this.pointerInside = true;
    // A held button is the camera being orbited, which moves the pointer fast
    // and the tree not at all.
    this.dragging = event.buttons !== 0;
  };

  private readonly onPointerLeave = (): void => {
    this.pointerInside = false;
  };

  /** Whether a hand is on anything, for the resolution governor to wait on. */
  private readonly onAnyDown = (): void => {
    this.pointersDown++;
  };

  private readonly onAnyUp = (): void => {
    this.pointersDown = Math.max(0, this.pointersDown - 1);
    // A gesture just ended; the frames around it were not ordinary ones.
    if (this.pointersDown === 0) this.settle(1000);
  };

  /**
   * Chase the point on the tree the pointer is over.
   *
   * Not a hit test against the mesh, for two reasons. Growth and wind both move
   * this geometry in the vertex shader, so the triangles a CPU raycast would
   * test are not the triangles on screen; and picking a *surface* would make
   * the response snap between leaves as the cursor crosses gaps in the canopy.
   * A point floating inside the crown, with the shader falling off smoothly
   * around it, has neither problem.
   *
   * What it aims at matters, though. Taking the entry point on a bounding
   * sphere — the obvious first try — leaves the influence sitting in empty air
   * beside the crown whenever the cursor is anywhere but dead centre, because
   * that sphere is mostly not tree. Measuring against the trunk *axis* instead
   * lands it inside the canopy wherever the cursor is, and covers the trunk for
   * free, since the axis runs the full height of the tree.
   *
   * Both the point and the strength are eased with an exponential chase, which
   * is frame-rate independent: at 30fps and at 144fps the response takes the
   * same amount of *time*, so it cannot feel different on a slower machine.
   */
  private updateHover(dt: number): void {
    const height = Math.max(1, this.treeHeight);
    const radius = Math.max(0.5, this.treeRadius);

    this.hoverWanted = 0;
    if (this.pointerInside) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const ray = this.raycaster.ray;

      // Closest approach between the cursor ray and the trunk axis.
      const o = _v1.copy(ray.origin);
      const d = ray.direction;
      const axis = _v2.set(0, height, 0);
      const b = d.dot(axis);
      const c = axis.dot(axis);
      const dw = d.dot(o);
      const e = axis.dot(o);
      const denom = c - b * b;

      let s = Math.abs(denom) < 1e-6 ? 0 : (e - b * dw) / denom;
      s = MathUtils.clamp(s, 0, 1);
      const t = Math.max(0, b * s - dw);

      const onAxis = _v3.copy(axis).multiplyScalar(s);
      const onRay = _v4.copy(d).multiplyScalar(t).add(o);
      const miss = onRay.distanceTo(onAxis);

      // Pull toward the camera so the influence sits on the near side of the
      // crown, where the leaves you can actually see are.
      ray.at(Math.max(0, t - radius * 0.55), this.hoverTarget);
      // Fades out as the cursor leaves the tree rather than switching off, so
      // there is no edge to catch.
      this.hoverWanted = 1 - MathUtils.smoothstep(miss, radius * 0.95, radius * 1.75);
    }

    // Faster to follow the cursor than to fade in, so the response tracks the
    // pointer closely but never blinks on.
    this.hoverPoint.lerp(this.hoverTarget, 1 - Math.exp(-dt * 14));
    this.hoverStrength += (this.hoverWanted - this.hoverStrength) * (1 - Math.exp(-dt * 7));

    const reach = Math.max(0.55, radius * 0.34);
    this.tree.setHover(this.hoverPoint, reach, this.hoverStrength);

    // Touching the tree shakes its fruit down. Only once the response has
    // actually arrived, so brushing past the edge of the crown does not strip
    // it; and against a tighter radius than the foliage uses, so what falls is
    // what you were pointing at.
    if (this.hoverStrength > 0.6) this.tree.knockFruit(this.hoverPoint, reach * 0.62);
    // Rustling, not touching: how hard the canopy is shaken follows how fast
    // the pointer is moving through it, so a hand resting on the tree brings
    // down the odd leaf and a brisk sweep brings down a shower.
    const motion = this.pointer.distanceTo(this.lastPointer) / Math.max(dt, 1e-3);
    this.lastPointer.copy(this.pointer);
    const rustle = this.dragging ? 0 : MathUtils.clamp(motion / 1.6, 0, 1);
    // Wider than the parting: a hand in the crown shakes the branch it is on,
    // and the branch is longer than the hand.
    this.tree.shakeLeaves(this.hoverPoint, Math.max(1.3, radius * 0.5), this.hoverStrength * (0.12 + 0.88 * rustle));
    // Birds put up with the canopy: a hand resting on the tree is tolerated,
    // a hand moving through it is not.
    if (this.hoverStrength > 0.6 && rustle > 0.35) this.flock.startle(this.hoverPoint);
  }

  private frame(timeMs: number): void {
    if (this.disposed) return;
    // Clamped at both ends. The ceiling keeps a tab that was backgrounded for a
    // minute from teleporting the growth and the falling fruit on its first
    // frame back; the floor matters because a negative dt runs `1 - exp(-dt*k)`
    // off to -Infinity, and one NaN in the hover uniform blanks every vertex of
    // the tree.
    const dt = this.lastTime ? MathUtils.clamp((timeMs - this.lastTime) / 1000, 0, 0.05) : 0.016;
    this.lastTime = timeMs;

    if (this.growth !== this.growthTarget) {
      const step = dt * this.growthSpeed;
      this.growth =
        this.growth < this.growthTarget
          ? Math.min(this.growthTarget, this.growth + step)
          : Math.max(this.growthTarget, this.growth - step);
      this.tree.setGrowth(this.growth);
      this.onGrowth?.(this.growth);
    }
    if (this.growth <= 0 && this.ungrown.length) {
      const waiting = this.ungrown;
      this.ungrown = [];
      for (const resolve of waiting) resolve();
    }

    const glide = this.cameraGlide;
    if (glide) {
      glide.t = Math.min(1, glide.t + dt / GLIDE_SECONDS);
      const e = glide.t * glide.t * (3 - 2 * glide.t);
      this.controls.target.lerpVectors(glide.fromTarget, glide.target, e);
      this.camera.position.lerpVectors(glide.fromPosition, glide.position, e);
      if (glide.t >= 1) this.cameraGlide = null;
    }

    // Orbit gathers speed and slows to a stop, rather than lurching.
    const sp = this.controls.autoRotateSpeed + (this.orbitTarget - this.controls.autoRotateSpeed) * (1 - Math.exp(-dt / 0.6));
    this.controls.autoRotateSpeed = Math.abs(sp) < 1e-3 && this.orbitTarget === 0 ? 0 : sp;
    this.controls.autoRotate = this.controls.autoRotateSpeed !== 0;
    this.controls.update();
    // Looking up is allowed; standing in the ground is not. (A little above
    // the grass, too, or the first thing in the picture is a blade of it.)
    if (this.camera.position.y < CAMERA_FLOOR) {
      this.camera.position.y = CAMERA_FLOOR;
      this.camera.lookAt(this.controls.target);
    }
    // One clock for anything the CPU and the shader both have to agree on.
    this.tree.tick(dt);
    this.updateHover(dt);
    this.flock.update(dt);

    this.easeSeason(dt);

    this.easeSky(dt);
    this.post.tick(dt);
    this.rainbow += (this.rainbowTarget - this.rainbow) * (1 - Math.exp(-dt / 1.1));
    this.sky.setRainbow(this.rainbow);

    // Things get wet in seconds and take a good while to dry.
    const rate = this.wetTarget > this.wetness ? 1 / 6 : 1 / 45;
    this.wetness += (this.wetTarget - this.wetness) * (1 - Math.exp(-dt * rate * 3));
    this.tree.uniforms.wetness.value = this.wetness;
    this.groundUniforms.wetness.value = this.wetness;

    // Keep the focal plane on whatever the camera is orbiting.
    const focus = this.camera.position.distanceTo(this.controls.target);
    this.post.uniforms.focusDistance.value = focus;
    // And deepen the zone of sharpness with distance, as a lens does. Held at
    // a fixed 15m, pulling back left only the tree sharp in a field of blur —
    // the look of a model railway photographed close up, not of a meadow.
    this.post.uniforms.focalLength.value = 6 + focus * 0.7;

    // Re-render the environment cube before the frame that needs it, and only
    // when the sun has actually moved.
    this.sky.refresh(this.renderer);
    this.post.render();

    if (this.pendingCapture) {
      const resolve = this.pendingCapture;
      this.pendingCapture = null;
      resolve(this.canvas.toDataURL('image/png'));
    }

    this.updateAdaptiveResolution(dt);

    this.frameTimes.push(dt);
    if (this.frameTimes.length > 45) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.frameTimes.length = 0;
      this.stats = {
        ...this.stats,
        fps: Math.round(1 / Math.max(1e-4, avg)),
        renderScale: this.renderScale,
        adaptive: this.quality === 'auto',
      };
      this.onStats?.(this.stats);
    }
  }

  /**
   * Hold the frame rate by giving up resolution — rarely, and calmly.
   *
   * The first version of this judged under a second of frames and stepped
   * down whenever a tenth of them were late. Every rebuild, every slider drag
   * and every swing of the camera has a few late frames, so the picture went
   * soft whenever anything was touched, sharpened again later, and flickered
   * between the two — every step reallocating every buffer. Resolution is the
   * one thing the eye notices changing, so now:
   *
   * - frames are judged in spells of a few seconds, and not at all while
   *   loading, rebuilding, resizing, or while a pointer is down;
   * - a spell with a long hitch in it (a shader compiling, a tree arriving) is
   *   thrown away rather than counted;
   * - it takes two slow spells running (under about 40fps) to step down, and
   *   never below the screen's CSS pixels;
   * - a scale that failed is not tried again for half a minute, then a minute,
   *   and so on, so it does not sharpen and soften by turns;
   * - and a change waits until the hand lets go.
   *
   * Going down is judged by the mean frame time over the spell (hitches are
   * already excluded); going back up only once the frames keep pace with the
   * display itself, since vsync hides any headroom short of that.
   */
  private updateAdaptiveResolution(dt: number): void {
    this.measureRefresh(dt);
    if (this.quality !== 'auto') return;
    const now = performance.now();

    if (this.pendingScale !== null && this.pointersDown === 0) {
      this.setRenderScale(this.pendingScale);
      this.pendingScale = null;
      return;
    }
    if (now < this.settleUntil || this.pointersDown > 0) {
      this.adaptiveSamples.length = 0;
      return;
    }

    const ms = dt * 1000;
    if (ms > 250) {
      // A hitch, not a trend.
      this.adaptiveSamples.length = 0;
      return;
    }
    this.adaptiveSamples.push(ms);
    if (this.adaptiveSamples.length < 150) return;

    const missThreshold = (1000 / this.refreshHz) * 1.4;
    let missed = 0;
    let total = 0;
    for (const t of this.adaptiveSamples) {
      if (t > missThreshold) missed++;
      total += t;
    }
    const dropRate = missed / this.adaptiveSamples.length;
    const meanMs = total / this.adaptiveSamples.length;
    this.adaptiveSamples.length = 0;

    // Slow is under about forty frames a second. This is a slow scene — a tree
    // in a breeze, a camera you swing now and then — and between a sharp
    // picture at forty-five and a soft one at sixty, sharp is the better
    // trade: it was the softness that read as broken, never the frame rate.
    if (meanMs > 25) {
      this.goodSpells = 0;
      if (++this.badSpells < 2 || this.renderScale <= this.minScale) return;
      this.badSpells = 0;
      // Back where it failed before, and failed again: wait longer next time.
      if (this.renderScale >= this.failedScale) this.retryWait = Math.min(this.retryWait * 2, 5 * 60_000);
      this.failedScale = this.renderScale;
      this.retryAt = now + this.retryWait;
      this.requestRenderScale(Math.max(this.minScale, this.renderScale - 0.25));
    } else if (dropRate < 0.03) {
      // Keeping up with the display itself: there may be room for more.
      this.badSpells = 0;
      if (
        ++this.goodSpells >= 3 &&
        this.renderScale < this.maxScale &&
        (this.renderScale + 0.25 < this.failedScale || now > this.retryAt)
      ) {
        this.goodSpells = 0;
        this.requestRenderScale(Math.min(this.maxScale, this.renderScale + 0.25));
      }
    } else {
      // In between: hold.
      this.badSpells = 0;
      this.goodSpells = 0;
    }
  }

  /**
   * Estimate the refresh interval from the *fastest* frames seen. A frame can
   * always be slower than the display, never faster, so the low percentile of
   * observed intervals is the refresh rate.
   */
  private measureRefresh(dt: number): void {
    if (this.refreshSamples.length >= 90) return;
    this.refreshSamples.push(dt * 1000);
    if (this.refreshSamples.length < 90) return;
    const sorted = [...this.refreshSamples].sort((a, b) => a - b);
    const fastest = sorted[Math.floor(sorted.length * 0.1)];
    this.refreshHz = MathUtils.clamp(Math.round(1000 / Math.max(1, fastest)), 30, 240);
  }
  private requestRenderScale(scale: number): void {
    if (this.pointersDown > 0) this.pendingScale = scale;
    else this.setRenderScale(scale);
  }

  private setRenderScale(scale: number): void {
    if (scale === this.renderScale) return;
    this.renderScale = scale;
    this.renderer.setPixelRatio(scale);
    this.post?.setPixelRatio(scale);
    this.resize();
    this.settle(2000);
  }

  /** Judge no frames for a while: the next few are not representative. */
  settle(ms: number): void {
    this.settleUntil = Math.max(this.settleUntil, performance.now() + ms);
    this.adaptiveSamples.length = 0;
    this.badSpells = 0;
  }

  /** Push the requested effects to the pipeline. */
  private refreshPost(): void {
    if (!this.post) return;
    this.post.setToggles({ antialias: this.lookToggles.antialias });
  }

  private applyQuality(quality: Quality): void {
    if (this.quality === quality) return;
    this.quality = quality;
    this.settle(2000);
    if (quality !== 'auto') {
      this.renderScale = Math.min(this.maxScale, QUALITY_SCALE[quality]);
      this.renderer.setPixelRatio(this.renderScale);
      this.post?.setPixelRatio(this.renderScale);
      this.resize();
    }
    this.refreshPost();
    this.stats = { ...this.stats, renderScale: this.renderScale, adaptive: quality === 'auto' };
    this.onStats?.(this.stats);
  }

  /**
   * Fit the shadow camera to the tree *and* the shadow it throws on the ground.
   *
   * Sizing it to the tree alone is what makes low-sun shadows look unrelated to
   * the sun: at 9° elevation a 7-unit tree casts a 44-unit shadow, so all but
   * the first few units fall outside the map and simply vanish. The fix is to
   * project the tree's bounds down the light direction onto the ground, then
   * fit the box around the union — measured in the light's own space, not the
   * world's.
   */
  private updateShadowVolume(): void {
    const light = this.sun;
    const cam = light.shadow.camera;

    const h = Math.max(1, this.treeHeight);
    const r = Math.max(0.5, this.treeRadius);

    // Aim the light at the middle of the tree, from far enough out that the
    // whole subject sits comfortably in front of the near plane.
    const focus = _v1.set(0, h * 0.45, 0);
    const distance = Math.max(30, h * 4 + r * 2);
    light.position.copy(this.sunDir).multiplyScalar(distance).add(focus);
    light.target.position.copy(focus);
    light.target.updateMatrixWorld();
    light.updateMatrixWorld();

    // Corners of the tree's bounds, plus where each slides to on the ground.
    const points: Vector3[] = [];
    for (let i = 0; i < 8; i++) {
      const x = (i & 1 ? r : -r) * 1.1;
      const z = (i & 2 ? r : -r) * 1.1;
      const y = i & 4 ? h * 1.05 : 0;
      points.push(new Vector3(x, y, z));
    }
    // Shadows only travel a sane distance; at grazing sun the footprint would
    // otherwise run to the horizon and blur the map away to nothing.
    const rise = Math.max(0.12, this.sunDir.y);
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      const travel = Math.min(p.y / rise, h * 3.5);
      points.push(new Vector3(p.x - this.sunDir.x * travel, p.y - rise * travel, p.z - this.sunDir.z * travel));
    }

    // Measure the union in light space. The shadow camera's own matrix is not
    // usable here — three only points it at the light target during rendering,
    // so reading it now gives a stale basis and the box ends up fitted to the
    // wrong direction. Build the same view matrix three will build.
    _m1.lookAt(light.position, focus, UP_AXIS).setPosition(light.position).invert();

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of points) {
      _v2.copy(p).applyMatrix4(_m1);
      minX = Math.min(minX, _v2.x);
      maxX = Math.max(maxX, _v2.x);
      minY = Math.min(minY, _v2.y);
      maxY = Math.max(maxY, _v2.y);
      // Light space looks down -z, so distance from the light is -z.
      minZ = Math.min(minZ, -_v2.z);
      maxZ = Math.max(maxZ, -_v2.z);
    }

    const pad = Math.max(0.5, h * 0.06);
    cam.left = minX - pad;
    cam.right = maxX + pad;
    cam.bottom = minY - pad;
    cam.top = maxY + pad;
    cam.near = Math.max(0.1, minZ - pad);
    cam.far = maxZ + pad;
    cam.updateProjectionMatrix();
  }


  dispose(): void {
    this.disposed = true;
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    window.removeEventListener('pointerdown', this.onAnyDown, true);
    window.removeEventListener('pointerup', this.onAnyUp, true);
    window.removeEventListener('pointercancel', this.onAnyUp, true);
    this.renderer?.setAnimationLoop(null);
    this.tree.dispose();
    this.landscape.dispose();
    this.meadow.dispose();
    this.flock.dispose();
    for (const m of [this.snowfall, this.rainfall]) {
      m.geometry.dispose();
      (m.material as { dispose(): void }).dispose();
    }
    this.sky.dispose();
    this.post?.dispose();
    this.controls?.dispose();
    this.renderer?.dispose();
  }
}

export { getPreset };
