/**
 * The pond's shape: one outline, and everything that follows from it.
 *
 * An ellipse whose edge wanders in and out on a few slow harmonics, so the
 * pond is kidney-shaped rather than a circle. As a function, the outline
 * carves the hollow in the ground, keeps the grass and the flowers out of the
 * water, sends the doves round it, and tells the water how deep it is at every
 * point. Kept apart from the pond itself so the ground, the meadow and the
 * birds can ask where it is without pulling in its water and its creatures.
 */
import { atan, float, sin, smoothstep, vec2 } from 'three/tsl';

// TSL nodes are proxied at runtime and their typings do not follow chains
// through swizzles; loosely typed here, as in dof.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

export const POND = {
  /**
   * Centre, in metres from the trunk: as the camera first finds the tree,
   * about four metres to its right and four behind it, so the near end of
   * the pond tucks in behind the trunk.
   */
  x: 0.55,
  z: -5.6,
  /** Its long axis runs across the first view: a bearing about +Y, radians. */
  angle: -0.6435,
  /** Half-length and half-width, before the edge wanders. */
  rx: 3.8,
  rz: 2.5,
  /** The water's surface, a hand's breadth below the meadow. */
  level: -0.06,
  /** How far the bed falls below that in the middle. */
  depth: 0.55,
};

export const COS = Math.cos(POND.angle);
export const SIN = Math.sin(POND.angle);

/** The edge's wander, as a multiple of the ellipse, by angle round it. */
export function wander(theta: number): number {
  return 1 + 0.11 * Math.sin(2 * theta + 0.6) + 0.07 * Math.sin(3 * theta + 2.2) + 0.035 * Math.sin(5 * theta + 4.1);
}

/**
 * Where (x, z) is relative to the shore: below 1 inside the outline, 1 on it,
 * above 1 outside — a stretched distance, so 1.3 is a little way up the bank
 * wherever you are round it.
 */
export function pondField(x: number, z: number): number {
  const dx = x - POND.x;
  const dz = z - POND.z;
  const u = (dx * COS + dz * SIN) / POND.rx;
  const v = (-dx * SIN + dz * COS) / POND.rz;
  return Math.hypot(u, v) / wander(Math.atan2(v, u));
}

const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The ground's height in and around the pond, as an offset to add to the
 * meadow's: nothing past the top of the bank; a gentle slope down to just
 * under the water at the outline; and on down to the bed in the middle.
 */
export function pondGround(x: number, z: number): number {
  if (Math.abs(x - POND.x) > POND.rx * 2 || Math.abs(z - POND.z) > POND.rx * 2) return 0;
  return groundAt(pondField(x, z));
}

/**
 * A point round the pond: `theta` the angle about its centre in its own
 * frame (0 down the long axis to the right as the camera first sees it,
 * π/2 the near shore), `f` how far out (1 the water's edge). With the
 * ground's height there.
 */
export function shorePoint(theta: number, f: number): { x: number; z: number; y: number } {
  const r = f * wander(theta);
  const u = Math.cos(theta) * r * POND.rx;
  const v = Math.sin(theta) * r * POND.rz;
  return { x: POND.x + u * COS - v * SIN, z: POND.z + u * SIN + v * COS, y: groundAt(f) };
}

export function groundAt(f: number): number {
  const under = POND.level - 0.02 - POND.depth * ss(1, 0.45, f);
  return under * (1 - ss(1, 1.38, f));
}

/** The same outline, in a shader: `pondField` for a world-space xz node. */
export function pondFieldNode(xz: N): N {
  const d = xz.sub(vec2(POND.x, POND.z));
  const u = d.x.mul(COS).add(d.y.mul(SIN)).div(POND.rx);
  const v = d.x.mul(-SIN).add(d.y.mul(COS)).div(POND.rz);
  const theta = atan(v, u);
  const w = sin(theta.mul(2).add(0.6))
    .mul(0.11)
    .add(sin(theta.mul(3).add(2.2)).mul(0.07))
    .add(sin(theta.mul(5).add(4.1)).mul(0.035))
    .add(1);
  return vec2(u, v).length().div(w);
}

/** The bed's height under the water, from the field: `groundAt` in a shader. */
export function groundNode(f: N): N {
  const under = float(POND.level - 0.02).sub(smoothstep(1, 0.45, f).mul(POND.depth));
  return under.mul(smoothstep(1, 1.38, f).oneMinus());
}

