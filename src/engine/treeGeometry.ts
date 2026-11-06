/**
 * Turns a branch skeleton into two draw calls: one tube mesh for the wood and
 * one merged mesh for the foliage.
 *
 * Both meshes carry the same custom attributes, so a single TSL growth program
 * animates them:
 *
 *   aOrigin  the point this vertex sprouts from (previous ring centre, or the
 *            leaf's anchor) — vertices start collapsed here
 *   aCenter  the pivot the vertex finally orbits (its own ring centre)
 *   aParams  (birth, flex, seed, occlusion), packed into one vec4 because
 *            WebGPU only guarantees 8 vertex buffers
 */
import { BufferAttribute, BufferGeometry, Quaternion, Vector3 } from 'three';
import type { LeafPlacement, Skeleton } from './lsystem/turtle';
import { CanopyOcclusion } from './occlusion';
import { emitBase, planRoots, type RootPlan, type TrunkSampler } from './roots';
import { computeSway, flexOf, pack, type Sway } from './sway';

export interface TreeGeometryOptions {
  /** 0 broad · 1 needle · 2 blossom · 3 lance. */
  leafShape: 0 | 1 | 2 | 3;
  maxLeaves: number;
  /** Sites baked for flowers and for fruit. Density then culls on the GPU. */
  maxOrnaments?: number;
  /** Seeds the root flare, so Shuffle reshuffles the buttress too. */
  seed?: number;
  /** 0 berry · 1 apple · 2 pine cone. */
  fruitShape?: 0 | 1 | 2;
  /**
   * How many leaves the host can track individually. Leaves past this get an
   * id of -1 and simply never fall.
   */
  leafIdCapacity?: number;
}

/**
 * Silhouette irregularity is baked in at a fixed amount. Exposing it as a
 * slider would mean a rebuild on every drag, and the same look is available
 * live through the bark-relief shading instead.
 */
const SILHOUETTE_WOBBLE = 0.55;

/** One piece of fruit, so the host can knock it loose by touching it. */
export interface FruitSite {
  /** Where it hangs, in the tree's own space. */
  x: number;
  y: number;
  z: number;
  /** Its rank in [0, 1); above the density uniform it is culled and untouchable. */
  rank: number;
  /** Index into the fall-time array the material reads. */
  id: number;
}

export interface TreeGeometryResult {
  branches: BufferGeometry;
  foliage: BufferGeometry | null;
  flowers: BufferGeometry | null;
  fruit: BufferGeometry | null;
  fruitSites: FruitSite[];
  /**
   * How far the fruit body hangs below its anchor, at the size it was baked.
   * A falling fruit has to stop when its *tip* reaches the ground, not when its
   * attachment point does, or it buries itself.
   */
  fruitHang: number;
  /**
   * Every leaf in the foliage mesh, in the order of its `aLeafId`: where it is
   * attached, and the hash the density slider culls it on. Lets the host pick
   * leaves by place — the ones near a hand — without reading the mesh back.
   */
  leaves: { anchors: Float32Array; cullKeys: Float32Array };
  stats: {
    branchVertices: number;
    branchTriangles: number;
    leafCount: number;
    leafVertices: number;
    ornamentSites: number;
  };
}

interface Buffers {
  position: number[];
  normal: number[];
  uv: number[];
  origin: number[];
  center: number[];
  birth: number[];
  flex: number[];
  seed: number[];
  occlusion: number[];
  index: number[];
}

function newBuffers(): Buffers {
  return {
    position: [],
    normal: [],
    uv: [],
    origin: [],
    center: [],
    birth: [],
    flex: [],
    seed: [],
    occlusion: [],
    index: [],
  };
}

function toGeometry(b: Buffers): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(b.position), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(b.normal), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(b.uv), 2));
  g.setAttribute('aOrigin', new BufferAttribute(new Float32Array(b.origin), 3));
  g.setAttribute('aCenter', new BufferAttribute(new Float32Array(b.center), 3));

  // WebGPU guarantees only 8 vertex buffers, and one attribute per scalar blows
  // straight through that. The four per-vertex scalars ride in a single vec4.
  const count = b.birth.length;
  const params = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    params[i * 4] = b.birth[i];
    params[i * 4 + 1] = b.flex[i];
    params[i * 4 + 2] = b.seed[i];
    params[i * 4 + 3] = b.occlusion[i];
  }
  g.setAttribute('aParams', new BufferAttribute(params, 4));

  g.setIndex(b.index);
  g.computeBoundingSphere();
  // Wind pushes vertices past their resting position; keep them from popping.
  if (g.boundingSphere) g.boundingSphere.radius *= 1.25;
  return g;
}

/** Radial resolution for a strand, from its thickness relative to the trunk. */
function radialSegmentsFor(ratio: number): number {
  if (ratio < 0.03) return 3;
  if (ratio < 0.08) return 4;
  if (ratio < 0.15) return 6;
  if (ratio < 0.25) return 10;
  if (ratio < 0.45) return 16;
  return 24;
}

/**
 * Around the trunk. Far more than its silhouette needs, because the base sweeps
 * one column per trunk segment out across the roots, and a root a metre out
 * subtends only a few degrees.
 */
const TRUNK_SEGMENTS = 128;

/**
 * Resample a strand through its nodes as a smooth curve.
 *
 * The turtle steps in straight lines and turns at each node, so a tube built
 * on its nodes alone is a chain of straight pipes with a crease at every
 * joint — on a twig too short to see, on a trunk the first thing anyone sees.
 * So thick strands are drawn through their nodes as a centripetal Catmull-Rom
 * spline, subdivided until a piece is not much longer than the strand is
 * thick. The nodes themselves stay on the curve, so forks and leaves stay
 * attached exactly where the turtle put them.
 */
interface StrandSamples {
  centers: number[];
  radii: number[];
  arcs: number[];
  flex: number[];
  pend: number[];
}

