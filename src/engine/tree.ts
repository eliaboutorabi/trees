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
import { Color, Group, Mesh, Vector2, Vector3, Vector4, type BufferGeometry } from 'three';
import type { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { buildTree, type TreeBuild } from './lsystem';
import type { Palette, Preset } from './lsystem/presets';
import { createBarkMaterial } from './materials/bark';
import { createLeafMaterial } from './materials/leaf';
import { createFlowerMaterial, createFruitMaterial, fruitSpecularFor } from './materials/ornament';
import {
  createTreeUniforms,
  LEAF_SLOTS,
  MAX_LEAF_IDS,
  MAX_GUESTS,
  type TreeUniforms,
} from './materials/shared';
import { findPerches, type Perch } from './perches';
import { mulberry32 } from '../lib/rng';
import { buildTreeGeometry, type FruitSite } from './treeGeometry';

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
  /** 0 berry · 1 apple · 2 pine cone. Changes the baked mesh, so it needs a rebuild. */
  fruitShape: 0 | 1 | 2;
}

/** Changes that are uniform-only — applied instantly, no rebuild. */
export interface LiveParams {
  wind?: number;
  windSpeed?: number;
  /** Degrees, clockwise from +Z. */
  windDirection?: number;
  autumn?: number;
  translucency?: number;
  /** Settled snow on the branches and the remaining leaves, 0–1. */
  snow?: number;
  /**
   * Whether the leaves are ready to let go. 0 holds them on however hard the
   * tree is shaken; 1 is autumn. It is a season, not a slider: a summer oak
   * does not shed its canopy because something brushed past it.
   */
  leafFall?: number;
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

/** Fraction of the canopy shed per second in still air, before the breeze. */
const AMBIENT_SHED = 0.00014;
/** Leaves a second from around the hand, at full rustle. */
const SHAKE_LOCAL = 52;
/** And from anywhere else in the crown, because the whole tree trembles. */
const SHAKE_SPILL = 4;
/** Size of the cells leaves are hashed into for picking by place. */
const LEAF_CELL = 0.5;
/** How long a regrowth takes to play out: the shrink, then the grow. */
const REGROW_SECONDS = 2.7;

/** Cells are packed into one number: 1024 per axis, offset to be positive. */
function packCell(x: number, y: number, z: number): number {
  return ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
}
function cellKey(x: number, y: number, z: number): number {
  return packCell(Math.floor(x / LEAF_CELL), Math.floor(y / LEAF_CELL), Math.floor(z / LEAF_CELL));
}

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
  /** Fruit that is still on the tree, so a touch only has to test those. */
  private hangingFruit: FruitSite[] = [];
  /**
   * Per-fruit fall time, or -1 while hanging. Read on the GPU through a uniform
   * array the fruit material indexes by `aFruitId`; see the note there for why
   * this is not a vertex attribute. Fixed length, allocated once — the identity
   * of the array is baked into the material, so it is mutated, never replaced.
   */
  private readonly fallTimes: number[];
  /** Pushes `fallTimes` to the GPU; see `createFruitMaterial`. */
  private readonly syncFall: () => boolean;
  private fallDirty = false;

  /**
   * When each leaf lets go, four to a vec4, across two arrays; -1 while it
   * holds on. Mutated in place, never replaced — their identity is baked into
   * the foliage material. See `MAX_LEAF_IDS`.
   */
  private readonly releaseTimes: [Vector4[], Vector4[]] = [0, 1].map(() =>
    Array.from({ length: LEAF_SLOTS }, () => new Vector4(-1, -1, -1, -1)),
  ) as [Vector4[], Vector4[]];
  private readonly syncLeafFall: () => boolean;
  private releaseDirty = false;
  /** Where each leaf is attached, in id order, and the hash it is culled on. */
  private leafAnchors: Float32Array = new Float32Array(0);
  private leafKeys: Float32Array = new Float32Array(0);
  private leafCount = 0;
  private fallen = new Uint8Array(0);
  /** Leaf ids hashed by cell, for finding the ones near a hand. */
  private leafCells = new Map<number, number[]>();
  /** Every leaf in a fixed shuffled order, for the trickle that comes from anywhere. */
  private anywhere = new Uint32Array(0);
  private anywhereNext = 0;
  private ambientDebt = 0;
  private localDebt = 0;
  private spillDebt = 0;
  private readonly rng = mulberry32(90211);
  /** How hard the crown is being rustled, 0–1, decaying when it stops; and where. */
  private shakeEnergy = 0;
  private readonly shakePoint = new Vector3();
  private shakeRadius = 1;
  /** When the regrowth in progress has played out, or -1 if there is none. */
  private regrowUntil = -1;
  /** Set by the season. Leaves only come off a tree that is ready to drop them. */
  private shedding = 0;
  /** Things sitting in the crown, as xyz + radius. See `setGuests`. */
  private readonly guests: Vector4[] = Array.from({ length: MAX_GUESTS }, () => new Vector4(0, 0, 0, 0));
  private readonly syncGuests: () => boolean;
  private guestsDirty = false;

