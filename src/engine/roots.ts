/**
 * Root flare and surface roots.
 *
 * A trunk that meets the ground at a right angle reads as a post someone
 * pushed into the soil, and no amount of bark detail rescues it — the tell is
 * the silhouette, not the surface. Real trees widen sharply over the last
 * fraction of their height and that widening is *lobed*: each swelling is a
 * major lateral root pushing the trunk outward before it leaves. The flare and
 * the roots are the same structure seen above and below the soil line, which is
 * why they have to be planned together rather than modelled separately and
 * hoped to line up.
 *
 * So one plan drives both. `flareScale` bulges the trunk toward each root's
 * bearing, and `emitRoots` sends the roots out from inside those bulges — they
 * begin *within* the flared trunk, so the join needs no blending and cannot
 * show a seam.
 *
 * Everything is scaled by the trunk's own base radius, so a sapling gets a
 * sapling's buttress and a baobab gets a baobab's.
 */
import { Vector3 } from 'three';
import type { CanopyOcclusion } from './occlusion';

export interface RootPlan {
  /** Trunk radius where it meets the ground. */
  base: number;
  /** How far up the trunk the flare reaches. */
  flareHeight: number;
  /** How far the trunk is buried, so a dip in the ground cannot expose the end. */
  bury: number;
  /** Uniform swelling at the soil line, as a fraction of the base radius. */
  spread: number;
  /** Extra swelling on the lobes, on top of `spread`. */
  lobe: number;
  roots: RootSpur[];
}

interface RootSpur {
  /** World bearing, `atan2(z, x)`. */
  azimuth: number;
  /** Relative prominence of this root's lobe, 0-1. */
  weight: number;
  /** Angular half-width of the lobe, in radians. */
  width: number;
  /** How far out it runs, in base radii. */
  reach: number;
  /** Thickness where it leaves the trunk, in base radii. */
  thickness: number;
  /** How far it sinks by the time it ends, in base radii. */
  dive: number;
  /** Lateral meander, in radians. */
  wander: number;
  phase: number;
}

/** Deterministic per-tree noise, so Shuffle reshuffles the roots too. */
function rng(seed: number): () => number {
  let s = (seed | 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 8) & 0xffffff) / 0x1000000;
  };
}

export function planRoots(baseRadius: number, height: number, seed: number): RootPlan {
  const rand = rng(seed * 2654435761 + 17);
  const base = Math.max(1e-4, baseRadius);

  // Five to eight majors. Fewer reads as a tripod; more and the lobes merge
  // back into the plain cone they were meant to break up.
  const n = 5 + Math.floor(rand() * 4);
  const step = (Math.PI * 2) / n;
  const roots: RootSpur[] = [];
  const spin = rand() * Math.PI * 2;

  for (let i = 0; i < n; i++) {
    // Jittered off the even spacing. Perfectly spaced roots read as machined,
    // but let them cross and the lobes stack into one lump, so the jitter is
    // kept under half a step.
    const azimuth = spin + step * (i + (rand() - 0.5) * 0.62);
    roots.push({
      azimuth,
      weight: 0.55 + rand() * 0.45,
      width: step * (0.45 + rand() * 0.22),
      reach: 4.8 + rand() * 2.2,
      thickness: 0.24 + rand() * 0.14,
      dive: 2.2 + rand() * 1.0,
      wander: (rand() - 0.5) * 0.5,
      phase: rand() * Math.PI * 2,
    });
  }

  return {
    base,
    // Tall enough to read as a buttress, short enough that it is clearly the
    // foot of the trunk rather than a cone the whole tree stands on. Capped
    // against the tree's height as well as its girth, because a very stout
    // trunk — a baobab is two and a half times an oak's — otherwise carries its
    // buttress a fifth of the way up itself.
    flareHeight: Math.min(base * 2.4, Math.max(0.5, height) * 0.12),
    bury: base * 0.9,
    spread: 0.3,
    lobe: 0.7,
    roots,
  };
}

/**
 * How much wider the trunk is at this height and bearing.
 *
 * Returns 1 above the flare, so callers can apply it unconditionally.
 */