function resampleStrand(src: StrandSamples, minPiece: number, seed: number, out: StrandSamples): void {
  const { centers, radii, arcs, flex, pend } = src;
  const n = radii.length;
  out.centers.length = 0;
  out.radii.length = 0;
  out.arcs.length = 0;
  out.flex.length = 0;
  out.pend.length = 0;
  const at = (i: number, c: number) => centers[Math.min(n - 1, Math.max(0, i)) * 3 + c];
  for (let i = 0; i < n - 1; i++) {
    const len = Math.hypot(at(i + 1, 0) - at(i, 0), at(i + 1, 1) - at(i, 1), at(i + 1, 2) - at(i, 2));
    const r = Math.max(1e-5, (radii[i] + radii[i + 1]) * 0.5);
    const pieces = Math.min(6, Math.max(1, Math.ceil(len / Math.max(minPiece, r * 1.4))));
    // Centripetal knots: the parameterisation that cannot overshoot into a
    // loop at a sharp turn.
    const knot = (a: number, b: number) =>
      Math.max(1e-6, Math.pow(Math.hypot(at(b, 0) - at(a, 0), at(b, 1) - at(a, 1), at(b, 2) - at(a, 2)), 0.5));
    const t0 = 0;
    const t1 = t0 + (i > 0 ? knot(i - 1, i) : knot(i, i + 1));
    const t2 = t1 + knot(i, i + 1);
    const t3 = t2 + (i + 2 < n ? knot(i + 1, i + 2) : knot(i, i + 1));
    // A long internode is not a ruled line either. Wood grows toward light
    // and away from load a little differently each season, so a span bows
    // gently between the places where it forks — never at them, so whatever
    // grows from a node stays on it.
    const h = Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453;
    const spin = (h - Math.floor(h)) * Math.PI * 2;
    const bow = Math.min(r * 0.45, len * 0.04);
    const sx = at(i + 1, 0) - at(i, 0);
    const sy = at(i + 1, 1) - at(i, 1);
    const sz = at(i + 1, 2) - at(i, 2);
    // A direction across the span: any perpendicular, turned by `spin`.
    let ux = -sz;
    let uy = 0;
    let uz = sx;
    let ul = Math.hypot(ux, uy, uz);
    if (ul < 1e-6) {
      ux = 1;
      uz = 0;
      ul = 1;
    }
    ux /= ul;
    uz /= ul;
    const sl = Math.max(1e-6, len);
    const vx = (sy * uz - sz * uy) / sl;
    const vy = (sz * ux - sx * uz) / sl;
    const vz = (sx * uy - sy * ux) / sl;
    const bx = (ux * Math.cos(spin) + vx * Math.sin(spin)) * bow;
    const by = (uy * Math.cos(spin) + vy * Math.sin(spin)) * bow;
    const bz = (uz * Math.cos(spin) + vz * Math.sin(spin)) * bow;
    for (let s = 0; s < pieces; s++) {
      const f = s / pieces;
      if (s === 0) {
        out.centers.push(at(i, 0), at(i, 1), at(i, 2));
      } else {
        const t = t1 + (t2 - t1) * f;
        for (let c = 0; c < 3; c++) {
          // Ends with no neighbour are reflected, so the curve leaves them straight.
          const p0 = i > 0 ? at(i - 1, c) : 2 * at(i, c) - at(i + 1, c);
          const p1 = at(i, c);
          const p2 = at(i + 1, c);
          const p3 = i + 2 < n ? at(i + 2, c) : 2 * at(i + 1, c) - at(i, c);
          const a1 = ((t1 - t) * p0 + (t - t0) * p1) / (t1 - t0);
          const a2 = ((t2 - t) * p1 + (t - t1) * p2) / (t2 - t1);
          const a3 = ((t3 - t) * p2 + (t - t2) * p3) / (t3 - t2);
          const b1 = ((t2 - t) * a1 + (t - t0) * a2) / (t2 - t0);
          const b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1);
          out.centers.push(((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1));
        }
        const lift = Math.sin(Math.PI * f);
        const o = out.centers.length - 3;
        out.centers[o] += bx * lift;
        out.centers[o + 1] += by * lift;
        out.centers[o + 2] += bz * lift;
      }
      // Radius eases between nodes rather than stepping, never past either.
      const e = f * f * (3 - 2 * f);
      out.radii.push(radii[i] + (radii[i + 1] - radii[i]) * e);
      out.arcs.push(arcs[i] + (arcs[i + 1] - arcs[i]) * f);
      out.flex.push(flex[i] + (flex[i + 1] - flex[i]) * f);
      out.pend.push(pend[i] + (pend[i + 1] - pend[i]) * f);
    }
  }
  out.centers.push(at(n - 1, 0), at(n - 1, 1), at(n - 1, 2));
  out.radii.push(radii[n - 1]);
  out.arcs.push(arcs[n - 1]);
  out.flex.push(flex[n - 1]);
  out.pend.push(pend[n - 1]);
}

/**
 * Coherent surface wobble. Independent per-vertex noise shatters the tube into
 * visible facets, so this is a smooth function of angle and distance along the
 * strand instead — it reads as an irregular trunk rather than as noise.
 */
function silhouetteWobble(seed: number, along: number, angle: number): number {
  return (
    Math.sin(angle * 3 + seed * 6.28 + along * 0.9) * 0.55 +
    Math.sin(angle * 5 - seed * 3.11 - along * 0.55) * 0.3 +
    Math.sin(angle * 8 + seed * 1.7 + along * 1.7) * 0.15
  );
}

