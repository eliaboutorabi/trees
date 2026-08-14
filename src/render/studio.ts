/**
 * The three.js side of the app: renderer, scene, lighting, and the bridge
 * between L-system parameters and what ends up on screen.
 */
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Matrix4,
  MathUtils,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three';
import { AgXToneMapping, WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getPreset, Tree, type Palette, type TreeInfo, type TreeStructure } from '../engine';
import { createLandscape } from './landscape';
import { createPostPipeline } from './post';
import { ProceduralSky, sunDirection, type SkySettings } from './sky';
import { aerialPerspective } from './materials/ground';

/** Re-exported so the UI has one place to import parameter shapes from. */
export type StructureParams = TreeStructure;

/** Uniform-only changes — applied instantly, no rebuild. */
export interface LookParams {
  wind: number;
  windSpeed: number;
  windDirection: number;
  autumn: number;
  translucency: number;
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
const MAX_ORNAMENTS = 1_800;

// Scratch objects for the shadow fit, which runs whenever the sun moves.
const _v1 = new Vector3();
const _v2 = new Vector3();
const _m1 = new Matrix4();
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

  private readonly sunDir = new Vector3();
  private readonly sunTint = new Color();

  private treeHeight = 8;
  private treeRadius = 3;
  private growth = 0;
  private growthTarget = 1;
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
  private readonly adaptiveSamples: number[] = [];
  private adaptiveCooldown = 0;
  private adaptiveStable = 0;
  /** Evaluations of calm before probing for more resolution; backs off on failure. */
  private adaptiveProbeAfter = 8;
  /** Scale a probe last failed at, so we stop pushing into a known wall. */
  private adaptiveCeiling = Infinity;
  /** Display refresh rate, measured — 60Hz is not a safe assumption. */
  private refreshHz = 60;
  private readonly refreshSamples: number[] = [];
  /** Last requested post-effect state, so a resolution change can revisit it. */
  private lookToggles = { bloom: true, dof: true, grain: true, antialias: true };
  private pendingCapture: ((url: string) => void) | null = null;
  private disposed = false;

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
    this.maxScale = Math.min(window.devicePixelRatio, 2);
    this.renderScale = this.maxScale;
    this.renderer.setPixelRatio(this.renderScale);
    this.renderer.toneMapping = AgXToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    await this.renderer.init();

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 120;
    // Stop just short of horizontal so the camera never dips under the ground.
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.autoRotateSpeed = 0.35;

    this.post = createPostPipeline(this.renderer, this.scene, this.camera);

    this.camera.position.set(9, 5, 12);
    this.controls.target.set(0, 3.2, 0);
    this.controls.update();

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

