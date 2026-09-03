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
import { emitRoots, flareScale, planRoots, type RootPlan } from './roots';

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
  /** Vertex range in the fruit geometry. */
  start: number;
  count: number;
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
  if (ratio < 0.18) return 6;
  if (ratio < 0.4) return 11;
  return 20;
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
  const branches = buildBranches(skel, field, plan);
  const foliage = buildFoliage(skel, kept, template, blossomTpl, field);

  // Flowers and fruit hang off the same attachment points as the leaves, so any
  // species can carry them without the grammar knowing anything about it.
  const sites = selectOrnamentSites(kept, opts.maxOrnaments ?? 2600);
  const flowers = buildOrnaments(skel, sites, flowerTemplate(), field, { droop: 0 });
  // A berry is a sphere and can point anywhere, but an apple and a cone both
  // have a top and a bottom, so they hang upright rather than inheriting
  // whatever rotation the leaf beside them happened to get.
  const shape = opts.fruitShape ?? 0;
  const axial = shape !== 0;
  const fruitTpl = shape === 2 ? coneTemplate() : shape === 1 ? appleTemplate() : berryTemplate();
  const fruit = buildOrnaments(skel, sites, fruitTpl, field, {
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
        start: i * perFruit,
        count: perFruit,
      }))
    : [];
  let fruitHang = 0;
  if (fruitGeo) {
    // -1 means still attached. Only the fruit mesh carries it, so the wood and
    // foliage do not pay for an attribute they never read.
    const fall = new Float32Array(fruitGeo.getAttribute('position').count).fill(-1);
    fruitGeo.setAttribute('aFall', new BufferAttribute(fall, 1));

    const pos = fruit!.position;
    const cen = fruit!.center;
    for (let i = 1; i < pos.length; i += 3) {
      const below = cen[i] - pos[i];
      if (below > fruitHang) fruitHang = below;
    }
  }

  return {
    branches: toGeometry(branches.buf),
    foliage: foliage ? toGeometry(foliage.buf) : null,
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
  opts: { droop: number; seedShift?: number; upright?: boolean },
): Buffers | null {
  if (sites.length === 0) return null;

  const buf = newBuffers();
  const maxArc = Math.max(1e-5, skel.maxArc);
  const heightRef = Math.max(0.5, skel.height);
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
    const flex = Math.pow(Math.max(0, Math.min(1, leaf.pos.y / heightRef)), 1.3);
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

function buildBranches(skel: Skeleton, field: CanopyOcclusion, plan: RootPlan): { buf: Buffers } {
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

  const centers: number[] = [];
  const radii: number[] = [];
  const arcs: number[] = [];

  const emitStrand = (ring: number[], firstRadiusCap: number, strandSeed: number, isTrunk = false) => {
    if (ring.length < 2) return;

    centers.length = 0;
    radii.length = 0;
    arcs.length = 0;
    let maxR = 0;
    for (let i = 0; i < ring.length; i++) {
      const node = ring[i];
      centers.push(pos[node * 3], pos[node * 3 + 1], pos[node * 3 + 2]);
      const r = i === 0 ? Math.min(radius[node], firstRadiusCap) : radius[node];
      radii.push(r);
      arcs.push(arc[node]);
      if (r > maxR) maxR = r;
    }

    if (isTrunk) {
      // Carry the trunk below the soil line. Its lowest ring is an open end,
      // and left at ground level any dip in the terrain — or a camera dropped
      // to grazing — looks straight up inside the tree.
      centers.unshift(centers[0], centers[1] - plan.bury, centers[2]);
      radii.unshift(radii[0]);
      arcs.unshift(arcs[0]);
    }

    const n = radii.length;
    // The flare more than doubles the trunk's width at the soil line, and the
    // lobes are the whole point — at the trunk's usual segment count they would
    // read as facets rather than as swellings.
    const segs = isTrunk ? 28 : radialSegmentsFor(maxR / rootRadius);
    const ringVerts = segs + 1;
    const base = buf.position.length / 3;

    // Parallel-transport frame so the tube does not twist along its length.
    const tangent = new Vector3();
    const nextT = new Vector3();
    const normalA = new Vector3();
    const normalB = new Vector3();
    const dir = new Vector3();
    const vNormal = new Vector3();

    tangentAt(centers, 0, n, tangent);
    perpendicular(tangent, normalA);
    normalB.crossVectors(tangent, normalA).normalize();

    for (let i = 0; i < n; i++) {
      if (i > 0) {
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
      const oi = Math.max(0, i - 1);
      const ox = centers[oi * 3];
      const oy = centers[oi * 3 + 1];
      const oz = centers[oi * 3 + 2];

      const birth = Math.min(1, a / maxArc);
      const occlusion = field.sample(cx, cy, cz);

      // Wind weight is dominated by height, not by arc length. Height is a
      // smooth function of space, so anything sitting near anything else bends
      // by nearly the same angle and the two never scissor through each other.
      // Arc length is not: a twig tip and the limb it hangs off can share a
      // location while being metres apart along the branch.
      const thin = 1 - Math.min(1, r / rootRadius);
      const heightNorm = Math.max(0, Math.min(1, cy / heightRef));
      const flex = Math.pow(heightNorm, 1.3) * (0.62 + 0.38 * Math.pow(thin, 1.5));

      // Taper slope, so normals lean along the cone rather than straight out.
      const rPrev = radii[Math.max(0, i - 1)];
      const rNext = radii[Math.min(n - 1, i + 1)];
      const dsA = Math.max(1e-4, Math.abs(arcs[Math.min(n - 1, i + 1)] - arcs[Math.max(0, i - 1)]));
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
        let rr = r * (1 + SILHOUETTE_WOBBLE * 0.13 * silhouetteWobble(strandSeed * 0.137, a, t));
        // ...and swell the foot of the trunk into a buttress.
        if (isTrunk) rr *= flareScale(plan, cy, dir.x, dir.z);

        vNormal.copy(dir).addScaledVector(tangent, -slope).normalize();

        buf.position.push(cx + dir.x * rr, cy + dir.y * rr, cz + dir.z * rr);
        buf.normal.push(vNormal.x, vNormal.y, vNormal.z);
        buf.uv.push(k / segs, a);
        buf.origin.push(ox, oy, oz);
        buf.center.push(cx, cy, cz);
        buf.birth.push(birth);
        buf.flex.push(flex);
        buf.seed.push(strandSeed);
        buf.occlusion.push(occlusion);
      }
    }

    for (let i = 0; i < n - 1; i++) {
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
  };

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
    // A fork should not start at full parent thickness or it looks swollen.
    emitStrand(ring, radius[i] * 1.7, ++strandIndex, p < 0);
  }

  // Roots ride in the same buffer as the wood, so the whole tree stays one
  // draw call and picks up the bark material for free.
  emitRoots(buf, plan, field, 0.41);

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
    return bladeTemplate(0.115, 1.7, 0.035, 0.34, 3, 6);
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
): { buf: Buffers; count: number } | null {
  if (kept.length === 0) return null;

  const buf = newBuffers();
  const maxArc = Math.max(1e-5, skel.maxArc);
  const heightRef = Math.max(0.5, skel.height);
  const v = new Vector3();
  const nrm = new Vector3();

  for (const leaf of kept) {
    const tpl = leaf.kind === 1 ? blossom : blade;
    const base = buf.position.length / 3;
    const scale = leaf.scale;
    // Leaves appear just after the twig that carries them.
    const birth = Math.min(1, leaf.arc / maxArc + 0.015);
    const occlusion = field.sample(leaf.pos.x, leaf.pos.y, leaf.pos.z);

    // A leaf must bend by the same amount as the twig it hangs on, or it slides
    // along the branch and shears through its neighbours. Twigs are thin, so
    // their `thin` term is ~1 and this reduces to the branch formula.
    const flex = Math.pow(Math.max(0, Math.min(1, leaf.pos.y / heightRef)), 1.3);

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
  }

  return { buf, count: kept.length };
}