export function buildTreeGeometry(skel: Skeleton, opts: TreeGeometryOptions): TreeGeometryResult {
  // Foliage has to be chosen first: the occlusion field is built from the
  // leaves that actually survive thinning, and the branches sample it too.
  const template = leafTemplate(opts.leafShape);
  const blossomTpl = opts.leafShape === 2 ? template : leafTemplate(2);
  const kept = selectLeaves(skel, opts);
  const field = buildOcclusionField(skel, kept, template, blossomTpl);

  // The flare and the roots are one structure, so they share one plan: the
  // trunk bulges toward each root's bearing and each root leaves from inside
  // its own bulge.
  const plan = planRoots(skel.radius[0] ?? skel.maxRadius, skel.height, opts.seed ?? 1337);
  const sway = computeSway(skel);
  const branches = buildBranches(skel, field, plan, sway);
  const foliage = buildFoliage(skel, kept, template, blossomTpl, field, sway);

  // Flowers and fruit hang off the same attachment points as the leaves, so any
  // species can carry them without the grammar knowing anything about it.
  const sites = selectOrnamentSites(kept, opts.maxOrnaments ?? 2600);
  const flowers = buildOrnaments(skel, sites, flowerTemplate(), field, sway, { droop: 0 });
  // A berry is a sphere and can point anywhere, but an apple and a cone both
  // have a top and a bottom, so they hang upright rather than inheriting
  // whatever rotation the leaf beside them happened to get.
  const shape = opts.fruitShape ?? 0;
  const axial = shape !== 0;
  const fruitTpl = shape === 2 ? coneTemplate() : shape === 1 ? appleTemplate() : berryTemplate();
  const fruit = buildOrnaments(skel, sites, fruitTpl, field, sway, {
    droop: shape === 1 ? 1.25 : shape === 2 ? 0.55 : 1.05,
    seedShift: 0.37,
    upright: axial,
  });

  const fruitGeo = fruit ? toGeometry(fruit) : null;
  const perFruit = fruitTpl.position.length / 3;
  const fruitSites: FruitSite[] = fruitGeo
    ? sites.map((site, i) => ({
        x: site.leaf.pos.x,
        // The body hangs below its anchor, so aim at the middle of it.
        y: site.leaf.pos.y - (shape === 1 ? 1.25 : shape === 2 ? 0.55 : 1.05) * site.leaf.scale * 0.5,
        z: site.leaf.pos.z,
        rank: site.rank,
        id: i,
      }))
    : [];
  let fruitHang = 0;
  if (fruitGeo) {
    /*
     * Which piece of fruit each vertex belongs to — a *static* index, written
     * once and never touched again.
     *
     * The obvious design was to store the fall time itself here and rewrite it
     * when the fruit was knocked. That does not work: on this renderer, mutating
     * a geometry attribute after the mesh has drawn never reaches the GPU. It is
     * not specific to one attribute either — lifting half the fruit by rewriting
     * `aCenter` and `position` moved nothing on screen, while the same values
     * supplied at build time render fine. So the id is baked here and the
     * mutable half lives in a uniform array the material indexes into, which
     * three re-syncs from its backing JS array every render.
     */
    const count = fruitGeo.getAttribute('position').count;
    const ids = new Float32Array(count);
    for (let i = 0; i < sites.length; i++) {
      for (let v = i * perFruit; v < (i + 1) * perFruit && v < count; v++) ids[v] = i;
    }
    fruitGeo.setAttribute('aFruitId', new BufferAttribute(ids, 1));

    const pos = fruit!.position;
    const cen = fruit!.center;
    for (let i = 1; i < pos.length; i += 3) {
      const below = cen[i] - pos[i];
      if (below > fruitHang) fruitHang = below;
    }
  }

  // Which leaf each foliage vertex belongs to, and the leaves' own table.
  const capacity = opts.leafIdCapacity ?? Infinity;
  let foliageGeo: BufferGeometry | null = null;
  const anchors = new Float32Array(kept.length * 3);
  const cullKeys = new Float32Array(kept.length);
  kept.forEach((leaf, i) => {
    anchors[i * 3] = leaf.pos.x;
    anchors[i * 3 + 1] = leaf.pos.y;
    anchors[i * 3 + 2] = leaf.pos.z;
    // The same hash the leaf shader culls on: fract(rawSeed · 97.31), where a
    // blossom's raw seed is offset by 2.
    const raw = leaf.kind === 1 ? leaf.seed + 2 : leaf.seed;
    cullKeys[i] = (raw * 97.31) % 1;
  });
  if (foliage) {
    foliageGeo = toGeometry(foliage.buf);
    const ids = Float32Array.from(foliage.ids, (id) => (id < capacity ? id : -1));
    foliageGeo.setAttribute('aLeafId', new BufferAttribute(ids, 1));
  }

  return {
    branches: toGeometry(branches.buf),
    foliage: foliageGeo,
    leaves: { anchors, cullKeys },
    flowers: flowers ? toGeometry(flowers) : null,
    fruit: fruitGeo,
    fruitSites,
    fruitHang,
    stats: {
      branchVertices: branches.buf.position.length / 3,
      branchTriangles: branches.buf.index.length / 3,
      leafCount: foliage?.count ?? 0,
      leafVertices: foliage ? foliage.buf.position.length / 3 : 0,
      ornamentSites: sites.length,
    },
  };
}

/**
 * Pick the sites that can carry a flower or a fruit, ordered so that the
 * density slider only ever adds.
 *
 * Each site gets a rank in [0, 1) which the shader compares against the density
 * uniform. Ranks are assigned in hash order rather than in placement order, so
 * a low density scatters a few ornaments through the whole crown instead of
 * clustering them on whichever branch happened to be built first.
 */
function selectOrnamentSites(kept: LeafPlacement[], max: number): { leaf: LeafPlacement; rank: number }[] {
  if (kept.length === 0 || max <= 0) return [];
  const ranked = kept.map((leaf, i) => ({ leaf, key: Math.sin(i * 12.9898 + leaf.seed * 78.233) * 43758.5453 }));
  ranked.sort((a, b) => (a.key - Math.floor(a.key)) - (b.key - Math.floor(b.key)));
  // Capped as a fraction of the canopy as well as absolutely. A fixed site
  // count puts as many apples on a sparse tree as on a dense one, and on the
  // sparse one that means a fruit on nearly every leaf.
  const take = Math.min(max, Math.ceil(ranked.length * 0.45));
  const sites: { leaf: LeafPlacement; rank: number }[] = [];
  for (let i = 0; i < take; i++) sites.push({ leaf: ranked[i].leaf, rank: (i + 0.5) / take });
  return sites;
}

function buildOrnaments(
  skel: Skeleton,
  sites: { leaf: LeafPlacement; rank: number }[],
  tpl: LeafTemplate,
  field: CanopyOcclusion,
  sway: Sway,
  opts: { droop: number; seedShift?: number; upright?: boolean },
): Buffers | null {
  if (sites.length === 0) return null;

  const buf = newBuffers();
  const maxArc = Math.max(1e-5, skel.maxArc);
  const v = new Vector3();
  const nrm = new Vector3();
  const shift = opts.seedShift ?? 0;
  const quat = new Quaternion();
  const tilt = new Quaternion();
  const AXIS_Y = new Vector3(0, 1, 0);

  for (const { leaf, rank } of sites) {
    const base = buf.position.length / 3;
    const scale = leaf.scale;
    // Ornaments arrive a little after the leaves that share their twig.
    const birth = Math.min(1, leaf.arc / maxArc + 0.04);
    const occlusion = field.sample(leaf.pos.x, leaf.pos.y, leaf.pos.z);
    // Exactly what its twig does.
    const flex = pack(sway.flex[leaf.node], sway.pend[leaf.node]);
    // Fruit hangs straight down whatever the twig is doing, so the droop is
    // applied in world space after the placement rotation. It scales with the
    // ornament because the pivot stays at the anchor: bigger fruit hangs lower.
    const drop = opts.droop * scale;

    // Upright fruit keeps its own axis: a spin about vertical so no two are
    // turned the same way, plus a few degrees of lean, because a real apple
    // hangs slightly askew and a grove of perfectly plumb ones looks stamped.
    let orient = leaf.quat;
    if (opts.upright) {
      const h = Math.sin(rank * 127.1 + leaf.seed * 311.7) * 43758.5453;
      const spin = (h - Math.floor(h)) * Math.PI * 2;
      const g = Math.sin(rank * 269.5 + leaf.seed * 183.3) * 43758.5453;
      const lean = ((g - Math.floor(g)) - 0.5) * 0.42;
      quat.setFromAxisAngle(AXIS_Y, spin);
      tilt.setFromAxisAngle(v.set(Math.cos(spin * 1.7), 0, Math.sin(spin * 1.7)), lean);
      orient = quat.premultiply(tilt);
    }

    for (let i = 0; i < tpl.position.length; i += 3) {
      v.set(tpl.position[i], tpl.position[i + 1], tpl.position[i + 2])
        .multiplyScalar(scale)
        .applyQuaternion(orient)
        .add(leaf.pos);
      v.y -= drop;
      nrm.set(tpl.normal[i], tpl.normal[i + 1], tpl.normal[i + 2]).applyQuaternion(orient);

      buf.position.push(v.x, v.y, v.z);
      buf.normal.push(nrm.x, nrm.y, nrm.z);
      buf.origin.push(leaf.pos.x, leaf.pos.y, leaf.pos.z);
      buf.center.push(leaf.pos.x, leaf.pos.y, leaf.pos.z);
      buf.birth.push(birth);
      buf.flex.push(flex);
      // The seed slot carries the rank. Per-ornament colour variation is hashed
      // back out of it in the shader, so one scalar does both jobs.
      buf.seed.push((rank + shift) % 1);
      buf.occlusion.push(occlusion);
    }
    for (let i = 0; i < tpl.uv.length; i++) buf.uv.push(tpl.uv[i]);
    for (let i = 0; i < tpl.index.length; i++) buf.index.push(base + tpl.index[i]);
  }

  return buf;
}

