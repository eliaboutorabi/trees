/**
 * Building a tree, apart from showing it.
 *
 * Deriving the grammar, walking the turtle and baking the meshes is a few
 * hundred milliseconds of pure arithmetic — 650ms for the pine — and none of
 * it needs a renderer, a scene or a material. So it lives here, as a function
 * that takes parameters and returns plain data, and it can run on a worker:
 * see `build.worker.ts`. `Tree.apply` then does the part that has to happen on
 * the main thread, which is only wrapping buffers in meshes.
 *
 * Done on the main thread, that work froze everything on screen — wind,
 * birds, the camera — every time the species changed.
 */
import { BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three';
import { buildTree, type GrammarIssue, type TreeBuild } from './lsystem';
import { MAX_LEAF_IDS } from './materials/shared';
import { findPerches, type Perch } from './perches';
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

export interface BuildLimits {
  maxModules: number;
  maxLeaves: number;
  maxOrnaments: number;
}

/** A built tree, as data. Everything `Tree.apply` needs and nothing it does not. */
export interface TreeData {
  /** False if the grammar produced nothing drawable. */
  ok: boolean;
  issues: GrammarIssue[];
  stats: TreeBuild['stats'];
  height: number;
  radius: number;
  branches: BufferGeometry | null;
  foliage: BufferGeometry | null;
  flowers: BufferGeometry | null;
  fruit: BufferGeometry | null;
  fruitSites: FruitSite[];
  fruitHang: number;
  leaves: { anchors: Float32Array; cullKeys: Float32Array };
  perches: Perch[];
  counts: { branchTriangles: number; leafCount: number; vertices: number; ornamentSites: number };
}

export function computeTree(params: TreeStructure, limits: BuildLimits): TreeData {
  const build = buildTree({ ...params, maxModules: limits.maxModules });
  const empty = {
    branches: null,
    foliage: null,
    flowers: null,
    fruit: null,
    fruitSites: [],
    fruitHang: 0,
    leaves: { anchors: new Float32Array(0), cullKeys: new Float32Array(0) },
    perches: [],
    counts: { branchTriangles: 0, leafCount: 0, vertices: 0, ornamentSites: 0 },
  };
  if (!build.skeleton) {
    return { ok: false, issues: build.issues, stats: build.stats, height: 0, radius: 0, ...empty };
  }

  const geo = buildTreeGeometry(build.skeleton, {
    leafShape: params.leafShape,
    maxLeaves: limits.maxLeaves,
    maxOrnaments: limits.maxOrnaments,
    seed: params.seed,
    fruitShape: params.fruitShape,
    leafIdCapacity: MAX_LEAF_IDS,
  });

  return {
    ok: true,
    issues: build.issues,
    stats: build.stats,
    height: Math.max(1, build.skeleton.height),
    radius: Math.max(0.5, build.skeleton.radiusXZ),
    branches: geo.branches,
    foliage: geo.foliage,
    flowers: geo.flowers,
    fruit: geo.fruit,
    fruitSites: geo.fruitSites,
    fruitHang: geo.fruitHang,
    leaves: geo.leaves,
    perches: findPerches(build.skeleton),
    counts: {
      branchTriangles: geo.stats.branchTriangles,
      leafCount: geo.stats.leafCount,
      vertices: geo.stats.branchVertices + geo.stats.leafVertices,
      ornamentSites: geo.stats.ornamentSites,
    },
  };
}

// ---------------------------------------------------------------- transport
//
// A `BufferGeometry` does not survive `postMessage` as a geometry — structured
// clone keeps the data but drops the class — so geometries cross as their
// arrays, and the arrays are *transferred* rather than copied: tens of
// megabytes change hands in no time, and the worker simply loses them.

interface PackedGeometry {
  attributes: { name: string; array: Float32Array; itemSize: number }[];
  index: Uint16Array | Uint32Array | null;
  sphere: [number, number, number, number] | null;
}

type GeometryKey = 'branches' | 'foliage' | 'flowers' | 'fruit';
const GEOMETRIES: GeometryKey[] = ['branches', 'foliage', 'flowers', 'fruit'];

export type PackedTreeData = Omit<TreeData, GeometryKey> & Record<GeometryKey, PackedGeometry | null>;

function packGeometry(g: BufferGeometry | null, transfer: ArrayBufferLike[]): PackedGeometry | null {
  if (!g) return null;
  const attributes = Object.entries(g.attributes).map(([name, a]) => {
    const array = (a as BufferAttribute).array as Float32Array;
    transfer.push(array.buffer);
    return { name, array, itemSize: a.itemSize };
  });
  const index = g.index ? (g.index.array as Uint16Array | Uint32Array) : null;
  if (index) transfer.push(index.buffer);
  const s = g.boundingSphere;
  return { attributes, index, sphere: s ? [s.center.x, s.center.y, s.center.z, s.radius] : null };
}

function unpackGeometry(p: PackedGeometry | null): BufferGeometry | null {
  if (!p) return null;
  const g = new BufferGeometry();
  for (const a of p.attributes) g.setAttribute(a.name, new BufferAttribute(a.array, a.itemSize));
  if (p.index) g.setIndex(new BufferAttribute(p.index, 1));
  // Carried across rather than recomputed: some meshes widen theirs on purpose
  // to cover what the wind does to them.
  if (p.sphere) g.boundingSphere = new Sphere(new Vector3(p.sphere[0], p.sphere[1], p.sphere[2]), p.sphere[3]);
  return g;
}

export function packTreeData(d: TreeData): { payload: PackedTreeData; transfer: ArrayBufferLike[] } {
  const transfer: ArrayBufferLike[] = [d.leaves.anchors.buffer, d.leaves.cullKeys.buffer];
  const payload = { ...d } as unknown as PackedTreeData;
  for (const k of GEOMETRIES) payload[k] = packGeometry(d[k], transfer);
  return { payload, transfer };
}

export function unpackTreeData(p: PackedTreeData): TreeData {
  const d = { ...p } as unknown as TreeData;
  for (const k of GEOMETRIES) d[k] = unpackGeometry(p[k]);
  return d;
}
