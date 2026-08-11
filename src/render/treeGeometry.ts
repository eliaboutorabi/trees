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
import type { LeafPlacement, Skeleton } from '../lsystem/turtle';
import { CanopyOcclusion } from './occlusion';

export interface TreeGeometryOptions {
  /** 0 broad · 1 needle · 2 blossom · 3 lance. */
  leafShape: 0 | 1 | 2 | 3;
  maxLeaves: number;
  /** Sites baked for flowers and for fruit. Density then culls on the GPU. */
  maxOrnaments?: number;
}

/**
 * Silhouette irregularity is baked in at a fixed amount. Exposing it as a
 * slider would mean a rebuild on every drag, and the same look is available
 * live through the bark-relief shading instead.
 */
const SILHOUETTE_WOBBLE = 0.55;

export interface TreeGeometryResult {
  branches: BufferGeometry;
  foliage: BufferGeometry | null;
  flowers: BufferGeometry | null;
  fruit: BufferGeometry | null;
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

  const branches = buildBranches(skel, field);
  const foliage = buildFoliage(skel, kept, template, blossomTpl, field);

  // Flowers and fruit hang off the same attachment points as the leaves, so any
  // species can carry them without the grammar knowing anything about it.
  const sites = selectOrnamentSites(kept, opts.maxOrnaments ?? 2600);
  const flowers = buildOrnaments(skel, sites, flowerTemplate(), field, { droop: 0 });
  const fruit = buildOrnaments(skel, sites, berryTemplate(), field, { droop: 1.05, seedShift: 0.37 });

  return {
    branches: toGeometry(branches.buf),
    foliage: foliage ? toGeometry(foliage.buf) : null,
    flowers: flowers ? toGeometry(flowers) : null,
    fruit: fruit ? toGeometry(fruit) : null,
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
  const take = Math.min(max, ranked.length);
  const sites: { leaf: LeafPlacement; rank: number }[] = [];
  for (let i = 0; i < take; i++) sites.push({ leaf: ranked[i].leaf, rank: (i + 0.5) / take });
  return sites;
}

function buildOrnaments(
  skel: Skeleton,
  sites: { leaf: LeafPlacement; rank: number }[],
  tpl: LeafTemplate,
  field: CanopyOcclusion,
  opts: { droop: number; seedShift?: number },
): Buffers | null {
  if (sites.length === 0) return null;

  const buf = newBuffers();
  const maxArc = Math.max(1e-5, skel.maxArc);
  const heightRef = Math.max(0.5, skel.height);
  const v = new Vector3();
  const nrm = new Vector3();
  const shift = opts.seedShift ?? 0;

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

    for (let i = 0; i < tpl.position.length; i += 3) {
      v.set(tpl.position[i], tpl.position[i + 1], tpl.position[i + 2])
        .multiplyScalar(scale)
        .applyQuaternion(leaf.quat)
        .add(leaf.pos);
      v.y -= drop;
      nrm.set(tpl.normal[i], tpl.normal[i + 1], tpl.normal[i + 2]).applyQuaternion(leaf.quat);

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

function buildBranches(skel: Skeleton, field: CanopyOcclusion): { buf: Buffers } {
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

  const emitStrand = (ring: number[], firstRadiusCap: number, strandSeed: number) => {
    const n = ring.length;
    if (n < 2) return;

    centers.length = 0;
    radii.length = 0;
    arcs.length = 0;
    let maxR = 0;
    for (let i = 0; i < n; i++) {
      const node = ring[i];
      centers.push(pos[node * 3], pos[node * 3 + 1], pos[node * 3 + 2]);
      const r = i === 0 ? Math.min(radius[node], firstRadiusCap) : radius[node];
      radii.push(r);
      arcs.push(arc[node]);
      if (r > maxR) maxR = r;
    }

    const segs = radialSegmentsFor(maxR / rootRadius);
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
        const rr = r * (1 + SILHOUETTE_WOBBLE * 0.13 * silhouetteWobble(strandSeed * 0.137, a, t));

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
    emitStrand(ring, radius[i] * 1.7, ++strandIndex);
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

  return bladeTemplate(0.34, 1.0, 0.09, 0.14, 3, 5);
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
function berryTemplate(radius = 0.4, segments = 7, rings = 5): LeafTemplate {
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