/** Total surface area of a leaf template, used to weight the occlusion field. */
function templateArea(tpl: LeafTemplate): number {
  const p = tpl.position;
  let total = 0;
  for (let t = 0; t < tpl.index.length; t += 3) {
    const a = tpl.index[t] * 3;
    const b = tpl.index[t + 1] * 3;
    const c = tpl.index[t + 2] * 3;
    const abx = p[b] - p[a];
    const aby = p[b + 1] - p[a + 1];
    const abz = p[b + 2] - p[a + 2];
    const acx = p[c] - p[a];
    const acy = p[c + 1] - p[a + 1];
    const acz = p[c + 2] - p[a + 2];
    const cx = aby * acz - abz * acy;
    const cy = abz * acx - abx * acz;
    const cz = abx * acy - aby * acx;
    total += Math.hypot(cx, cy, cz) * 0.5;
  }
  return total;
}

/** Deterministic thinning: keep an evenly spaced subset of the placements. */
function selectLeaves(skel: Skeleton, opts: TreeGeometryOptions): LeafPlacement[] {
  const all = skel.leaves;
  if (all.length === 0) return [];
  const wanted = Math.min(opts.maxLeaves, all.length);
  if (wanted <= 0) return [];

  const stride = all.length / wanted;
  const kept: LeafPlacement[] = [];
  for (let i = 0; i < wanted; i++) kept.push(all[Math.min(all.length - 1, Math.floor(i * stride))]);
  return kept;
}

function buildOcclusionField(
  skel: Skeleton,
  kept: LeafPlacement[],
  blade: LeafTemplate,
  blossom: LeafTemplate,
): CanopyOcclusion {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < skel.count; i++) {
    min.x = Math.min(min.x, skel.pos[i * 3]);
    min.y = Math.min(min.y, skel.pos[i * 3 + 1]);
    min.z = Math.min(min.z, skel.pos[i * 3 + 2]);
    max.x = Math.max(max.x, skel.pos[i * 3]);
    max.y = Math.max(max.y, skel.pos[i * 3 + 1]);
    max.z = Math.max(max.z, skel.pos[i * 3 + 2]);
  }
  if (!Number.isFinite(min.x)) {
    min.set(-1, -1, -1);
    max.set(1, 1, 1);
  }

  const field = new CanopyOcclusion(min, max);
  const bladeArea = templateArea(blade);
  const blossomArea = templateArea(blossom);
  for (const leaf of kept) {
    const area = (leaf.kind === 1 ? blossomArea : bladeArea) * leaf.scale * leaf.scale;
    field.addArea(leaf.pos.x, leaf.pos.y, leaf.pos.z, area);
  }
  field.finalize();
  return field;
}

// ---------------------------------------------------------------- branches

