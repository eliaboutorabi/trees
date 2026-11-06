/**
 * The foot of the tree: root flare, buttresses and surface roots, built as one
 * surface.
 *
 * Look at a tree standing in grass and its roots are not things lying on the
 * ground. They are the ground's own relief: rounded ridges that swell out of
 * the trunk, run a metre or two across the soil and sink back under it. The
 * trunk does not stand on them so much as pour into them, and where it does,
 * the wood curves round in a smooth web from upright to level, the way a
 * buttress does. Model roots as tubes, as this file once did, and every part of
 * that comes out wrong at once: a tube has an underside, a round end and a seam
 * where it meets the trunk, and it lies on the lawn like a dropped log.
 *
 * So the roots here are a *heightfield*: each root is a path across the ground
 * carrying a crest height and a width, the crest high where it leaves the
 * trunk and diving below the soil further out, and the field is the smooth
 * maximum of all of them. Big roots fork; a scatter of small ones fill the
 * gaps. And the trunk's foot and that field are a single sheet, swept column by
 * column round the trunk. Each column runs down the trunk wall, rounds a fillet,
 * and runs out along the field until it is well under the soil.
 *
 * The fillet is the exact zero set of a smooth minimum of the two surfaces it
 * joins, the trunk wall and the field, so it meets both with matching slope and
 * there is nothing for the eye to catch on. Over a root's crest the fillet is
 * wide and climbs the trunk, which is the buttress; between roots it is narrow
 * and happens underground, and the trunk simply enters the soil.
 *
 * Everything scales with the trunk's own radius, so a sapling gets a sapling's
 * roots and a baobab a baobab's.
 */
import { Vector3 } from 'three';
import type { CanopyOcclusion } from './occlusion';

/** How a species roots. All lengths are in trunk radii. */
export interface RootStyle {
  /** Major roots, at least and at most. */
  count: [number, number];
  /** How far a major root runs before it is gone under the soil. */
  reach: number;
  /** How high a major root's crest stands where it leaves the trunk. */
  rise: number;
  /** How far the buttress web climbs the trunk above a root's crest. */
  buttress: number;
  /** General widening of the trunk's foot, as a fraction of its radius. */
  flare: number;
}

export const DEFAULT_ROOTS: RootStyle = { count: [5, 7], reach: 4.2, rise: 0.4, buttress: 1, flare: 0.16 };

/** One straight piece of a root's path, with crest height and half-width at each end. */
interface Segment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Crest height above the soil, which goes negative as the root dives. */
  ca: number;
  cb: number;
  /** Half-width of the ridge. */
  wa: number;
  wb: number;
}

interface Root {
  segments: Segment[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface RootPlan {
  /** Trunk radius at the soil line, before any flare. */
  r0: number;
  /** Height where the base hands over to the trunk's own tube. */
  top: number;
  /** How deep a root dives once it has gone under. */
  sink: number;
  /**
   * The field's floor: just under the soil, so a root's flanks can flatten out
   * into it the way soil banks up against a root, and the terrain hides the
   * rest. Deep enough not to fight the terrain for the same pixels.
   */
  floor: number;
  /** Furthest any root runs from the trunk's axis. */
  reach: number;
  flare: number;
  /** Fillet radius between roots, and over the tallest crest. */
  filletLow: number;
  filletHigh: number;
  /** The tallest crest, for scaling the fillet between those two. */
  crest: number;
  roots: Root[];
}

/** Deterministic per-tree noise, so Shuffle reshuffles the roots too. */
function rng(seed: number): () => number {
  let s = (seed | 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 8) & 0xffffff) / 0x1000000;
  };
}