  /** Re-derives the L-system and rebuilds the tree. */
  rebuild(params: StructureParams): TreeInfo {
    const build = this.tree.rebuild(params);
    if (!build.skeleton) return build;

    this.treeHeight = build.height;
    this.treeRadius = build.radius;
    this.updateShadowVolume();
    // Different tree, possibly different cost — let the controller re-learn.
    this.resetAdaptive();

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

  /** Points the camera at a freshly grown tree. */
  frameTree(): void {
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
    this.controls.target.set(0, h * 0.44, 0);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.controls.update();
  }

  // ----------------------------------------------------------------- look

  applyPalette(palette: Palette): void {
    this.tree.applyPalette(palette);
  }

  applyLook(params: LookParams): void {
    this.tree.applyLook(params);

    if (!this.renderer) return;
    this.renderer.toneMappingExposure = params.exposure;
    this.post.uniforms.bloomStrength.value = params.bloom;
    this.post.uniforms.bokeh.value = params.depthOfField ? 1.6 : 0;
    this.lookToggles = {
      bloom: params.bloom > 0.001,
      dof: params.depthOfField,
      grain: params.grain,
      antialias: params.antialias,
    };
    this.refreshPost();
    this.controls.autoRotate = params.autoRotate;
    this.applyQuality(params.quality);
  }

  applySky(params: SkyParams): void {
    const settings: SkySettings = {
      elevation: params.sunElevation,
      azimuth: params.sunAzimuth,
      haze: params.haze,
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

  private frame(timeMs: number): void {
    if (this.disposed) return;
    const dt = this.lastTime ? Math.min(0.05, (timeMs - this.lastTime) / 1000) : 0.016;
    this.lastTime = timeMs;

    if (this.growth < this.growthTarget) {
      this.growth = Math.min(this.growthTarget, this.growth + dt * this.growthSpeed);
      this.tree.setGrowth(this.growth);
      this.onGrowth?.(this.growth);
    }

    this.controls.update();

    // Keep the focal plane on whatever the camera is orbiting.
    const focus = this.camera.position.distanceTo(this.controls.target);
    this.post.uniforms.focusDistance.value = focus;

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
   * Nudge render resolution to hold the frame budget.
   *
   * Starts at full resolution and only ever falls back, because vsync makes
   * headroom invisible: a GPU with cycles to spare still reports 16.7ms, so
   * "am I comfortably inside budget?" is unanswerable. Instead it drops when it
   * misses, then occasionally probes back upward — if the probe misses it
   * simply falls again, which costs one evaluation window.
   *
   * Judges by dropped-frame rate rather than average or median frame time.
   * Vsync quantises frame time to multiples of the refresh interval, so a
   * struggling scene does not show up as a gradually rising number — it shows
   * up as a mix of 16.7ms frames and 33.3ms ones. The median just reports 16.7
   * and looks perfectly healthy while a quarter of frames are being dropped;
   * the mean is skewed by any one-off compile hitch. The fraction of frames
   * that missed vsync is the honest measure of "are we holding 60".
   */
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

  /** Forget what we learned about this machine — the workload just changed. */
  private resetAdaptive(): void {
    this.adaptiveSamples.length = 0;
    this.adaptiveCooldown = 0;
    this.adaptiveStable = 0;
    this.adaptiveProbeAfter = 8;
    this.adaptiveCeiling = Infinity;
  }

  private updateAdaptiveResolution(dt: number): void {
    this.measureRefresh(dt);
    if (this.quality !== 'auto') return;
    if (this.adaptiveCooldown > 0) {
      this.adaptiveCooldown--;
      return;
    }

    this.adaptiveSamples.push(dt * 1000);
    if (this.adaptiveSamples.length < 45) return;

    // Anything past 1.4 refresh intervals missed its vsync deadline.
    const missThreshold = (1000 / this.refreshHz) * 1.4;
    let missed = 0;
    for (const ms of this.adaptiveSamples) if (ms > missThreshold) missed++;
    const dropRate = missed / this.adaptiveSamples.length;
    this.adaptiveSamples.length = 0;

    let next = this.renderScale;

    if (dropRate > 0.1) {
      // If this was the frame right after a probe, we now know where the wall
      // is; wait considerably longer before trying again.
      this.adaptiveCeiling = Math.min(this.adaptiveCeiling, this.renderScale);
      this.adaptiveProbeAfter = Math.min(64, this.adaptiveProbeAfter * 2);
      next = Math.max(0.75, this.renderScale - 0.25);
      this.adaptiveStable = 0;
    } else if (dropRate > 0.02) {
      // Holding, but not comfortably — stay put rather than probe upward.
      this.adaptiveStable = 0;
    } else if (
      this.renderScale < this.maxScale &&
      this.renderScale + 0.25 < this.adaptiveCeiling &&
      ++this.adaptiveStable >= this.adaptiveProbeAfter
    ) {
      // Held budget for a long stretch — try for more resolution.
      next = Math.min(this.maxScale, this.renderScale + 0.25);
      this.adaptiveStable = 0;
    }

    if (next !== this.renderScale) {
      this.renderScale = next;
      this.renderer.setPixelRatio(next);
      this.resize();
      // Crossing the supersampling threshold changes whether FXAA is worth
      // running, which is itself part of the budget being balanced here.
      this.refreshPost();
      // Resizing costs a frame or two; do not measure those.
      this.adaptiveCooldown = 30;
    }
  }

  /**
   * Push the requested effects to the pipeline, minus anything the current
   * resolution has made pointless.
   *
   * Above about 1.75x device pixel ratio the frame is already supersampled
   * several times over by the browser's own downscale, and FXAA has nothing
   * left to find — it costs 2.5ms and returns a slightly softer image. So the
   * antialias control means "smooth the edges if that needs doing", and at high
   * resolution it does not.
   */
  private refreshPost(): void {
    if (!this.post) return;
    this.post.setToggles({
      ...this.lookToggles,
      antialias: this.lookToggles.antialias && this.renderScale < 1.75,
    });
  }

  private applyQuality(quality: Quality): void {
    if (this.quality === quality) return;
    this.quality = quality;
    this.resetAdaptive();
    if (quality !== 'auto') {
      this.renderScale = Math.min(this.maxScale, QUALITY_SCALE[quality]);
      this.renderer.setPixelRatio(this.renderScale);
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
    this.renderer?.setAnimationLoop(null);
    this.tree.dispose();
    this.landscape.dispose();
    this.sky.dispose();
    this.post?.dispose();
    this.controls?.dispose();
    this.renderer?.dispose();
  }
}

export { getPreset };