function buildBranches(skel: Skeleton, field: CanopyOcclusion, plan: RootPlan, sway: Sway): { buf: Buffers } {
  const buf = newBuffers();
  const { pos, parent, radius, arc, count } = skel;
  if (count === 0) return { buf };

  // Child lists in CSR form.
  const childCount = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const p = parent[i];
    if (p >= 0) childCount[p]++;
  }
  const childStart = new Int32Array(count + 1);
  for (let i = 0; i < count; i++) childStart[i + 1] = childStart[i] + childCount[i];
  const cursor = childStart.slice(0, count);
  const childList = new Int32Array(childStart[count]);
  for (let i = 0; i < count; i++) {
    const p = parent[i];
    if (p >= 0) childList[cursor[p]++] = i;
  }

  // The thickest child continues the strand; the rest fork off.
  const continuation = new Int32Array(count).fill(-1);
  for (let i = 0; i < count; i++) {
    let best = -1;
    let bestR = -1;
    for (let k = childStart[i]; k < childStart[i + 1]; k++) {
      const c = childList[k];
      if (radius[c] > bestR) {
        bestR = radius[c];
        best = c;
      }
    }
    continuation[i] = best;
  }

  const rootRadius = Math.max(1e-5, skel.maxRadius);
  const maxArc = Math.max(1e-5, skel.maxArc);
  const heightRef = Math.max(0.5, skel.height);

  const raw = { centers: [] as number[], radii: [] as number[], arcs: [] as number[], flex: [] as number[], pend: [] as number[] };
  const smooth = { centers: [] as number[], radii: [] as number[], arcs: [] as number[], flex: [] as number[], pend: [] as number[] };

  const emitStrand = (ring: number[], firstRadiusCap: number, strandSeed: number, isTrunk = false) => {
    if (ring.length < 2) return;

    raw.centers.length = 0;
    raw.radii.length = 0;
    raw.arcs.length = 0;
    raw.flex.length = 0;
    raw.pend.length = 0;
    let maxR = 0;
    for (let i = 0; i < ring.length; i++) {
      const node = ring[i];
      raw.centers.push(pos[node * 3], pos[node * 3 + 1], pos[node * 3 + 2]);
      const r = i === 0 ? Math.min(radius[node], firstRadiusCap) : radius[node];
      raw.radii.push(r);
      raw.arcs.push(arc[node]);
      raw.flex.push(sway.flex[node]);
      raw.pend.push(sway.pend[node]);
      if (r > maxR) maxR = r;
    }

    // Anything thick enough to show its joints is drawn as a curve.
    const curved = maxR / rootRadius >= 0.12;
    let centers = raw.centers;
    let radii = raw.radii;
    let arcs = raw.arcs;
    let flexes = raw.flex;
    let pends = raw.pend;
    if (curved) {
      resampleStrand(raw, rootRadius * 0.5, strandSeed, smooth);
      centers = smooth.centers;
      radii = smooth.radii;
      arcs = smooth.arcs;
      flexes = smooth.flex;
      pends = smooth.pend;
    }

    // The trunk's foot is the base's job. Find where it hands over, and start
    // the tube there; below that the base wraps a trunk sampled from the
    // same curve.
    let first = 0;
    let sampler: TrunkSampler | null = null;
    if (isTrunk) {
      sampler = trunkSampler(centers, radii, arcs, flexes, strandSeed);
      if (sampler) {
        first = insertJunction(centers, radii, arcs, flexes, pends, plan.top);
        if (first < 0) {
          sampler = null;
          first = 0;
        }
      }
    }

    const n = radii.length;
    const segs = isTrunk ? TRUNK_SEGMENTS : radialSegmentsFor(maxR / rootRadius);
    const ringVerts = segs + 1;
    const base = buf.position.length / 3;

    // Parallel-transport frame so the tube does not twist along its length.
    const tangent = new Vector3();
    const nextT = new Vector3();
    const normalA = new Vector3();
    const normalB = new Vector3();
    const dir = new Vector3();
    const vNormal = new Vector3();

    tangentAt(centers, first, n, tangent);
    perpendicular(tangent, normalA);
    normalB.crossVectors(tangent, normalA).normalize();

    const ringPositions: number[] = [];
    const ringNormals: number[] = [];

    for (let i = first; i < n; i++) {
      if (i > first) {
        tangentAt(centers, i, n, nextT);
        // Rotate the frame minimally onto the new tangent.
        normalA.addScaledVector(nextT, -normalA.dot(nextT));
        if (normalA.lengthSq() < 1e-10) perpendicular(nextT, normalA);
        else normalA.normalize();
        normalB.crossVectors(nextT, normalA).normalize();
        tangent.copy(nextT);
      }

      const cx = centers[i * 3];
      const cy = centers[i * 3 + 1];
      const cz = centers[i * 3 + 2];
      const r = radii[i];
      const a = arcs[i];

      // Where this ring grows out of — the previous ring's centre.
      const oi = Math.max(first, i - 1);
      const ox = centers[oi * 3];
      const oy = centers[oi * 3 + 1];
      const oz = centers[oi * 3 + 2];

      const birth = Math.min(1, a / maxArc);
      const occlusion = field.sample(cx, cy, cz);
      const flex = pack(flexes[i], pends[i]);

      // Taper slope, so normals lean along the cone rather than straight out.
      const rPrev = radii[Math.max(first, i - 1)];
      const rNext = radii[Math.min(n - 1, i + 1)];
      const dsA = Math.max(1e-4, Math.abs(arcs[Math.min(n - 1, i + 1)] - arcs[Math.max(first, i - 1)]));
      const slope = (rNext - rPrev) / dsA;

      for (let k = 0; k <= segs; k++) {
        const t = (k / segs) * Math.PI * 2;
        const cosT = Math.cos(t);
        const sinT = Math.sin(t);
        dir.set(
          normalA.x * cosT + normalB.x * sinT,
          normalA.y * cosT + normalB.y * sinT,
          normalA.z * cosT + normalB.z * sinT,
        );

        // Nibble the silhouette so branches are not perfect cylinders.
        const rr = r * (1 + SILHOUETTE_WOBBLE * 0.13 * silhouetteWobble(strandSeed * 0.137, a, t));

        vNormal.copy(dir).addScaledVector(tangent, -slope).normalize();

        const px = cx + dir.x * rr;
        const py = cy + dir.y * rr;
        const pz = cz + dir.z * rr;
        buf.position.push(px, py, pz);
        buf.normal.push(vNormal.x, vNormal.y, vNormal.z);
        buf.uv.push(k / segs, a);
        buf.origin.push(ox, oy, oz);
        buf.center.push(cx, cy, cz);
        buf.birth.push(birth);
        buf.flex.push(flex);
        buf.seed.push(strandSeed);
        buf.occlusion.push(occlusion);
        if (i === first && sampler) {
          ringPositions.push(px, py, pz);
          ringNormals.push(vNormal.x, vNormal.y, vNormal.z);
        }
      }

      if (i === first && sampler) {
        sampler.ring = {
          y: cy,
          center: new Vector3(cx, cy, cz),
          a: normalA.clone(),
          b: normalB.clone(),
          positions: ringPositions,
          normals: ringNormals,
          arc: a,
        };
      }
    }

    const rings = n - first;
    for (let i = 0; i < rings - 1; i++) {
      const a0 = base + i * ringVerts;
      const b0 = base + (i + 1) * ringVerts;
      for (let k = 0; k < segs; k++) {
        // Counter-clockwise seen from outside. The frame is right-handed with
        // normalB = tangent × normalA, so winding the other way puts the face
        // normal down the tube's axis-inward direction and the whole trunk
        // renders inside-out.
        buf.index.push(a0 + k, a0 + k + 1, b0 + k + 1, a0 + k, b0 + k + 1, b0 + k);
      }
    }

    if (sampler) emitBase(buf, plan, sampler, field);
  };


  /**
   * The trunk below the hand-over, as the base sees it. Null if this trunk
   * does not stand up out of the ground — a grammar is free to start sideways,
   * and a base swept round a horizontal stem would be nonsense.
   */
  function trunkSampler(centers: number[], radii: number[], arcs: number[], flexes: number[], strandSeed: number): TrunkSampler | null {
    const n = radii.length;
    if (n < 2) return null;
    // Judge the stem by its foot, not by wherever its thickest line wanders
    // to once it is up among the limbs.
    let end = 1;
    while (end < n - 1 && centers[end * 3 + 1] < plan.top * 2) end++;
    const rise = centers[end * 3 + 1] - centers[1];
    const run = Math.hypot(centers[end * 3] - centers[0], centers[end * 3 + 2] - centers[2]);
    if (rise < plan.top * 1.25 || run > rise * 0.5) return null;
    // Index of the last sample at or below `y`.
    const below = (y: number) => {
      let i = 0;
      while (i < n - 2 && centers[(i + 1) * 3 + 1] <= y) i++;
      return i;
    };
    const frac = (i: number, y: number) => {
      const y0 = centers[i * 3 + 1];
      const y1 = centers[(i + 1) * 3 + 1];
      return y1 > y0 ? Math.min(1, Math.max(0, (y - y0) / (y1 - y0))) : 0;
    };
    const y0 = centers[1];
    return {
      segs: TRUNK_SEGMENTS,
      ring: null as unknown as TrunkSampler['ring'],
      centerAt(y, out) {
        if (y <= y0) return out.set(centers[0], y, centers[2]);
        const i = below(y);
        const f = frac(i, y);
        return out.set(
          centers[i * 3] + (centers[(i + 1) * 3] - centers[i * 3]) * f,
          y,
          centers[i * 3 + 2] + (centers[(i + 1) * 3 + 2] - centers[i * 3 + 2]) * f,
        );
      },
      radiusAt(y, t) {
        const i = below(y);
        const f = frac(i, y);
        const r = radii[i] + (radii[i + 1] - radii[i]) * f;
        return r * (1 + SILHOUETTE_WOBBLE * 0.13 * silhouetteWobble(strandSeed * 0.137, this.arcAt(y), t));
      },
      arcAt(y) {
        if (y <= y0) return arcs[0] + (y - y0);
        const i = below(y);
        return arcs[i] + (arcs[i + 1] - arcs[i]) * frac(i, y);
      },
      flexAt(y) {
        // Below the lowest sample the trunk does not move at all.
        if (y <= y0) return Math.min(flexes[0], flexOf(radii[0], Math.max(0, y), rootRadius, heightRef));
        const i = below(y);
        return flexes[i] + (flexes[i + 1] - flexes[i]) * frac(i, y);
      },
      seed: strandSeed,
      maxArc,
    };
  }

  // Walk every strand: start at a root or a fork, follow the thickest child.
  const ring: number[] = [];
  let strandIndex = 0;
  for (let i = 0; i < count; i++) {
    const p = parent[i];
    const isStrandStart = p < 0 || continuation[p] !== i;
    if (!isStrandStart) continue;

    ring.length = 0;
    if (p >= 0) ring.push(p);
    let node = i;
    while (node >= 0) {
      ring.push(node);
      node = continuation[node];
    }
    // A fork starts a little fatter than it goes on, as a limb does where it
    // leaves the trunk, but well inside its parent: start it at the parent's
    // own thickness and it sheathes the parent above the fork, a cone of the
    // wrong bark wrapped round the right one.
    emitStrand(ring, p >= 0 ? Math.min(radius[i] * 1.2, radius[p] * 0.85) : radius[i], ++strandIndex, p < 0);
  }

  return { buf };
}