export function planRoots(baseRadius: number, height: number, seed: number, style: RootStyle = DEFAULT_ROOTS): RootPlan {
  const rand = rng(seed * 2654435761 + 17);
  const r0 = Math.max(1e-3, baseRadius);
  const sink = r0 * 0.42;
  const roots: Root[] = [];
  let reach = r0 * 1.5;
  let crest = 0;

  /**
   * Grow one root from (x, z) along `heading`.
   *
   * The crest falls as `h0 - (h0 + dive) · t^p`, with `p` chosen so it crosses
   * the soil about 60% of the way out. That shape is the point: a root hugs
   * the ground for a good stretch before it goes under, rather than sloping
   * steadily into it from the trunk like a guy rope.
   */
  const grow = (x: number, z: number, heading: number, length: number, h0: number, w0: number, depth: number): void => {
    const steps = Math.max(5, Math.ceil(length / (r0 * 0.2)));
    const dive = sink * 1.25;
    const under = 0.6 + 0.16 * rand();
    const p = Math.log(Math.max(0.05, h0) / (Math.max(0.05, h0) + dive)) / Math.log(under);
    // Meander that grows with distance: a root leaves the trunk where the lobe
    // sends it and only then starts to go its own way.
    const bend = (rand() - 0.5) * 0.9;
    const kink = (rand() - 0.5) * 0.4;
    const ph1 = rand() * Math.PI * 2;
    const ph2 = rand() * Math.PI * 2;
    const forkAt = depth === 0 && rand() < 0.7 ? Math.floor(steps * (0.3 + 0.25 * rand())) : -1;
    const root: Root = { segments: [], minX: x, maxX: x, minZ: z, maxZ: z };

    let px = x;
    let pz = z;
    let pc = h0;
    let pw = w0;
    let narrow = 1;
    for (let j = 1; j <= steps; j++) {
      const t = j / steps;
      const dir = heading + bend * Math.sin(t * 2.1 + ph1) * t + kink * Math.sin(t * 6.7 + ph2) * t;
      const nx = px + Math.cos(dir) * (length / steps);
      const nz = pz + Math.sin(dir) * (length / steps);
      const nc = h0 - (h0 + dive) * Math.pow(t, p);
      // Narrows toward its end as well as sinking, so it leaves as a tapering
      // ridge rather than a blunt toe.
      const nw = (w0 * (1 - 0.62 * Math.pow(t, 0.8)) + r0 * 0.06) * narrow;
      root.segments.push({ ax: px, az: pz, bx: nx, bz: nz, ca: pc, cb: nc, wa: pw, wb: nw });
      const pad = Math.max(pw, nw);
      root.minX = Math.min(root.minX, nx - pad, px - pad);
      root.maxX = Math.max(root.maxX, nx + pad, px + pad);
      root.minZ = Math.min(root.minZ, nz - pad, pz - pad);
      root.maxZ = Math.max(root.maxZ, nz + pad, pz + pad);
      reach = Math.max(reach, Math.hypot(nx, nz) + pad);

      if (j === forkAt) {
        // A fork takes some of the root with it, and leaves from the parent's
        // flank at the parent's own crest height so the two ridges are one
        // swelling where they part.
        const side = rand() < 0.5 ? -1 : 1;
        grow(nx, nz, dir + side * (0.45 + 0.4 * rand()), length * (1 - t) * (0.7 + 0.3 * rand()), nc * 0.95, nw * 0.74, depth + 1);
        narrow = 0.86;
      }
      px = nx;
      pz = nz;
      pc = nc;
      pw = nw;
    }
    roots.push(root);
  };

  // Majors. Fewer reads as a tripod; more and they crowd into a skirt.
  const [lo, hi] = style.count;
  const n = lo + Math.floor(rand() * (hi - lo + 1));
  const step = (Math.PI * 2) / n;
  const spin = rand() * Math.PI * 2;
  const bearings: number[] = [];
  for (let i = 0; i < n; i++) {
    // Jittered off even spacing, but never so far that two majors stack.
    const bearing = spin + step * (i + (rand() - 0.5) * 0.55);
    bearings.push(bearing);
    const major = 0.55 + 0.45 * rand();
    const length = r0 * style.reach * (0.7 + 0.45 * rand()) * (0.7 + 0.3 * major);
    const h0 = r0 * style.rise * (0.6 + 0.6 * major);
    const w0 = r0 * (0.42 + 0.22 * major);
    crest = Math.max(crest, h0);
    // Starts inside the trunk, so the crest is at full height where it
    // reaches the trunk's surface.
    grow(Math.cos(bearing) * r0 * 0.3, Math.sin(bearing) * r0 * 0.3, bearing, length, h0, w0, 0);
  }

  // Small roots in the gaps, low and short: the difference between a few big
  // roots on a lawn and a root system.
  for (let i = 0; i < n; i++) {
    if (rand() < 0.35) continue;
    const a = bearings[i];
    const b = bearings[(i + 1) % n] + (i + 1 === n ? Math.PI * 2 : 0);
    const bearing = a + (b - a) * (0.35 + 0.3 * rand());
    const length = r0 * (1.3 + 1.1 * rand());
    grow(Math.cos(bearing) * r0 * 0.5, Math.sin(bearing) * r0 * 0.5, bearing, length, r0 * style.rise * (0.3 + 0.25 * rand()), r0 * (0.3 + 0.12 * rand()), 1);
  }

  return {
    r0,
    // Tall enough to hold the buttress web, never so tall the base becomes a
    // cone the whole tree stands on.
    top: Math.min(r0 * (1.6 + 1.1 * style.buttress), Math.max(0.6, height) * 0.16),
    sink,
    floor: -r0 * 0.08,
    reach: reach + r0 * 0.3,
    flare: style.flare,
    filletLow: r0 * 0.3,
    filletHigh: r0 * (0.45 + 0.6 * style.buttress),
    crest,
    roots,
  };
}

