/**
 * The three.js side of the app: renderer, scene, lighting, and the bridge
 * between L-system parameters and what ends up on screen.
 */
import {
  CircleGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  MathUtils,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three';
import { AgXToneMapping, WebGPURenderer } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildTree, getPreset, type TreeBuild } from '../lsystem';
import type { Palette } from '../lsystem/presets';
import { createBarkMaterial } from './materials/bark';
import { createGroundMaterial } from './materials/ground';
import { createLeafMaterial } from './materials/leaf';
import { createTreeUniforms } from './materials/shared';
import { createPostPipeline } from './post';
import { ProceduralSky, sunColorFor, sunDirection, type SkySettings } from './sky';
import { buildTreeGeometry } from './treeGeometry';

/** Everything that forces the grammar to be re-derived and the meshes rebuilt. */
export interface StructureParams {
  axiom: string;
  rules: string;
  iterations: number;
  angle: number;
  step: number;
  shrink: number;
  trunkRadius: number;
  tropism: number;
  pipeExponent: number;
  seed: number;
  leafScale: number;
  leafShape: 0 | 1 | 2;
  leafDensity: number;
  /** Also drives the silhouette jitter baked into the geometry. */
  barkDetail: number;
}

/** Uniform-only changes — applied instantly, no rebuild. */
export interface LookParams {
  wind: number;
  windSpeed: number;
  windDirection: number;
  autumn: number;
  translucency: number;
  barkDetail: number;
  moss: number;
  exposure: number;
  bloom: number;
  depthOfField: boolean;
  grain: boolean;
  antialias: boolean;
  autoRotate: boolean;
}

/** Re-bakes the sky texture, so it is worth debouncing. */
export interface SkyParams {
  sunElevation: number;
  sunAzimuth: number;
  haze: number;
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
}

const MAX_LEAVES = 26_000;

export class TreeStudio {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(38, 1, 0.1, 400);

  private renderer!: WebGPURenderer;
  private controls!: OrbitControls;
  private post!: ReturnType<typeof createPostPipeline>;

  private readonly uniforms = createTreeUniforms();
  private readonly sky = new ProceduralSky();
  private readonly sun = new DirectionalLight(0xffd7ab, 3.4);
  private readonly fill = new HemisphereLight(0xbdd4ff, 0x6b5836, 0.35);
  private readonly ground: Mesh;
  private readonly groundUniforms: ReturnType<typeof createGroundMaterial>['uniforms'];

  private branchMesh: Mesh | null = null;
  private leafMesh: Mesh | null = null;
  private readonly barkMaterial = createBarkMaterial(this.uniforms);
  private readonly leafMaterial = createLeafMaterial(this.uniforms);

  private readonly sunDir = new Vector3();
  private readonly sunTint = new Color();
  private readonly fog = new FogExp2(0xd9b184, 0.014);