function tangentAt(centers: number[], i: number, n: number, out: Vector3): void {
  const a = Math.max(0, i - 1);
  const b = Math.min(n - 1, i + 1);
  out.set(
    centers[b * 3] - centers[a * 3],
    centers[b * 3 + 1] - centers[a * 3 + 1],
    centers[b * 3 + 2] - centers[a * 3 + 2],
  );
  if (out.lengthSq() < 1e-12) out.set(0, 1, 0);
  out.normalize();
}

function perpendicular(v: Vector3, out: Vector3): void {
  if (Math.abs(v.y) < 0.9) out.set(0, 1, 0);
  else out.set(1, 0, 0);
  out.crossVectors(v, out).normalize();
}

/**
 * Put a sample exactly at height `y` on a rising strand and return its index,
 * or -1 if the strand never reaches it. The tube starts there and the base
 * repeats that ring as its first row, so the two meet without a gap.
 */
function insertJunction(centers: number[], radii: number[], arcs: number[], flexes: number[], pends: number[], y: number): number {
  const n = radii.length;
  for (let i = 0; i < n - 1; i++) {
    const ya = centers[i * 3 + 1];
    const yb = centers[(i + 1) * 3 + 1];
    if (ya <= y && yb > y) {
      const f = (y - ya) / (yb - ya);
      if (f < 0.02) return i;
      if (f > 0.98) return i + 1;
      centers.splice((i + 1) * 3, 0, ...[0, 1, 2].map((c) => centers[i * 3 + c] + (centers[(i + 1) * 3 + c] - centers[i * 3 + c]) * f));
      radii.splice(i + 1, 0, radii[i] + (radii[i + 1] - radii[i]) * f);
      arcs.splice(i + 1, 0, arcs[i] + (arcs[i + 1] - arcs[i]) * f);
      flexes.splice(i + 1, 0, flexes[i] + (flexes[i + 1] - flexes[i]) * f);
      pends.splice(i + 1, 0, pends[i] + (pends[i + 1] - pends[i]) * f);
      return i + 1;
    }
  }
  return -1;
}

// ----------------------------------------------------------------- foliage

interface LeafTemplate {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  index: Uint16Array;
}

/** An ovate blade: the outline lives in the geometry, so no alpha test is needed. */
function bladeTemplate(halfWidth: number, length: number, cup: number, droop: number, nu = 3, nv = 5): LeafTemplate {
  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (let j = 0; j < nv; j++) {
    const v = j / (nv - 1);
    // Ovate width profile — widest just below the middle, drawn to a tip.
    const w = Math.pow(Math.sin(Math.PI * Math.min(0.999, v * 0.92 + 0.04)), 0.62) * halfWidth;
    for (let i = 0; i < nu; i++) {
      const u = i / (nu - 1);
      const x = (u * 2 - 1) * w;
      const y = v * length - droop * v * v * length;
      const z = cup * (1 - Math.pow(u * 2 - 1, 2)) * halfWidth;
      position.push(x, y, z);
      // Cupping tilts the normal outward from the midrib.
      const nx = ((u * 2 - 1) * cup * 2) / Math.max(1e-3, halfWidth);
      const ny = droop * 2 * v;
      normal.push(nx, ny, 1);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < nv - 1; j++) {
    for (let i = 0; i < nu - 1; i++) {
      const a = j * nu + i;
      const b = a + nu;
      // Wound so the geometric normal agrees with the +z normals above.
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return normalizeTemplate(position, normal, uv, index);
}

function normalizeTemplate(position: number[], normal: number[], uv: number[], index: number[]): LeafTemplate {
  for (let i = 0; i < normal.length; i += 3) {
    const x = normal[i];
    const y = normal[i + 1];
    const z = normal[i + 2];
    const len = Math.hypot(x, y, z) || 1;
    normal[i] = x / len;
    normal[i + 1] = y / len;
    normal[i + 2] = z / len;
  }
  return {
    position: new Float32Array(position),
    normal: new Float32Array(normal),
    uv: new Float32Array(uv),
    index: new Uint16Array(index),
  };
}

function mergeTemplates(parts: { tpl: LeafTemplate; quat: Quaternion; scale: number; offset: Vector3 }[]): LeafTemplate {
  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const v = new Vector3();
  for (const part of parts) {
    const base = position.length / 3;
    for (let i = 0; i < part.tpl.position.length; i += 3) {
      v.set(part.tpl.position[i], part.tpl.position[i + 1], part.tpl.position[i + 2])
        .multiplyScalar(part.scale)
        .applyQuaternion(part.quat)
        .add(part.offset);
      position.push(v.x, v.y, v.z);
      v.set(part.tpl.normal[i], part.tpl.normal[i + 1], part.tpl.normal[i + 2]).applyQuaternion(part.quat);
      normal.push(v.x, v.y, v.z);
    }
    for (let i = 0; i < part.tpl.uv.length; i++) uv.push(part.tpl.uv[i]);
    for (let i = 0; i < part.tpl.index.length; i++) index.push(base + part.tpl.index[i]);
  }
  return normalizeTemplate(position, normal, uv, index);
}

function leafTemplate(shape: 0 | 1 | 2 | 3): LeafTemplate {
  if (shape === 3) {
    // Lance: long, narrow and drooping, the way a willow leaf hangs.
    return bladeTemplate(0.13, 1.7, 0.035, 0.34, 3, 6);
  }

  if (shape === 1) {
    // Needle spray: a fan of slender blades. They have to stay wide enough to
    // cover more than a pixel or the whole conifer renders as bare branches.
    const needle = bladeTemplate(0.1, 1.0, 0.015, 0.1, 2, 3);
    const parts = [];
    const count = 9;
    for (let i = 0; i < count; i++) {
      const around = (i / count) * Math.PI * 2;
      const q = new Quaternion()
        .setFromAxisAngle(new Vector3(0, 1, 0), around)
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.45 + (i % 3) * 0.2));
      parts.push({ tpl: needle, quat: q, scale: 0.8 + (i % 4) * 0.11, offset: new Vector3(0, 0, 0) });
    }
    return mergeTemplates(parts);
  }

  if (shape === 2) {
    // Blossom: five rounded petals in a rosette.
    const petal = bladeTemplate(0.34, 0.62, 0.1, 0.18, 3, 4);
    const parts = [];
    for (let i = 0; i < 5; i++) {
      const around = (i / 5) * Math.PI * 2;
      const q = new Quaternion()
        .setFromAxisAngle(new Vector3(0, 1, 0), around)
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 1.15));
      parts.push({ tpl: petal, quat: q, scale: 1, offset: new Vector3(0, 0.04, 0) });
    }
    return mergeTemplates(parts);
  }

  // A broad leaf is cupped and curved along its midrib, not flat. The cup is
  // what gives a canopy its internal light variation: every leaf presents a
  // slightly different set of angles to the sun, so the crown breaks into
  // highlights and shadow instead of reading as one moulded green mass.
  return bladeTemplate(0.34, 1.0, 0.19, 0.2, 4, 5);
}