/** Polynomial smooth maximum: `max` with the corner rounded over a width `k`. */
function smax(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

/**
 * The height of the root field at (x, z), relative to the trunk's foot.
 *
 * Within one root the segments are combined with a plain maximum — they are
 * pieces of the same ridge, and rounding their joints would put a bump at each
 * one. Between roots it is a smooth one, which is what lets a fork part from
 * its parent as a single swelling rather than two ridges crossing.
 */
export function rootField(plan: RootPlan, x: number, z: number): number {
  let field = plan.floor;
  const blend = plan.r0 * 0.12;
  for (const root of plan.roots) {
    if (x < root.minX || x > root.maxX || z < root.minZ || z > root.maxZ) continue;
    let best = -Infinity;
    for (const s of root.segments) {
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const len2 = dx * dx + dz * dz;
      const u = len2 > 0 ? Math.min(1, Math.max(0, ((x - s.ax) * dx + (z - s.az) * dz) / len2)) : 0;
      const ex = x - (s.ax + dx * u);
      const ez = z - (s.az + dz * u);
      const w = s.wa + (s.wb - s.wa) * u;
      const e2 = (ex * ex + ez * ez) / (w * w);
      if (e2 >= 1) continue;
      const crestHere = s.ca + (s.cb - s.ca) * u;
      // Round over the crest and flaring out at the foot, the way soil banks
      // up along a root. A root dies away by sinking, with its width intact,
      // rather than by narrowing to a claw.
      const y = plan.floor + (crestHere - plan.floor) * Math.pow(1 - e2, 1.15);
      if (y > best) best = y;
    }
    if (best > -Infinity) field = smax(field, best, blend);
  }
  return field;
}

/** What the base needs to know about the trunk tube it hands over to. */
export interface TrunkSampler {
  /** Radial segments of the trunk tube; the base uses the same columns. */
  segs: number;
  /** The tube's lowest ring, which the base's first row repeats exactly. */
  ring: {
    y: number;
    center: Vector3;
    /** The tube's frame there: ring vertex k sits along `a·cos t + b·sin t`, t = 2πk/segs. */
    a: Vector3;
    b: Vector3;
    positions: number[];
    normals: number[];
    arc: number;
  };
  /** Trunk axis at height `y`, extended straight down below the lowest sample. */
  centerAt(y: number, out: Vector3): Vector3;
  /** The tube's own surface radius at height `y` and frame angle `t`, irregularities included. */
  radiusAt(y: number, t: number): number;
  arcAt(y: number): number;
  flexAt(y: number): number;
  seed: number;
  maxArc: number;
}

/** The buffers `emitBase` appends to — the same ones the branch tubes fill. */
export interface BaseTarget {
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

const WALL_ROWS = 14;
const FILLET_ROWS = 10;
const SKIRT_ROWS = 30;

const _c = new Vector3();

/**
 * Sweep the base: one column per trunk segment, each running down the wall,
 * round the fillet and out over the root field.
 *
 * Rows are aligned by *phase* — wall rows with wall rows, fillet with fillet —
 * rather than by height or distance, so no quad ever straddles a phase and
 * spans a fillet diagonally, which would crease it.
 */
export function emitBase(buf: BaseTarget, plan: RootPlan, trunk: TrunkSampler, field: CanopyOcclusion): void {
  const M = trunk.segs;
  const cols = M + 1;
  const rows = 1 + WALL_ROWS + FILLET_ROWS + SKIRT_ROWS;
  const count = rows * cols;

  const P = new Float32Array(count * 3);
  const C = new Float32Array(count * 3);
  const V = new Float32Array(count);
  const B = new Float32Array(count);
  const X = new Float32Array(count);

  const top = trunk.ring.y;
  const foot = -plan.sink * 1.15;
  const reachOut = plan.reach;
  const wallR = (y: number, t: number) => {
    const f = Math.min(1, Math.max(0, 1 - y / top));
    return trunk.radiusAt(y, t) * (1 + plan.flare * Math.pow(f, 2.4));
  };

  for (let k = 0; k < cols; k++) {
    const t = ((k % M) / M) * Math.PI * 2;
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);
    // The tube's own direction for this column, and the same flattened onto
    // the ground, which is what the column runs out along.
    const tx = trunk.ring.a.x * cosT + trunk.ring.b.x * sinT;
    const ty = trunk.ring.a.y * cosT + trunk.ring.b.y * sinT;
    const tz = trunk.ring.a.z * cosT + trunk.ring.b.z * sinT;
    let nx = tx;
    let nz = tz;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;

    // The field is planned about the trunk's foot.
    const fieldAt = (rho: number) => rootField(plan, nx * rho, nz * rho);

    // How much root there is at this bearing decides how wide, and so how
    // tall, the fillet is: a buttress over a root, a tight crease between.
    const rIn = wallR(0, t);
    const crestHere = fieldAt(rIn);
    const ridge = Math.min(1, Math.max(0, (crestHere - plan.floor) / (plan.crest - plan.floor)));
    // Never so tall it runs off the top of the base.
    const fillet = Math.max(
      plan.r0 * 0.08,
      Math.min(top * 0.82 - crestHere, plan.filletLow + (plan.filletHigh - plan.filletLow) * ridge * ridge * (3 - 2 * ridge)),
    );
    const wallFoot = crestHere + fillet;
    const rBase = wallR(wallFoot, t);
    const aMax = Math.max(fillet * 1.5, reachOut - rBase);

    let row = 0;
    const put = (x: number, y: number, z: number, cx: number, cy: number, cz: number, birth: number, flex: number) => {
      const i = row * cols + k;
      P[i * 3] = x;
      P[i * 3 + 1] = y;
      P[i * 3 + 2] = z;
      C[i * 3] = cx;
      C[i * 3 + 1] = cy;
      C[i * 3 + 2] = cz;
      B[i] = birth;
      X[i] = flex;
      row++;
    };

    // ---- Wall, from the tube's last ring down to where the fillet begins.
    // The first row *is* that ring; the direction eases from the tube's frame
    // to level over the first few rows, which only matters if the trunk leans.
    for (let j = 0; j <= WALL_ROWS; j++) {
      const f = j / WALL_ROWS;
      const y = top + (wallFoot - top) * Math.pow(f, 0.9);
      const ease = Math.min(1, j / 3);
      let dx = tx + (nx - tx) * ease;
      let dy = ty * (1 - ease);
      let dz = tz + (nz - tz) * ease;
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl;
      dy /= dl;
      dz /= dl;
      if (j === 0) {
        const o = k * 3;
        put(trunk.ring.positions[o], trunk.ring.positions[o + 1], trunk.ring.positions[o + 2], trunk.ring.center.x, trunk.ring.center.y, trunk.ring.center.z, 0, trunk.flexAt(top));
        V[k] = trunk.ring.arc;
        continue;
      }
      trunk.centerAt(Math.max(y, 0), _c);
      const r = wallR(y, t);
      put(_c.x + dx * r, y + dy * r, _c.z + dz * r, _c.x, y, _c.z, 0, trunk.flexAt(Math.max(0, y)));
      V[row * cols - cols + k] = trunk.arcAt(y);
    }

    // ---- Fillet: the zero set of the quadratic smooth-min of the wall
    // distance `a` and the height above the field `b`. Parameterised by
    // u = b - a, which runs from +k (still on the wall) to -k (on the field),
    // where it meets each with matching slope.
    for (let j = 1; j <= FILLET_ROWS; j++) {
      const u = fillet * (1 - (2 * j) / FILLET_ROWS);
      let a: number;
      let b: number;
      if (u >= 0) {
        a = ((fillet - u) * (fillet - u)) / (4 * fillet);
        b = a + u;
      } else {
        b = ((fillet + u) * (fillet + u)) / (4 * fillet);
        a = b - u;
      }
      const rho = rBase + a;
      const y = fieldAt(rho) + b;
      trunk.centerAt(Math.max(y, 0), _c);
      // The pivot slides out under the root and down below the soil, so that
      // what is a trunk's radius on the wall becomes a root's thickness out
      // here — the bark keeps its scale, and growth lifts the roots out of
      // the ground rather than dragging them in from the trunk.
      const w = j / FILLET_ROWS;
      const ease = w * w * (3 - 2 * w);
      const slide = (rho - rBase) * ease;
      put(_c.x + nx * rho, y, _c.z + nz * rho, _c.x + nx * slide, y + (foot - y) * ease, _c.z + nz * slide, 0.06 * ease, trunk.flexAt(Math.max(0, y)) * (1 - ease));
    }

    // ---- Field, out to where every root is long gone under the soil. Rows
    // crowd toward the trunk, where the shapes are.
    for (let j = 1; j <= SKIRT_ROWS; j++) {
      const f = j / SKIRT_ROWS;
      const a = fillet + (aMax - fillet) * Math.pow(f, 1.5);
      const rho = rBase + a;
      const y = fieldAt(rho);
      trunk.centerAt(Math.max(y, 0), _c);
      const slide = rho - rBase;
      // Roots fill out after the trunk has: a stem exists before anything
      // anchors it, and they push outward ring by ring as it thickens.
      const birth = 0.06 + 0.6 * Math.pow(Math.min(1, a / aMax), 0.8);
      put(_c.x + nx * rho, y, _c.z + nz * rho, _c.x + nx * slide, foot, _c.z + nz * slide, birth, 0);
    }
  }

  // Arc length runs on down the profile, so the bark's grain follows the
  // trunk into each root.
  for (let k = 0; k < cols; k++) {
    for (let j = WALL_ROWS + 1; j < rows; j++) {
      const i = j * cols + k;
      const p = i - cols;
      const step = Math.hypot(P[i * 3] - P[p * 3], P[i * 3 + 1] - P[p * 3 + 1], P[i * 3 + 2] - P[p * 3 + 2]);
      V[i] = V[p] - step;
    }
  }

  // Normals from the surface itself. Row 0 copies the tube's own, so the
  // shading does not change where the tube hands over.
  const base = buf.position.length / 3;
  for (let j = 0; j < rows; j++) {
    for (let k = 0; k < cols; k++) {
      const i = j * cols + k;
      let nxv: number;
      let nyv: number;
      let nzv: number;
      if (j === 0) {
        nxv = trunk.ring.normals[k * 3];
        nyv = trunk.ring.normals[k * 3 + 1];
        nzv = trunk.ring.normals[k * 3 + 2];
      } else {
        const up = (j - 1) * cols + k;
        const down = Math.min(rows - 1, j + 1) * cols + k;
        const kl = k === 0 ? M - 1 : k - 1;
        const kr = k === M ? 1 : k + 1;
        const left = j * cols + kl;
        const right = j * cols + kr;
        // Down the profile, then round the trunk: (down × around) points out.
        const rx = P[down * 3] - P[up * 3];
        const ry = P[down * 3 + 1] - P[up * 3 + 1];
        const rz = P[down * 3 + 2] - P[up * 3 + 2];
        const ax = P[right * 3] - P[left * 3];
        const ay = P[right * 3 + 1] - P[left * 3 + 1];
        const az = P[right * 3 + 2] - P[left * 3 + 2];
        nxv = ry * az - rz * ay;
        nyv = rz * ax - rx * az;
        nzv = rx * ay - ry * ax;
        const l = Math.hypot(nxv, nyv, nzv) || 1;
        nxv /= l;
        nyv /= l;
        nzv /= l;
      }
      const x = P[i * 3];
      const y = P[i * 3 + 1];
      const z = P[i * 3 + 2];
      buf.position.push(x, y, z);
      buf.normal.push(nxv, nyv, nzv);
      buf.uv.push(k / M, V[i]);
      buf.center.push(C[i * 3], C[i * 3 + 1], C[i * 3 + 2]);
      buf.origin.push(C[i * 3], C[i * 3 + 1], C[i * 3 + 2]);
      buf.birth.push(Math.max(B[i], Math.min(1, Math.max(0, trunk.arcAt(Math.max(0, y)) / trunk.maxArc))));
      buf.flex.push(X[i]);
      buf.seed.push(trunk.seed);
      buf.occlusion.push(field.sample(x, Math.max(0, y), z));
    }
  }

  // Quads entirely under the soil are never seen, and most of the field
  // between roots is exactly that.
  const buried = plan.floor * 0.6;
  for (let j = 0; j < rows - 1; j++) {
    for (let k = 0; k < M; k++) {
      const u0 = j * cols + k;
      const u1 = u0 + 1;
      const l0 = u0 + cols;
      const l1 = l0 + 1;
      if (P[u0 * 3 + 1] < buried && P[u1 * 3 + 1] < buried && P[l0 * 3 + 1] < buried && P[l1 * 3 + 1] < buried) continue;
      // Wound like the tube, lower ring first, so the faces point outward.
      buf.index.push(base + l0, base + l1, base + u1, base + l0, base + u1, base + u0);
    }
  }
}