  private treeHeight = 8;
  private treeRadius = 3;
  private growth = 0;
  private growthTarget = 1;
  private growthSpeed = 0.32;
  private lastTime = 0;
  private frameTimes: number[] = [];
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
  };

  onStats: ((stats: StudioStats) => void) | null = null;
  onGrowth: ((growth: number) => void) | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.scene.fog = this.fog;

    const g = createGroundMaterial();
    this.groundUniforms = g.uniforms;
    this.ground = new Mesh(new CircleGeometry(90, 96), g.material);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  get isReady(): boolean {
    return !!this.renderer;
  }

  // ------------------------------------------------------------ structure

  /** Re-derives the L-system and rebuilds both meshes. */
  rebuild(params: StructureParams): TreeBuild {
    const build = buildTree({
      axiom: params.axiom,
      rules: params.rules,
      iterations: params.iterations,
      angle: params.angle,
      step: params.step,
      shrink: params.shrink,
      trunkRadius: params.trunkRadius,
      tropism: params.tropism,
      pipeExponent: params.pipeExponent,
      leafScale: params.leafScale,
      seed: params.seed,
    });

    if (!build.skeleton) return build;

    const geo = buildTreeGeometry(build.skeleton, {
      leafShape: params.leafShape,
      bark: params.barkDetail,
      maxLeaves: MAX_LEAVES,
      leafDensity: params.leafDensity,
    });

    this.disposeMeshes();

    this.branchMesh = new Mesh(geo.branches, this.barkMaterial);
    this.branchMesh.castShadow = true;
    this.branchMesh.receiveShadow = true;
    this.scene.add(this.branchMesh);

    if (geo.foliage) {
      this.leafMesh = new Mesh(geo.foliage, this.leafMaterial);
      this.leafMesh.castShadow = true;
      this.leafMesh.receiveShadow = true;
      this.scene.add(this.leafMesh);
    }

    this.treeHeight = Math.max(1, build.skeleton.height);
    this.treeRadius = Math.max(0.5, build.skeleton.radiusXZ);
    this.updateShadowVolume(Math.max(this.treeRadius, this.treeHeight * 0.6));

    this.stats = {
      ...this.stats,
      modules: build.stats.modules,
      nodes: build.stats.nodes,
      leaves: geo.stats.leafCount,
      branchTriangles: geo.stats.branchTriangles,
      vertices: geo.stats.branchVertices + geo.stats.leafVertices,
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
    this.uniforms.barkDark.value.setHex(palette.barkDark);
    this.uniforms.barkLight.value.setHex(palette.barkLight);
    this.uniforms.barkTwig.value.setHex(palette.twig);
    this.uniforms.barkMoss.value.setHex(palette.moss);
    this.uniforms.leafBase.value.setHex(palette.leafBase);
    this.uniforms.leafTip.value.setHex(palette.leafTip);
    this.uniforms.leafAutumn.value.setHex(palette.leafAutumn);
    this.uniforms.blossom.value.setHex(palette.blossom);
  }

  applyLook(params: LookParams): void {
    const u = this.uniforms;
    u.wind.value = params.wind;
    u.windSpeed.value = params.windSpeed;
    const rad = MathUtils.degToRad(params.windDirection);
    u.windDir.value.set(Math.sin(rad), Math.cos(rad));
    u.autumn.value = params.autumn;
    u.translucency.value = params.translucency;
    u.barkBump.value = params.barkDetail;
    u.mossAmount.value = params.moss;

    if (!this.renderer) return;
    this.renderer.toneMappingExposure = params.exposure;
    this.post.uniforms.bloomStrength.value = params.bloom;
    this.post.uniforms.bokeh.value = params.depthOfField ? 1.6 : 0;
    this.post.setToggles({
      bloom: params.bloom > 0.001,
      dof: params.depthOfField,
      grain: params.grain,
      antialias: params.antialias,
    });
    this.controls.autoRotate = params.autoRotate;
  }

  applySky(params: SkyParams): void {
    const settings: SkySettings = {
      elevation: params.sunElevation,
      azimuth: params.sunAzimuth,
      haze: params.haze,
      intensity: 1,
    };
    this.sky.update(settings);
    this.scene.background = this.sky.texture;
    this.scene.environment = this.sky.texture;
    this.scene.environmentIntensity = 0.42;

    sunDirection(settings, this.sunDir);
    sunColorFor(settings, this.sunTint);

    this.sun.position.copy(this.sunDir).multiplyScalar(45);
    this.sun.target.position.set(0, this.treeHeight * 0.4, 0);
    this.sun.color.copy(this.sunTint);
    // A sun near the horizon travels through more atmosphere, so it dims.
    this.sun.intensity = 4.2 * MathUtils.lerp(0.45, 1, Math.min(1, params.sunElevation / 26)) * (1 - params.haze * 0.35);

    this.uniforms.sunDir.value.copy(this.sunDir);
    this.uniforms.sunColor.value.copy(this.sunTint);

    // Tie the haze and ground horizon to the sky so nothing looks pasted on.
    const horizon = this.sunTint.clone().lerp(new Color(0xcfd8e6), 0.26).multiplyScalar(0.8);
    this.fog.color.copy(horizon);
    this.fog.density = 0.004 + params.haze * 0.013;
    this.groundUniforms.horizon.value.copy(horizon);
    this.fill.intensity = 0.25 + params.haze * 0.3;
  }

  // --------------------------------------------------------------- growth

  setGrowth(value: number): void {
    this.growth = MathUtils.clamp(value, 0, 1);
    this.growthTarget = this.growth;
    this.uniforms.growth.value = this.growth;
    this.onGrowth?.(this.growth);
  }

  playGrowth(from = 0, speed = 0.32): void {
    this.growth = MathUtils.clamp(from, 0, 1);
    this.growthTarget = 1;
    this.growthSpeed = speed;
    this.uniforms.growth.value = this.growth;
  }

  get currentGrowth(): number {
    return this.growth;
  }

  // ---------------------------------------------------------------- frame

  resize(): void {
    if (!this.renderer) return;
    const parent = this.canvas.parentElement;
    const width = parent?.clientWidth || window.innerWidth;
    const height = parent?.clientHeight || window.innerHeight;
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
      this.uniforms.growth.value = this.growth;
      this.onGrowth?.(this.growth);
    }

    this.controls.update();

    // Keep the focal plane on whatever the camera is orbiting.
    const focus = this.camera.position.distanceTo(this.controls.target);
    this.post.uniforms.focusDistance.value = focus;

    this.post.render();

    if (this.pendingCapture) {
      const resolve = this.pendingCapture;
      this.pendingCapture = null;
      resolve(this.canvas.toDataURL('image/png'));
    }

    this.frameTimes.push(dt);
    if (this.frameTimes.length > 45) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.frameTimes.length = 0;
      this.stats = { ...this.stats, fps: Math.round(1 / Math.max(1e-4, avg)) };
      this.onStats?.(this.stats);
    }
  }

  private updateShadowVolume(radius: number): void {
    const cam = this.sun.shadow.camera;
    const r = Math.max(4, radius * 1.35);
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.far = Math.max(60, r * 6);
    cam.updateProjectionMatrix();
    this.sun.target.position.set(0, this.treeHeight * 0.4, 0);
    this.sun.target.updateMatrixWorld();
  }

  private disposeMeshes(): void {
    if (this.branchMesh) {
      this.scene.remove(this.branchMesh);
      this.branchMesh.geometry.dispose();
      this.branchMesh = null;
    }
    if (this.leafMesh) {
      this.scene.remove(this.leafMesh);
      this.leafMesh.geometry.dispose();
      this.leafMesh = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.renderer?.setAnimationLoop(null);
    this.disposeMeshes();
    this.barkMaterial.dispose();
    this.leafMaterial.dispose();
    this.ground.geometry.dispose();
    this.sky.dispose();
    this.post?.dispose();
    this.controls?.dispose();
    this.renderer?.dispose();
  }
}

export { getPreset };