/** A five-petal rosette. `uv.y` runs 0 at the throat to 1 at the petal tip. */
function flowerTemplate(): LeafTemplate {
  return leafTemplate(2);
}

/**
 * A berry: a squat sphere, low enough poly to bake thousands of them.
 *
 * `uv.y` runs bottom to top so the shader can darken the underside, which is
 * most of what makes a small round thing read as three-dimensional once it is
 * only a dozen pixels across.
 */
/**
 * An apple.
 *
 * A sphere does not read as an apple, and no amount of shading fixes it: what
 * the eye recognises is the silhouette. Four things carry it, and all four are
 * geometry.
 *
 *   Wider than tall      an apple is about 0.95 as tall as it is wide, and the
 *                        widest point sits *above* the equator, nearer the stem.
 *   A deep stem well     the funnel the stalk sits in, and the single most
 *                        recognisable feature of the fruit.
 *   A calyx basin        the shallower dimple at the blossom end opposite it.
 *   Five faint lobes     from the five carpels inside, strongest around the
 *                        calyx and fading out toward the stem.
 *
 * The wells are the fiddly part. Subtracting a Gaussian from `y` only makes a
 * dent if it is *steeper* than the sphere's own curvature — a wide, gentle one
 * gets absorbed into the profile and does nothing. The first attempt here used
 * a width of 0.62 and carved a well 0.02 radii deep, which is to say none. The
 * numbers below are chosen so the surface actually turns over: the rim lands
 * near phi = 0.46, which puts a basin about 0.19 radii deep and 0.46 wide.
 *
 * Rings are also spaced by `(1 - cos(pi v)) / 2` rather than uniformly, which
 * clusters them at both poles. Evenly spaced rings put barely one sample inside
 * the stem well and it renders as a crude notch.
 */
function appleTemplate(radius = 0.44, segments = 12, rings = 12): LeafTemplate {
  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];

  const surface = (u: number, v: number, out: number[]): void => {
    // Cluster rings toward the poles, where all the shape is.
    const phi = Math.PI * (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, v)))) * 0.5;
    const theta = u * Math.PI * 2;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);

    // Widest above the equator, tapering toward the blossom end.
    let r = sinPhi * (1 + 0.1 * cosPhi);
    // Five carpels, showing as faint lobes that fade out toward the stem.
    r *= 1 + 0.04 * Math.cos(5 * theta) * (0.3 + 0.35 * (1 - cosPhi));

    // 1.05 rather than a sphere's 1.0 leaves the finished fruit about 0.9 as
    // tall as it is wide once the wells have taken their bite, which is the
    // proportion that reads as an apple rather than as a tomato or a plum.
    let y = cosPhi * 1.05;
    y -= 0.34 * Math.exp(-((phi / 0.3) ** 2));
    y += 0.16 * Math.exp(-(((Math.PI - phi) / 0.42) ** 2));

    out[0] = Math.cos(theta) * r * radius;
    out[1] = y * radius;
    out[2] = Math.sin(theta) * r * radius;
  };

  const a: number[] = [0, 0, 0];
  const b: number[] = [0, 0, 0];
  const c: number[] = [0, 0, 0];
  const d: number[] = [0, 0, 0];
  const eps = 0.004;

  for (let ri = 0; ri <= rings; ri++) {
    const v = ri / rings;
    for (let si = 0; si <= segments; si++) {
      const u = si / segments;
      surface(u, v, a);
      position.push(a[0], a[1], a[2]);
      uv.push(u, 1 - v);

      // Normals from the surface itself rather than from a sphere — the wells
      // and lobes are exactly where a sphere's normals would be wrong.
      if (ri === 0) {
        // The floor of the stem well faces up, out of the bowl.
        normal.push(0, 1, 0);
      } else if (ri === rings) {
        normal.push(0, -1, 0);
      } else {
        surface(u + eps, v, b);
        surface(u - eps, v, c);
        surface(u, Math.min(1, v + eps), d);
        const du = [b[0] - c[0], b[1] - c[1], b[2] - c[2]];
        surface(u, Math.max(0, v - eps), c);
        const dv = [d[0] - c[0], d[1] - c[1], d[2] - c[2]];
        normal.push(
          du[1] * dv[2] - du[2] * dv[1],
          du[2] * dv[0] - du[0] * dv[2],
          du[0] * dv[1] - du[1] * dv[0],
        );
      }
    }
  }

  const stride = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const i0 = r * stride + s;
      const i1 = i0 + stride;
      index.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1);
    }
  }

  // The stalk, rising out of the well. It rides in the same template so the
  // fruit stays one draw call, and is tagged with a UV outside [0, 1] so the
  // shader can give it bark colour instead of skin — cheaper than a second
  // material for a dozen triangles.
  const stemBase = position.length / 3;
  const stemSides = 5;
  const stemRings = 3;
  surface(0, 0, a);
  const wellFloor = a[1] - radius * 0.04;
  for (let r = 0; r <= stemRings; r++) {
    const t = r / stemRings;
    const y = wellFloor + t * radius * 0.62;
    // Leans a little, and thickens where it meets the fruit.
    const lean = t * t * radius * 0.07;
    const rr = radius * (0.05 - 0.018 * t);
    for (let s = 0; s <= stemSides; s++) {
      const th = (s / stemSides) * Math.PI * 2;
      const nx = Math.cos(th);
      const nz = Math.sin(th);
      position.push(nx * rr + lean, y, nz * rr);
      normal.push(nx, 0.15, nz);
      uv.push(s / stemSides, 1.5);
    }
  }
  const stemStride = stemSides + 1;
  for (let r = 0; r < stemRings; r++) {
    for (let s = 0; s < stemSides; s++) {
      const i0 = stemBase + r * stemStride + s;
      const i1 = i0 + stemStride;
      index.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1);
    }
  }

  return normalizeTemplate(position, normal, uv, index);
}