export function flareScale(plan: RootPlan, y: number, dx: number, dz: number): number {
  const t = 1 - Math.min(1, Math.max(0, y / plan.flareHeight));
  if (t <= 0) return 1;
  // Squared, then smoothed: a linear flare meets the trunk at a visible kink,
  // and the eye finds that crease immediately.
  const ease = t * t * (3 - 2 * t) * t;

  const phi = Math.atan2(dz, dx);
  let lobe = 0;
  for (const r of plan.roots) {
    const d = Math.atan2(Math.sin(phi - r.azimuth), Math.cos(phi - r.azimuth));
    // Strongest lobe wins rather than summing them. Summing lets two roots that
    // happen to sit close together inflate the trunk into a balloon.
    const g = Math.exp(-(d * d) / (2 * r.width * r.width)) * r.weight;
    if (g > lobe) lobe = g;
  }

  return 1 + ease * (plan.spread + plan.lobe * lobe);
}

/** The buffers `emitRoots` appends to — the same ones the branch tubes fill. */
export interface RootTarget {
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

const LENGTH_SEGMENTS = 9;
const RADIAL_SEGMENTS = 8;

const _p = new Vector3();
const _tangent = new Vector3();
const _next = new Vector3();
const _na = new Vector3();
const _nb = new Vector3();
const _dir = new Vector3();
const _normal = new Vector3();

function perpendicular(v: Vector3, out: Vector3): void {
  if (Math.abs(v.y) < 0.9) out.set(0, 1, 0);
  else out.set(1, 0, 0);
  out.crossVectors(v, out).normalize();
  if (out.lengthSq() < 1e-8) out.set(1, 0, 0);
}

/**
 * Append every root spur as a tapered tube.
 *
 * Each one starts *inside* the flared trunk and sweeps outward while sinking,
 * so what you see above the soil is the shoulder of the root and the rest is
 * simply below the ground plane. Roots take no wind — `flex` is zero.
 */
export function emitRoots(buf: RootTarget, plan: RootPlan, field: CanopyOcclusion, seedBase: number): void {
  const pts: number[] = [];
  const radii: number[] = [];

  for (let ri = 0; ri < plan.roots.length; ri++) {
    const spur = plan.roots[ri];
    pts.length = 0;
    radii.length = 0;

    for (let j = 0; j <= LENGTH_SEGMENTS; j++) {
      const t = j / LENGTH_SEGMENTS;
      const az = spur.azimuth + spur.wander * Math.sin(t * 2.7 + spur.phase);
      // Starts well inside the trunk — the flare runs to about twice the base
      // radius at the soil line — so the join is buried inside solid wood.
      //
      // How fast it travels outward matters more than how far it goes. Rush it
      // — anything below about `t^0.7` — and the root has covered most of its
      // reach before the dive has taken it anywhere, so it lies along the grass
      // no matter how steeply it eventually sinks. What should show is a hump
      // roughly a trunk-radius wide, arching out of the flare and straight back
      // under. The rest of the reach happens underground, where it is free.
      const out = plan.base * (0.55 + (spur.reach - 0.55) * Math.pow(t, 0.8));
      // Leaves from the *low* shoulder of the flare and sinks hard.
      //
      // Both failure modes here are about the descent rate, and both look
      // nothing like a tree. Leave from high up and sink gently and the tree
      // stands on arches with daylight underneath — a mangrove on stilts. Sink
      // too gently from low down and the roots lie along the surface like logs
      // dropped on the lawn, which is worse, because a tube whose *centre* is
      // just below zero still has its whole upper half above the grass.
      //
      // So the root has to be properly buried within a couple of segments of
      // crossing: about a quarter of its length shows, and the rest is gone.
      const y =
        plan.flareHeight * 0.3 * Math.pow(1 - t, 1.5) -
        plan.base * spur.dive * Math.pow(t, 1.2);

      pts.push(Math.cos(az) * out, y, Math.sin(az) * out);
      // Never quite to a point: a tube that tapers to zero radius has a
      // degenerate ring whose normals are undefined, and it shades as a spike.
      radii.push(plan.base * spur.thickness * Math.pow(1 - t, 1.5) + plan.base * 0.05);
    }

    emitTube(buf, pts, radii, field, seedBase + ri * 0.173);
  }
}

function emitTube(
  buf: RootTarget,
  pts: number[],
  radii: number[],
  field: CanopyOcclusion,
  seed: number,
): void {
  const n = radii.length;
  const ringVerts = RADIAL_SEGMENTS + 1;
  const base = buf.position.length / 3;

  const tangentAt = (i: number, out: Vector3) => {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    out.set(pts[b * 3] - pts[a * 3], pts[b * 3 + 1] - pts[a * 3 + 1], pts[b * 3 + 2] - pts[a * 3 + 2]);
    if (out.lengthSq() < 1e-12) out.set(1, 0, 0);
    out.normalize();
  };

  // Parallel-transport frame, same as the branch tubes: rotate the previous
  // frame minimally onto each new tangent so the tube does not spin along its
  // length and shear its own UVs.
  tangentAt(0, _tangent);
  perpendicular(_tangent, _na);
  _nb.crossVectors(_tangent, _na).normalize();

  for (let i = 0; i < n; i++) {
    if (i > 0) {
      tangentAt(i, _next);
      _na.addScaledVector(_next, -_na.dot(_next));
      if (_na.lengthSq() < 1e-10) perpendicular(_next, _na);
      else _na.normalize();
      _nb.crossVectors(_next, _na).normalize();
      _tangent.copy(_next);
    }

    const cx = pts[i * 3];
    const cy = pts[i * 3 + 1];
    const cz = pts[i * 3 + 2];
    const r = radii[i];
    const t = i / (n - 1);

    const oi = Math.max(0, i - 1);
    const ox = pts[oi * 3];
    const oy = pts[oi * 3 + 1];
    const oz = pts[oi * 3 + 2];

    const occlusion = field.sample(cx, Math.max(0, cy), cz);

    // Roots swell outward *with* the trunk, they do not precede it.
    //
    // Born in the first tenth of the animation — as they were — the whole root
    // system snaps to full reach while the trunk is still a sliver, so the tree
    // spends its early life as a starfish of roots around a hollow centre and
    // then grows a trunk up through the middle of it. Nothing grows in that
    // order.
    //
    // So birth starts well after zero — a stem exists before anything anchors
    // it — and is spread along the root, which makes it extend ring by ring,
    // pushed out from the base rather than snapping to full reach. The visible
    // hump sits around t = 0.2-0.35, which puts its emergence between a quarter
    // and a half of the way through, exactly while the trunk is thickening. The
    // rest of the root arrives later still, and is underground, so nobody sees
    // it happen.
    const birth = 0.14 + t * 0.7;

    const rPrev = radii[Math.max(0, i - 1)];
    const rNext = radii[Math.min(n - 1, i + 1)];
    _p.set(
      pts[Math.min(n - 1, i + 1) * 3] - pts[Math.max(0, i - 1) * 3],
      pts[Math.min(n - 1, i + 1) * 3 + 1] - pts[Math.max(0, i - 1) * 3 + 1],
      pts[Math.min(n - 1, i + 1) * 3 + 2] - pts[Math.max(0, i - 1) * 3 + 2],
    );
    const slope = (rNext - rPrev) / Math.max(1e-4, _p.length());

    for (let k = 0; k <= RADIAL_SEGMENTS; k++) {
      const a = (k / RADIAL_SEGMENTS) * Math.PI * 2;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      _dir.set(
        _na.x * cosA + _nb.x * sinA,
        _na.y * cosA + _nb.y * sinA,
        _na.z * cosA + _nb.z * sinA,
      );

      // Roots are not round. Flattening them against the ground and rippling
      // them along their length is most of what separates a root from a pipe.
      const flatten = 1 - 0.16 * _dir.y * _dir.y;
      const ripple = 1 + 0.1 * Math.sin(a * 3 + seed * 6.3 + t * 7.0);
      const rr = r * flatten * ripple;

      _normal.copy(_dir).addScaledVector(_tangent, -slope).normalize();

      buf.position.push(cx + _dir.x * rr, cy + _dir.y * rr, cz + _dir.z * rr);
      buf.normal.push(_normal.x, _normal.y, _normal.z);
      buf.uv.push(k / RADIAL_SEGMENTS, t * 1.6);
      buf.origin.push(ox, oy, oz);
      buf.center.push(cx, cy, cz);
      buf.birth.push(birth);
      // Roots do not sway.
      buf.flex.push(0);
      buf.seed.push(seed);
      buf.occlusion.push(occlusion);
    }
  }

  for (let i = 0; i < n - 1; i++) {
    const a0 = base + i * ringVerts;
    const b0 = base + (i + 1) * ringVerts;
    for (let k = 0; k < RADIAL_SEGMENTS; k++) {
      buf.index.push(a0 + k, a0 + k + 1, b0 + k + 1, a0 + k, b0 + k + 1, b0 + k);
    }
  }
}
