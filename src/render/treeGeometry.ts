/**
 * Turns a branch skeleton into two draw calls: one tube mesh for the wood and
 * one merged mesh for the foliage.
 *
 * Both meshes carry the same four custom attributes, so a single TSL growth
 * program animates them:
 *
 *   aOrigin  the point this vertex sprouts from (previous ring centre, or the
 *            leaf's anchor) — vertices start collapsed here
 *   aCenter  the pivot the vertex finally orbits (its own ring centre)
 *   aBirth   normalised distance from the root, so growth sweeps outward
 *   aFlex    how much wind moves this vertex
 */
import { BufferAttribute, BufferGeometry, Quaternion, Vector3 } from 'three';
import type { LeafPlacement, Skeleton } from '../lsystem/turtle';

export interface TreeGeometryOptions {
  /** 0 broad · 1 needle · 2 blossom. */
  leafShape: 0 | 1 | 2;
  /** Irregularity of the branch silhouette, 0–1. */
  bark: number;
  maxLeaves: number;
  /** Fraction of leaves to keep, 0–1 (the foliage-density slider). */
  leafDensity: number;
}

export interface TreeGeometryResult {
  branches: BufferGeometry;
  foliage: BufferGeometry | null;
  stats: {
    branchVertices: number;
    branchTriangles: number;
    leafCount: number;
    leafVertices: number;
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
  index: number[];
}

function newBuffers(): Buffers {
  return { position: [], normal: [], uv: [], origin: [], center: [], birth: [], flex: [], seed: [], index: [] };
}

function toGeometry(b: Buffers): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(b.position), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(b.normal), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(b.uv), 2));
  g.setAttribute('aOrigin', new BufferAttribute(new Float32Array(b.origin), 3));
  g.setAttribute('aCenter', new BufferAttribute(new Float32Array(b.center), 3));
  g.setAttribute('aBirth', new BufferAttribute(new Float32Array(b.birth), 1));
  g.setAttribute('aFlex', new BufferAttribute(new Float32Array(b.flex), 1));
  g.setAttribute('aSeed', new BufferAttribute(new Float32Array(b.seed), 1));
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
  const branches = buildBranches(skel, opts);
  const foliage = buildFoliage(skel, opts);
  return {
    branches: toGeometry(branches.buf),
    foliage: foliage ? toGeometry(foliage.buf) : null,
    stats: {
      branchVertices: branches.buf.position.length / 3,
      branchTriangles: branches.buf.index.length / 3,
      leafCount: foliage?.count ?? 0,
      leafVertices: foliage ? foliage.buf.position.length / 3 : 0,
    },
  };
}

// ---------------------------------------------------------------- branches

function buildBranches(skel: Skeleton, opts: TreeGeometryOptions): { buf: Buffers } {
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
      const thin = 1 - Math.min(1, r / rootRadius);
      const flex = Math.pow(thin, 1.5) * (0.25 + 0.75 * Math.min(1, a / maxArc));

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
        const rr = r * (1 + opts.bark * 0.13 * silhouetteWobble(strandSeed * 0.137, a, t));

        vNormal.copy(dir).addScaledVector(tangent, -slope).normalize();

        buf.position.push(cx + dir.x * rr, cy + dir.y * rr, cz + dir.z * rr);
        buf.normal.push(vNormal.x, vNormal.y, vNormal.z);
        buf.uv.push(k / segs, a);
        buf.origin.push(ox, oy, oz);
        buf.center.push(cx, cy, cz);
        buf.birth.push(birth);
        buf.flex.push(flex);
        buf.seed.push(strandSeed);
      }
    }

    for (let i = 0; i < n - 1; i++) {
      const a0 = base + i * ringVerts;
      const b0 = base + (i + 1) * ringVerts;
      for (let k = 0; k < segs; k++) {
        buf.index.push(a0 + k, b0 + k, a0 + k + 1, a0 + k + 1, b0 + k, b0 + k + 1);
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
      index.push(a, b, a + 1, a + 1, b, b + 1);
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

function leafTemplate(shape: 0 | 1 | 2): LeafTemplate {
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

function buildFoliage(skel: Skeleton, opts: TreeGeometryOptions): { buf: Buffers; count: number } | null {
  const all = skel.leaves;
  if (all.length === 0) return null;

  const density = Math.max(0, Math.min(1, opts.leafDensity));
  const wanted = Math.min(opts.maxLeaves, Math.floor(all.length * density));
  if (wanted <= 0) return null;

  // Deterministic thinning: keep an evenly spaced subset.
  const stride = all.length / wanted;
  const kept: LeafPlacement[] = [];
  for (let i = 0; i < wanted; i++) kept.push(all[Math.min(all.length - 1, Math.floor(i * stride))]);

  const blade = leafTemplate(opts.leafShape);
  const blossom = opts.leafShape === 2 ? blade : leafTemplate(2);

  const buf = newBuffers();
  const maxArc = Math.max(1e-5, skel.maxArc);
  const v = new Vector3();
  const nrm = new Vector3();

  for (const leaf of kept) {
    const tpl = leaf.kind === 1 ? blossom : blade;
    const base = buf.position.length / 3;
    const scale = leaf.scale;
    // Leaves appear just after the twig that carries them.
    const birth = Math.min(1, leaf.arc / maxArc + 0.015);

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
      buf.flex.push(1);
      // Blossoms are tagged by offsetting the seed past 2, so the leaf shader
      // can tell them apart without another attribute.
      buf.seed.push(leaf.kind === 1 ? leaf.seed + 2 : leaf.seed);
    }
    for (let i = 0; i < tpl.uv.length; i++) buf.uv.push(tpl.uv[i]);
    for (let i = 0; i < tpl.index.length; i++) buf.index.push(base + tpl.index[i]);
  }

  return { buf, count: kept.length };
}