/**
 * A pine cone.
 *
 * Hangs from its stalk rather than standing on it, so unlike the apple this
 * template is built downward: the attachment is at y = 0 and the tip points at
 * the ground. Placed upright, it then hangs plumb whatever the twig is doing.
 *
 * The profile swells to its widest about 40% of the way down and tapers to a
 * blunt point — a plain ellipsoid reads as a berry, and a plain cone reads as a
 * spike. The scales are a spiral: each one is a shingle that bulges at its
 * lower edge, which is `fract(rows * v + twist * u)` as a sawtooth on the
 * radius. Only enough of them are cut into the geometry to break the
 * silhouette; the pattern across the surface is the shader's job, since a cone
 * is a handful of pixels at any sane viewing distance.
 */
function coneTemplate(radius = 0.25, segments = 10, rings = 16): LeafTemplate {
  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];

  // A pine cone is roughly twice as long as it is wide. At 2.5 the first
  // version came out at 1.13 and read as a beehive.
  const ROWS = 9;
  const TWIST = 5;
  const LENGTH = 4.6;

  const surface = (u: number, v: number, out: number[]): void => {
    const t = Math.min(1, Math.max(0, v));
    const theta = u * Math.PI * 2;
    // Widest about a third down, then a long taper to the tip.
    let r = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.85);
    // Shingled scales, spiralling. The twist is what stops them reading as
    // stacked rings.
    const shingle = (ROWS * t + TWIST * u) % 1;
    r *= 1 + 0.2 * (shingle - 0.45) * Math.sin(Math.PI * t);

    out[0] = Math.cos(theta) * r * radius;
    out[1] = -t * radius * LENGTH;
    out[2] = Math.sin(theta) * r * radius;
  };

  const a: number[] = [0, 0, 0];
  const b: number[] = [0, 0, 0];
  const c: number[] = [0, 0, 0];
  const d: number[] = [0, 0, 0];
  const eps = 0.004;

  for (let ri = 0; ri <= rings; ri++) {
    const v = ri / rings;
    for (let si = 0; si <= segments; si++) {
      const u = si / segments;
      surface(u, v, a);
      position.push(a[0], a[1], a[2]);
      uv.push(u, 1 - v);

      if (ri === 0) {
        normal.push(0, 1, 0);
      } else if (ri === rings) {
        normal.push(0, -1, 0);
      } else {
        surface(u + eps, v, b);
        surface(u - eps, v, c);
        surface(u, Math.min(1, v + eps), d);
        const du = [b[0] - c[0], b[1] - c[1], b[2] - c[2]];
        surface(u, Math.max(0, v - eps), c);
        const dv = [d[0] - c[0], d[1] - c[1], d[2] - c[2]];
        normal.push(
          du[1] * dv[2] - du[2] * dv[1],
          du[2] * dv[0] - du[0] * dv[2],
          du[0] * dv[1] - du[1] * dv[0],
        );
      }
    }
  }

  const stride = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let sg = 0; sg < segments; sg++) {
      const i0 = r * stride + sg;
      const i1 = i0 + stride;
      index.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1);
    }
  }

  return normalizeTemplate(position, normal, uv, index);
}

function berryTemplate(radius = 0.4, segments = 10, rings = 7): LeafTemplate {
  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];

  for (let r = 0; r <= rings; r++) {
    const v = r / rings;
    const phi = v * Math.PI;
    const sy = Math.cos(phi);
    const sr = Math.sin(phi);
    for (let s = 0; s <= segments; s++) {
      const u = s / segments;
      const theta = u * Math.PI * 2;
      const nx = Math.cos(theta) * sr;
      const ny = sy;
      const nz = Math.sin(theta) * sr;
      // Slightly taller than wide, and flattened at the top where the stalk sits.
      position.push(nx * radius, ny * radius * 1.12 - radius * 0.05, nz * radius);
      normal.push(nx, ny, nz);
      uv.push(u, 1 - v);
    }
  }

  const stride = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * stride + s;
      const b = a + stride;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  return normalizeTemplate(position, normal, uv, index);
}

function buildFoliage(
  skel: Skeleton,
  kept: LeafPlacement[],
  blade: LeafTemplate,
  blossom: LeafTemplate,
  field: CanopyOcclusion,
  sway: Sway,
): { buf: Buffers; count: number; ids: number[] } | null {
  if (kept.length === 0) return null;

  const buf = newBuffers();
  const ids: number[] = [];
  const maxArc = Math.max(1e-5, skel.maxArc);
  const v = new Vector3();
  const nrm = new Vector3();

  kept.forEach((leaf, id) => {
    const tpl = leaf.kind === 1 ? blossom : blade;
    const base = buf.position.length / 3;
    for (let i = 0; i < tpl.position.length; i += 3) ids.push(id);
    const scale = leaf.scale;
    // Leaves appear just after the twig that carries them.
    const birth = Math.min(1, leaf.arc / maxArc + 0.015);
    const occlusion = field.sample(leaf.pos.x, leaf.pos.y, leaf.pos.z);

    // A leaf must bend by the same amount as the twig it hangs on, or it slides
    // along the branch and shears through its neighbours — so it takes its
    // twig's own weights rather than working out its own.
    const flex = pack(sway.flex[leaf.node], sway.pend[leaf.node]);

    for (let i = 0; i < tpl.position.length; i += 3) {
      v.set(tpl.position[i], tpl.position[i + 1], tpl.position[i + 2])
        .multiplyScalar(scale)
        .applyQuaternion(leaf.quat)
        .add(leaf.pos);
      nrm.set(tpl.normal[i], tpl.normal[i + 1], tpl.normal[i + 2]).applyQuaternion(leaf.quat);

      buf.position.push(v.x, v.y, v.z);
      buf.normal.push(nrm.x, nrm.y, nrm.z);
      // Leaves scale up about their anchor point, so origin === centre.
      buf.origin.push(leaf.pos.x, leaf.pos.y, leaf.pos.z);
      buf.center.push(leaf.pos.x, leaf.pos.y, leaf.pos.z);
      buf.birth.push(birth);
      buf.flex.push(flex);
      // Blossoms are tagged by offsetting the seed past 2, so the leaf shader
      // can tell them apart without another attribute.
      buf.seed.push(leaf.kind === 1 ? leaf.seed + 2 : leaf.seed);
      buf.occlusion.push(occlusion);
    }
    for (let i = 0; i < tpl.uv.length; i++) buf.uv.push(tpl.uv[i]);
    for (let i = 0; i < tpl.index.length; i++) buf.index.push(base + tpl.index[i]);
  });

  return { buf, count: kept.length, ids };
}