  /** What the current mesh was baked at, so live sliders can express a ratio. */
  private bakedTrunkRadius = 1;
  private bakedLeafScale = 1;

  height = 0;
  radius = 0;
  /** Branches something small could sit on. Rebuilt with the tree. */
  perches: Perch[] = [];

  constructor(options: TreeOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.uniforms = createTreeUniforms();
    this.fallTimes = new Array(this.options.maxOrnaments).fill(-1);
    this.bark = createBarkMaterial(this.uniforms);
    const foliage = createLeafMaterial(this.uniforms, this.releaseTimes, this.guests);
    this.foliage = foliage.material;
    this.syncLeafFall = foliage.syncFall;
    this.syncGuests = foliage.syncGuests;
    this.flower = createFlowerMaterial(this.uniforms);
    const fruit = createFruitMaterial(this.uniforms, this.fallTimes);
    this.fruit = fruit.material;
    this.syncFall = fruit.syncFall;
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
      fruitShape: params.fruitShape,
      leafIdCapacity: MAX_LEAF_IDS,
    });
    this.indexLeaves(geo.leaves.anchors, geo.leaves.cullKeys);

    // Skin markings belong to the shape, not to a slider: a berry with apple
    // striping on it would look like neither.
    this.uniforms.fruitMarkings.value = params.fruitShape === 1 ? 1 : 0;
    // A cone is dry wood, not skin: no ripening, no blush, no wax.
    this.uniforms.fruitCone.value = params.fruitShape === 2 ? 1 : 0;

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
    this.hangingFruit = geo.fruitSites.slice();
    // A new crop starts on the branch, wherever the last one ended up.
    this.fallTimes.fill(-1);
    this.fallDirty = true;
    this.uniforms.fruitHang.value = geo.fruitHang;

    this.height = Math.max(1, build.skeleton.height);
    this.radius = Math.max(0.5, build.skeleton.radiusXZ);

    // A new tree starts with its leaves on.
    this.regrowLeaves(true);
    this.perches = findPerches(build.skeleton);

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

  /**
   * Advance the clock that falling fruit is timed against.
   *
   * Call it once per frame with the same `dt` used to render. It is a uniform
   * rather than TSL's own `time` because `knockFruit` writes timestamps the
   * shader subtracts from — both sides have to be reading the same clock.
   */
  tick(dt: number): void {
    this.uniforms.fallClock.value += dt;
    // Once a frame at most, and only when something actually came loose.
    if (this.fallDirty && this.syncFall()) this.fallDirty = false;
    if (this.regrowUntil >= 0 && this.uniforms.fallClock.value >= this.regrowUntil) this.finishRegrowth();
    this.advanceShed(dt);
    if (this.releaseDirty && this.syncLeafFall()) this.releaseDirty = false;
    if (this.guestsDirty && this.syncGuests()) this.guestsDirty = false;
  }

  /**
   * Shake loose any fruit within `radius` of `point`, in the tree's own space.
   *
   * Returns how many came off. Each one is stamped with the current clock and
   * dropped from the hanging list, so it is tested once and never again — the
   * cost is proportional to the fruit still on the tree, not to how long the
   * pointer lingers.
   */
  knockFruit(point: Vector3, radius: number): number {
    if (!this.fruitMesh || this.hangingFruit.length === 0) return 0;

    const now = this.uniforms.fallClock.value;
    const density = this.uniforms.fruitDensity.value;
    const r2 = radius * radius;
    let knocked = 0;
    let write = 0;

    for (let i = 0; i < this.hangingFruit.length; i++) {
      const f = this.hangingFruit[i];
      // Fruit culled by the density slider is not drawn, so it cannot be hit.
      const dx = f.x - point.x;
      const dy = f.y - point.y;
      const dz = f.z - point.z;
      if (f.rank <= density && dx * dx + dy * dy + dz * dz <= r2 && f.id < this.fallTimes.length) {
        this.fallTimes[f.id] = now;
        this.fallDirty = true;
        knocked++;
        continue;
      }
      this.hangingFruit[write++] = f;
    }
    this.hangingFruit.length = write;

    return knocked;
  }

  /**
   * Rustle the crown around `point`, in tree space. `amount` is how hard, 0–1;
   * call it every frame the pointer is in the canopy, with more for faster
   * movement.
   *
   * Most of what comes down comes from within `radius` of the hand, nearest
   * first — so shaking one side of the tree thins that side — and a little
   * spills from anywhere in the crown, because a tree shaken on one side
   * trembles all over. Does nothing unless the season has set `leafFall`.
   */
  shakeLeaves(point: Vector3, radius: number, amount: number): void {
    if (this.shedding <= 0) return;
    if (amount >= this.shakeEnergy * 0.5) {
      this.shakePoint.copy(point);
      this.shakeRadius = Math.max(0.3, radius);
    }
    this.shakeEnergy = Math.min(1, Math.max(this.shakeEnergy, amount));
  }

  /**
   * Things sitting in the crown that the foliage should make room for: a
   * perched bird, a lantern hung from a branch. Each is a point in tree space
   * and a radius; the leaves around it fold back and lean away, opening a
   * window from it out toward the open air. Up to `MAX_GUESTS`; pass fewer and
   * the rest are cleared. Ease the radius in and out rather than switching it,
   * or the leaves snap.
   */
  setGuests(list: readonly { x: number; y: number; z: number; radius: number }[]): void {
    for (let i = 0; i < MAX_GUESTS; i++) {
      const g = list[i];
      if (g) this.guests[i].set(g.x, g.y, g.z, g.radius);
      else this.guests[i].set(0, 0, 0, 0);
    }
    this.guestsDirty = true;
  }

  /**
   * Put every leaf back on the tree.
   *
   * Smoothly by default: everything on the ground shrinks away over a second
   * and grows back on its twig over the next one and a half — so a spring
   * after a bare winter comes in rather than switching on. `instant` is for a
   * rebuilt tree, where there is nothing to animate from.
   */
  regrowLeaves(instant = false): void {
    this.finishRegrowth();
    if (instant) {
      for (const half of this.releaseTimes) for (const v of half) v.set(-1, -1, -1, -1);
      this.fallen.fill(0);
      this.uniforms.regrowAt.value = -1e6;
    } else {
      const now = this.uniforms.fallClock.value;
      // Leaves still waiting to drop are simply kept: they have not gone yet.
      for (let id = 0; id < this.leafCount; id++) {
        if (this.fallen[id] && this.releaseTime(id) > now) this.setRelease(id, -1);
      }
      this.uniforms.regrowAt.value = now;
      this.regrowUntil = now + REGROW_SECONDS;
    }
    this.anywhereNext = 0;
    this.ambientDebt = this.localDebt = this.spillDebt = 0;
    this.shakeEnergy = 0;
    this.releaseDirty = true;
  }

  /**
   * Drop the leaves that a sparser canopy no longer has — the ones whose hash
   * sits between `toDensity` and `fromDensity` — staggered over `seconds`, so
   * a tree going into winter sheds instead of thinning out. The default is
   * deliberately long: a whole canopy released over three seconds is a single
   * dense cloud of leaves, which reads as an explosion rather than a season. Call it with the
   * density the canopy is leaving; the density itself can then move at once,
   * since a leaf on its way down is drawn whatever the density says.
   */
  dropLeaves(fromDensity: number, toDensity: number, seconds = 9): number {
    if (toDensity >= fromDensity) return 0;
    const now = this.uniforms.fallClock.value;
    let n = 0;
    for (let id = 0; id < this.leafCount; id++) {
      const k = this.leafKeys[id];
      if (this.fallen[id] || k < toDensity || k >= fromDensity) continue;
      // Spread well past the glide, so a whole canopy comes down as a cascade
      // that carries on while the snow settles, not as one cloud — and loaded
      // a little toward the start, so it begins the moment the season changes.
      this.release(id, now + Math.pow(this.rng(), 1.25) * seconds);
      n++;
    }
    return n;
  }

  /** Once a regrowth has played out, put its leaves back to plain "attached". */
  private finishRegrowth(): void {
    if (this.regrowUntil < 0) return;
    const at = this.uniforms.regrowAt.value;
    for (let id = 0; id < this.leafCount; id++) {
      if (this.fallen[id] && this.releaseTime(id) <= at) {
        this.setRelease(id, -1);
        this.fallen[id] = 0;
      }
    }
    this.regrowUntil = -1;
    this.releaseDirty = true;
  }

  private releaseTime(id: number): number {
    const slot = id >> 2;
    const half = slot < LEAF_SLOTS ? 0 : 1;
    return this.releaseTimes[half][slot - half * LEAF_SLOTS].getComponent(id & 3);
  }

  private setRelease(id: number, at: number): void {
    const slot = id >> 2;
    const half = slot < LEAF_SLOTS ? 0 : 1;
    this.releaseTimes[half][slot - half * LEAF_SLOTS].setComponent(id & 3, at);
    if (at < 0) this.fallen[id] = 0;
    this.releaseDirty = true;
  }

  /** Take in the new tree's leaves: where they are, and a spatial index of them. */
  private indexLeaves(anchors: Float32Array, keys: Float32Array): void {
    this.leafCount = Math.min(keys.length, MAX_LEAF_IDS);
    this.leafAnchors = anchors;
    this.leafKeys = keys;
    this.fallen = new Uint8Array(this.leafCount);

    this.leafCells.clear();
    for (let i = 0; i < this.leafCount; i++) {
      const k = cellKey(anchors[i * 3], anchors[i * 3 + 1], anchors[i * 3 + 2]);
      let list = this.leafCells.get(k);
      if (!list) this.leafCells.set(k, (list = []));
      list.push(i);
    }

    // Fisher–Yates, seeded, so the trickle is in no spatial order at all.
    this.anywhere = new Uint32Array(this.leafCount);
    for (let i = 0; i < this.leafCount; i++) this.anywhere[i] = i;
    for (let i = this.leafCount - 1; i > 0; i--) {
      const j = (this.rng() * (i + 1)) | 0;
      const t = this.anywhere[i];
      this.anywhere[i] = this.anywhere[j];
      this.anywhere[j] = t;
    }
  }

  /** On the tree, and not culled by the density slider. */
  private attached(id: number): boolean {
    return this.fallen[id] === 0 && this.leafKeys[id] < this.uniforms.leafCull.value;
  }

  private release(id: number, at: number): void {
    this.setRelease(id, at);
    this.fallen[id] = 1;
  }

  /** The next leaf in the shuffled order that is still up there. */
  private releaseAnywhere(at: number): boolean {
    while (this.anywhereNext < this.leafCount) {
      const id = this.anywhere[this.anywhereNext++];
      if (this.attached(id)) {
        this.release(id, at);
        return true;
      }
    }
    return false;
  }

  /**
   * A leaf near the hand, nearer ones likelier. Gathers what is in reach once
   * per frame and draws from that, accepting each draw with a falloff from the
   * centre, so the patch that thins is round and soft-edged rather than a
   * sphere cut out of the crown.
   */
  private releaseNear(near: number[], at: number): boolean {
    const { x, y, z } = this.shakePoint;
    const r = this.shakeRadius;
    for (let tries = 0; tries < 16 && near.length; tries++) {
      const k = (this.rng() * near.length) | 0;
      const id = near[k];
      if (!this.attached(id)) {
        near[k] = near[near.length - 1];
        near.pop();
        continue;
      }
      const a = this.leafAnchors;
      const d = Math.hypot(a[id * 3] - x, a[id * 3 + 1] - y, a[id * 3 + 2] - z) / r;
      const falloff = (1 - d) * (1 - d);
      if (this.rng() < falloff) {
        this.release(id, at);
        return true;
      }
    }
    return false;
  }

  private gatherNear(): number[] {
    const { x, y, z } = this.shakePoint;
    const r = this.shakeRadius;
    const n = Math.ceil(r / LEAF_CELL);
    const cx = Math.floor(x / LEAF_CELL);
    const cy = Math.floor(y / LEAF_CELL);
    const cz = Math.floor(z / LEAF_CELL);
    const a = this.leafAnchors;
    const r2 = r * r;
    const out: number[] = [];
    for (let i = -n; i <= n; i++)
      for (let j = -n; j <= n; j++)
        for (let k = -n; k <= n; k++) {
          const list = this.leafCells.get(packCell(cx + i, cy + j, cz + k));
          if (!list) continue;
          for (const id of list) {
            const dx = a[id * 3] - x;
            const dy = a[id * 3 + 1] - y;
            const dz = a[id * 3 + 2] - z;
            if (dx * dx + dy * dy + dz * dz < r2) out.push(id);
          }
        }
    return out;
  }

  /**
   * One frame of shedding.
   *
   * Three streams. A trickle from anywhere in the crown, more in each gust —
   * the gust is the same three sines the crown sways to, so leaves come off as
   * the branches bend. Leaves from around the hand while it is moving through
   * the canopy. And a little spill from anywhere while it does. Each stream
   * accrues fractional leaves and pays them out whole, at a time spread across
   * the frame, so a burst is smooth rather than landing on frame boundaries.
   */
  private advanceShed(dt: number): void {
    const decay = Math.exp(-dt * 1.8);
    if (this.shedding <= 0 || dt <= 0 || this.leafCount === 0) {
      this.shakeEnergy *= decay;
      return;
    }
    const u = this.uniforms;
    const now = u.fallClock.value;
    const t = now * u.windSpeed.value;
    const gust = 0.5 * Math.sin(t) + 0.3 * Math.sin(1.63 * t + 1.3) + 0.2 * Math.sin(0.37 * t);
    const breeze = Math.max(0, 0.38 + 0.62 * gust) * u.wind.value;
    const visible = this.leafCount * u.leafCull.value;
    const at = () => now - dt * this.rng();

    // Capped, so a long frame — a tab coming back — does not dump a pile.
    this.ambientDebt = Math.min(8, this.ambientDebt + this.shedding * AMBIENT_SHED * visible * (0.35 + breeze * 2.2) * dt);
    while (this.ambientDebt >= 1) {
      this.ambientDebt -= 1;
      if (!this.releaseAnywhere(at())) break;
    }

    const e = this.shakeEnergy * this.shedding;
    if (e > 0.01) {
      this.spillDebt = Math.min(8, this.spillDebt + SHAKE_SPILL * e * dt);
      while (this.spillDebt >= 1) {
        this.spillDebt -= 1;
        if (!this.releaseAnywhere(at())) break;
      }

      this.localDebt = Math.min(12, this.localDebt + SHAKE_LOCAL * e * dt);
      if (this.localDebt >= 1) {
        const near = this.gatherNear();
        while (this.localDebt >= 1) {
          this.localDebt -= 1;
          if (!this.releaseNear(near, at())) break;
        }
      }
    }
    this.shakeEnergy *= decay;
  }

  /**
   * Where a point on the tree is right now, given the wind.
   *
   * The same two-step sway the vertex shader applies — a gust front travelling
   * downwind, turned into a lean about the base — evaluated on the CPU against
   * the same clock, so whatever is placed here moves with the wood under it.
   * `flex` is the point's wind weight; `Perch.flex` carries it for perches.
   * Leaf flutter and the pointer's parting are left out: neither moves the
   * twigs anything would sit on.
   */
  swayed(x: number, y: number, z: number, flex: number, out: Vector3): Vector3 {
    const u = this.uniforms;
    const dir = u.windDir.value as Vector2;
    const len = Math.hypot(dir.x, dir.y) || 1;
    const wx = dir.x / len;
    const wz = dir.y / len;

    const t = u.fallClock.value * u.windSpeed.value;
    const travel = (x * wx + z * wz) * 0.2;
    const gust =
      0.5 * Math.sin(t - travel) +
      0.3 * Math.sin(t * 1.63 - travel * 1.7 + 1.3) +
      0.2 * Math.sin(t * 0.37 - travel * 0.5);
    const bend = (gust * 0.62 + 0.38) * u.wind.value * flex * u.windBend.value;

    // Rodrigues about up × wind, which is (wz, 0, -wx).
    const kx = wz;
    const kz = -wx;
    const c = Math.cos(bend);
    const s = Math.sin(bend);
    const dot = kx * x + kz * z;
    return out.set(
      x * c + -kz * y * s + kx * dot * (1 - c),
      y * c + (kz * x - kx * z) * s,
      z * c + kx * y * s + kz * dot * (1 - c),
    );
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
    if (p.snow !== undefined) u.snow.value = p.snow;
    if (p.leafFall !== undefined) this.shedding = p.leafFall;
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
    if (p.fruitGloss !== undefined) {
      u.fruitGloss.value = p.fruitGloss;
      // Not a uniform: see the note in `createFruitMaterial` — the node form of
      // this is inert, so the scalar has to be written directly.
      this.fruit.specularIntensity = fruitSpecularFor(p.fruitGloss);
    }
  }

  /** Build straight from a preset — structure and palette together. */
  applyPreset(preset: Preset, overrides: Partial<TreeStructure> = {}): TreeInfo {
    this.applyPalette(preset.palette);
    return this.rebuild({
      axiom: preset.axiom,
      rules: preset.rules,
      seed: 1337,
      fruitShape: 0,
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
