/**
 * A growable L-system tree you can drop into any three.js scene.
 *
 *   const tree = new Tree();
 *   scene.add(tree.group);
 *   tree.rebuild(getPreset('oak'));
 *   // in your animation loop:
 *   tree.setGrowth(t);
 *
 * It owns four meshes — wood, foliage, flowers, fruit — and the uniforms that
 * drive them. It knows nothing about renderers, cameras, post-processing,
 * lighting or UI frameworks, which is what makes it portable: everything it
 * needs from the outside is a sun direction and a colour, both plain setters.
 *
 * Growth and wind are entirely GPU-side. `setGrowth` moves one uniform; no
 * geometry is rebuilt, and a tree animating from seed to full size costs the
 * same as a static one. Rebuilding is only needed when the *grammar* changes —
 * see `LiveParams` for everything that does not.
 */
import { Color, Group, Mesh, Vector2, Vector3, type BufferGeometry } from 'three';
import type { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { buildTree, type TreeBuild } from './lsystem';
import type { Palette, Preset } from './lsystem/presets';
import { createBarkMaterial } from './materials/bark';
import { createLeafMaterial } from './materials/leaf';
import { createFlowerMaterial, createFruitMaterial } from './materials/ornament';
import { createTreeUniforms, type TreeUniforms } from './materials/shared';
import { buildTreeGeometry } from './treeGeometry';

/** Everything that forces the grammar to be re-derived and the meshes rebuilt. */
export interface TreeStructure {
  axiom: string;
  rules: string;
  iterations: number;
  /** `ANG` — base branching angle, in degrees. */
  angle: number;
  /** `LEN` — base internode length. */
  step: number;
  /** `SHRINK` — per-generation contraction. */
  shrink: number;
  /** Positive grows skyward, negative droops. */
  tropism: number;
  /** da Vinci pipe-model exponent for branch radii. */
  pipeExponent: number;
  seed: number;
  /** Baked as a baseline; `LiveParams.trunkRadius` rescales it without a rebuild. */
  trunkRadius: number;
  /** Likewise baked, then rescaled by `LiveParams.leafScale`. */
  leafScale: number;
  /** 0 broad · 1 needle · 2 blossom · 3 lance. */
  leafShape: 0 | 1 | 2 | 3;
}

/** Changes that are uniform-only — applied instantly, no rebuild. */
export interface LiveParams {
  wind?: number;
  windSpeed?: number;
  /** Degrees, clockwise from +Z. */
  windDirection?: number;
  autumn?: number;
  translucency?: number;
  barkDetail?: number;
  moss?: number;
  occlusionStrength?: number;
  /** Rescaled against what the mesh was baked at. */
  trunkRadius?: number;
  leafScale?: number;
  /** Leaves whose hash exceeds this collapse in the vertex shader. */
  leafDensity?: number;
  flowerDensity?: number;
  flowerSize?: number;
  flowerColor?: Color | string | number;
  flowerCore?: Color | string | number;
  fruitDensity?: number;
  fruitSize?: number;
  fruitColor?: Color | string | number;
  /** 1 keeps `fruitColor` exactly; lower lets green survive on the shaded half. */
  fruitRipeness?: number;
  /** How far the sunward cheek shifts toward orange. */
  fruitBlush?: number;
  /** Waxy rim dust, as on a plum. */
  fruitWax?: number;
  fruitGloss?: number;
}

export interface TreeOptions {
  /** Upper bound on leaves kept from the derived word. */
  maxLeaves?: number;
  /** Sites baked for flowers and fruit; density then culls on the GPU. */
  maxOrnaments?: number;
  /** Cap on derived modules, to bound a runaway grammar. */
  maxModules?: number;
}

export interface TreeInfo extends TreeBuild {
  height: number;
  radius: number;
  branchTriangles: number;
  leafCount: number;
  vertices: number;
  ornamentSites: number;
}

const DEFAULTS: Required<TreeOptions> = {
  maxLeaves: 26_000,
  maxOrnaments: 1_800,
  maxModules: 250_000,
};

function toColor(target: Color, value: Color | string | number): void {
  if (value instanceof Color) target.copy(value);
  else target.set(value as string);
}

export class Tree {
  /** Add this to your scene. */
  readonly group = new Group();
  readonly uniforms: TreeUniforms;

  private readonly options: Required<TreeOptions>;
  private readonly materials: MeshStandardNodeMaterial[];
  private readonly bark: MeshStandardNodeMaterial;
  private readonly foliage: MeshStandardNodeMaterial;
  private readonly flower: MeshStandardNodeMaterial;
  private readonly fruit: MeshPhysicalNodeMaterial;

  private meshes: Mesh[] = [];
  private flowerMesh: Mesh | null = null;
  private fruitMesh: Mesh | null = null;

  /** What the current mesh was baked at, so live sliders can express a ratio. */
  private bakedTrunkRadius = 1;
  private bakedLeafScale = 1;

  height = 0;
  radius = 0;

  constructor(options: TreeOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.uniforms = createTreeUniforms();
    this.bark = createBarkMaterial(this.uniforms);
    this.foliage = createLeafMaterial(this.uniforms);
    this.flower = createFlowerMaterial(this.uniforms);
    this.fruit = createFruitMaterial(this.uniforms);
    this.materials = [this.bark, this.foliage, this.flower, this.fruit];
  }

  /**
   * Re-derive the grammar and rebuild every mesh.
   *
   * Returns the build result including any grammar errors, which are reported
   * rather than thrown — a half-parsed grammar still produces a tree, and an
   * editor wants to show the diagnostics beside it.
   */
  rebuild(params: TreeStructure): TreeInfo {
    const build = buildTree({ ...params, maxModules: this.options.maxModules });

    if (!build.skeleton) {
      return { ...build, height: 0, radius: 0, branchTriangles: 0, leafCount: 0, vertices: 0, ornamentSites: 0 };
    }

    const geo = buildTreeGeometry(build.skeleton, {
      leafShape: params.leafShape,
      maxLeaves: this.options.maxLeaves,
      maxOrnaments: this.options.maxOrnaments,
      seed: params.seed,
    });

    this.bakedTrunkRadius = Math.max(1e-4, params.trunkRadius);
    this.bakedLeafScale = Math.max(1e-4, params.leafScale);

    this.clearMeshes();
    this.addMesh(geo.branches, this.bark);
    this.addMesh(geo.foliage, this.foliage);
    // Ornaments are baked whatever the density, and hidden while it is zero: a
    // collapsed vertex costs nothing to rasterise but still costs a vertex
    // shader invocation, and most trees carry neither flowers nor fruit.
    this.flowerMesh = this.addMesh(geo.flowers, this.flower, this.uniforms.flowerDensity.value > 0.001);
    this.fruitMesh = this.addMesh(geo.fruit, this.fruit, this.uniforms.fruitDensity.value > 0.001);

    this.height = Math.max(1, build.skeleton.height);
    this.radius = Math.max(0.5, build.skeleton.radiusXZ);

    return {
      ...build,
      height: this.height,
      radius: this.radius,
      branchTriangles: geo.stats.branchTriangles,
      leafCount: geo.stats.leafCount,
      vertices: geo.stats.branchVertices + geo.stats.leafVertices,
      ornamentSites: geo.stats.ornamentSites,
    };
  }

  /** 0 = seed, 1 = fully grown. One uniform; nothing is rebuilt. */
  setGrowth(t: number): void {
    this.uniforms.growth.value = Math.min(1, Math.max(0, t));
  }

  /** Direction from a surface *toward* the sun, plus its colour. */
  setSun(direction: Vector3, color: Color): void {
    this.uniforms.sunDir.value.copy(direction);
    this.uniforms.sunColor.value.copy(color);
  }

  /**
   * Where the pointer is touching the tree, in the tree's own space.
   *
   * Not a selection — a soft ball of influence. Foliage and thin branches near
   * `point` part and turn, falling off to nothing at `radius`, so there is
   * nothing to snap between. `strength` is expected to be eased by the caller
   * rather than switched, which is what makes entering and leaving smooth; see
   * `TreeStudio` for the frame-rate independent easing this wants.
   */
  setHover(point: Vector3, radius: number, strength: number): void {
    this.uniforms.hoverPoint.value.copy(point);
    this.uniforms.hoverRadius.value = Math.max(1e-3, radius);
    this.uniforms.hoverStrength.value = Math.min(1, Math.max(0, strength));
  }

  /** Species colours — bark, foliage, blossom, fruit. */
  applyPalette(palette: Palette): void {
    const u = this.uniforms;
    u.barkDark.value.setHex(palette.barkDark);
    u.barkLight.value.setHex(palette.barkLight);
    u.barkTwig.value.setHex(palette.twig);
    u.barkMoss.value.setHex(palette.moss);
    u.lenticels.value = palette.lenticels ?? 0;
    u.leafBase.value.setHex(palette.leafBase);
    u.leafTip.value.setHex(palette.leafTip);
    u.leafAutumn.value.setHex(palette.leafAutumn);
    u.blossom.value.setHex(palette.blossom);
    if (palette.flowerColor !== undefined) u.flowerColor.value.setHex(palette.flowerColor);
    if (palette.flowerCore !== undefined) u.flowerCore.value.setHex(palette.flowerCore);
    if (palette.fruitColor !== undefined) u.fruitColor.value.setHex(palette.fruitColor);
  }

  /** Everything that does not need a rebuild. Undefined fields are left alone. */
  applyLook(p: LiveParams): void {
    const u = this.uniforms;
    if (p.wind !== undefined) u.wind.value = p.wind;
    if (p.windSpeed !== undefined) u.windSpeed.value = p.windSpeed;
    if (p.windDirection !== undefined) {
      const rad = (p.windDirection * Math.PI) / 180;
      (u.windDir.value as Vector2).set(Math.sin(rad), Math.cos(rad));
    }
    if (p.autumn !== undefined) u.autumn.value = p.autumn;
    if (p.translucency !== undefined) u.translucency.value = p.translucency;
    if (p.barkDetail !== undefined) u.barkBump.value = p.barkDetail;
    if (p.moss !== undefined) u.mossAmount.value = p.moss;
    if (p.occlusionStrength !== undefined) u.occlusionStrength.value = p.occlusionStrength;
    if (p.trunkRadius !== undefined) u.radiusScale.value = p.trunkRadius / this.bakedTrunkRadius;
    if (p.leafScale !== undefined) u.leafSize.value = p.leafScale / this.bakedLeafScale;
    if (p.leafDensity !== undefined) u.leafCull.value = p.leafDensity;

    if (p.flowerDensity !== undefined) {
      u.flowerDensity.value = p.flowerDensity;
      if (this.flowerMesh) this.flowerMesh.visible = p.flowerDensity > 0.001;
    }
    if (p.flowerSize !== undefined) u.flowerSize.value = p.flowerSize;
    if (p.flowerColor !== undefined) toColor(u.flowerColor.value, p.flowerColor);
    if (p.flowerCore !== undefined) toColor(u.flowerCore.value, p.flowerCore);

    if (p.fruitDensity !== undefined) {
      u.fruitDensity.value = p.fruitDensity;
      if (this.fruitMesh) this.fruitMesh.visible = p.fruitDensity > 0.001;
    }
    if (p.fruitSize !== undefined) u.fruitSize.value = p.fruitSize;
    if (p.fruitColor !== undefined) toColor(u.fruitColor.value, p.fruitColor);
    if (p.fruitRipeness !== undefined) u.fruitRipeness.value = p.fruitRipeness;
    if (p.fruitBlush !== undefined) u.fruitBlush.value = p.fruitBlush;
    if (p.fruitWax !== undefined) u.fruitWax.value = p.fruitWax;
    if (p.fruitGloss !== undefined) u.fruitGloss.value = p.fruitGloss;
  }

  /** Build straight from a preset — structure and palette together. */
  applyPreset(preset: Preset, overrides: Partial<TreeStructure> = {}): TreeInfo {
    this.applyPalette(preset.palette);
    return this.rebuild({
      axiom: preset.axiom,
      rules: preset.rules,
      seed: 1337,
      ...preset.params,
      ...overrides,
    });
  }

  setCastShadow(cast: boolean): void {
    for (const mesh of this.meshes) mesh.castShadow = cast;
  }

  setReceiveShadow(receive: boolean): void {
    for (const mesh of this.meshes) mesh.receiveShadow = receive;
  }

  dispose(): void {
    this.clearMeshes();
    for (const material of this.materials) material.dispose();
  }

  private addMesh(geometry: BufferGeometry | null, material: MeshStandardNodeMaterial, visible = true): Mesh | null {
    if (!geometry) return null;
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = visible;
    this.group.add(mesh);
    this.meshes.push(mesh);
    return mesh;
  }

  private clearMeshes(): void {
    for (const mesh of this.meshes) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes = [];
    this.flowerMesh = null;
    this.fruitMesh = null;
  }
}
