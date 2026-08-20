/**
 * Turtle interpretation: walk the derived word in 3D and record a branch
 * skeleton (nodes + parent links) plus leaf placements.
 *
 * Turtle frame convention — heading is local +Y, left is local +X, up is
 * local +Z, so rotations are plain local-axis quaternion multiplications.
 *
 *   + -   turn   (about up)        & ^   pitch (about left)      \ /  roll (about heading)
 *   |     turn 180°                $     roll level to horizon
 *   F f   forward (draw / move)    !     set radius              [ ]  push / pop
 *   L     place a leaf
 */
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { Rng } from '../../lib/rng';
import type { Module } from './grammar';

export interface Skeleton {
  /** Flat xyz triples, one per node. */
  pos: Float32Array;
  parent: Int32Array;
  radius: Float32Array;
  /** Branch order — how many `[` deep this node was created. */
  order: Uint8Array;
  /** Cumulative path length from the root, in world units. */
  arc: Float32Array;
  count: number;

  leaves: LeafPlacement[];

  maxArc: number;
  maxRadius: number;
  height: number;
  radiusXZ: number;
  center: Vector3;
  truncated: boolean;
}

export interface LeafPlacement {
  pos: Vector3;
  quat: Quaternion;
  scale: number;
  arc: number;
  order: number;
  seed: number;
  /** 0 = leaf (`L`), 1 = blossom (`K`). */
  kind: 0 | 1;
}

export interface TurtleOptions {
  /** Default angle in degrees when a rotation module has no parameter. */
  angle: number;
  /** Default step length when `F` has no parameter. */
  step: number;
  /** Radius of the thickest part of the tree after the pipe model runs. */
  trunkRadius: number;
  /** Positive bends branches skyward, negative droops them. */
  tropism: number;
  /** Recompute radii with da Vinci's pipe model for a natural taper. */
  pipeModel: boolean;
  /** Exponent for the pipe model — 2 conserves area, higher is more slender. */
  pipeExponent: number;
  leafScale: number;
  /** Scatter leaves on terminal twigs when the grammar produces none. */
  autoLeaves: boolean;
  rng: Rng;
  maxSegments?: number;
}

const DEG = Math.PI / 180;
const LOCAL_HEADING = new Vector3(0, 1, 0);
const LOCAL_LEFT = new Vector3(1, 0, 0);
const LOCAL_UP = new Vector3(0, 0, 1);
const WORLD_UP = new Vector3(0, 1, 0);
const levelBasis = new Matrix4();

interface TurtleState {
  pos: Vector3;
  quat: Quaternion;
  radius: number;
  node: number;
  order: number;
  arc: number;
  /** Per-branch tropism, saved and restored by `[` / `]`. */
  tropism: number;
}

export function interpret(word: Module[], opts: TurtleOptions): Skeleton {
  const maxSegments = opts.maxSegments ?? 80_000;
  const { rng } = opts;

  const pos: number[] = [];
  const parent: number[] = [];
  const radius: number[] = [];
  const order: number[] = [];
  const arc: number[] = [];
  const leaves: LeafPlacement[] = [];

  const pushNode = (p: Vector3, parentIndex: number, r: number, o: number, a: number): number => {
    pos.push(p.x, p.y, p.z);
    parent.push(parentIndex);
    radius.push(r);
    order.push(Math.min(255, o));
    arc.push(a);
    return parent.length - 1;
  };

  const state: TurtleState = {
    pos: new Vector3(0, 0, 0),
    quat: new Quaternion(),
    radius: 1,
    node: pushNode(new Vector3(0, 0, 0), -1, 1, 0, 0),
    order: 0,
    arc: 0,
    tropism: opts.tropism,
  };

  const stack: TurtleState[] = [];
  const scratchQuat = new Quaternion();
  const heading = new Vector3();
  const left = new Vector3();
  const up = new Vector3();
  const axis = new Vector3();

  let truncated = false;
  let minX = 0, maxX = 0, minY = 0, maxY = 0, minZ = 0, maxZ = 0;
  let maxArc = 0;

  const rotateLocal = (localAxis: Vector3, radians: number) => {
    if (radians === 0) return;
    scratchQuat.setFromAxisAngle(localAxis, radians);
    state.quat.multiply(scratchQuat).normalize();
  };

  const angleOf = (m: Module) => (m.p.length > 0 ? m.p[0] : opts.angle) * DEG;

  for (const m of word) {
    switch (m.s) {
      case 'F':
      case 'G': {
        const len = m.p.length > 0 ? m.p[0] : opts.step;
        if (m.p.length > 1) state.radius = Math.max(1e-4, m.p[1]);
        if (!(len > 0)) break;
        if (parent.length >= maxSegments) {
          truncated = true;
          break;
        }

        heading.copy(LOCAL_HEADING).applyQuaternion(state.quat);

        // Tropism: bend the heading toward (or away from) the sky, weighted by
        // how far the turtle travels in this step.
        if (state.tropism !== 0) {
          axis.crossVectors(heading, WORLD_UP);
          const mag = axis.length();
          if (mag > 1e-5) {
            axis.divideScalar(mag);
            scratchQuat.setFromAxisAngle(axis, state.tropism * mag * len);
            state.quat.premultiply(scratchQuat).normalize();
            heading.copy(LOCAL_HEADING).applyQuaternion(state.quat);
          }
        }

        state.pos.addScaledVector(heading, len);
        state.arc += len;
        state.node = pushNode(state.pos, state.node, state.radius, state.order, state.arc);

        if (state.pos.x < minX) minX = state.pos.x;
        if (state.pos.x > maxX) maxX = state.pos.x;
        if (state.pos.y < minY) minY = state.pos.y;
        if (state.pos.y > maxY) maxY = state.pos.y;
        if (state.pos.z < minZ) minZ = state.pos.z;
        if (state.pos.z > maxZ) maxZ = state.pos.z;
        if (state.arc > maxArc) maxArc = state.arc;
        break;
      }

      case 'f': {
        const len = m.p.length > 0 ? m.p[0] : opts.step;
        heading.copy(LOCAL_HEADING).applyQuaternion(state.quat);
        state.pos.addScaledVector(heading, len);
        state.arc += len;
        // A gap breaks the tube, so start a fresh strand root here.
        state.node = pushNode(state.pos, -1, state.radius, state.order, state.arc);
        break;
      }

      case '+': rotateLocal(LOCAL_UP, angleOf(m)); break;
      case '-': rotateLocal(LOCAL_UP, -angleOf(m)); break;
      case '&': rotateLocal(LOCAL_LEFT, angleOf(m)); break;
      case '^': rotateLocal(LOCAL_LEFT, -angleOf(m)); break;
      case '\\': rotateLocal(LOCAL_HEADING, angleOf(m)); break;
      case '/': rotateLocal(LOCAL_HEADING, -angleOf(m)); break;
      case '|': rotateLocal(LOCAL_UP, Math.PI); break;

      case '$': {
        // Roll so the turtle's left axis is horizontal again.
        heading.copy(LOCAL_HEADING).applyQuaternion(state.quat);
        left.crossVectors(WORLD_UP, heading);
        if (left.lengthSq() > 1e-8) {
          left.normalize();
          up.crossVectors(heading, left).normalize();
          state.quat.setFromRotationMatrix(levelBasis.makeBasis(left, heading, up));
        }
        break;
      }

      case '!':
        state.radius = m.p.length > 0 ? Math.max(1e-4, m.p[0]) : state.radius * 0.7;
        break;

      case 'T':
        state.tropism = m.p.length > 0 ? m.p[0] : opts.tropism;
        break;

      case 'L':
      case 'K': {
        const scale = (m.p.length > 0 ? m.p[0] : 1) * opts.leafScale;
        if (scale > 0) {
          leaves.push({
            pos: state.pos.clone(),
            quat: state.quat.clone().multiply(
              new Quaternion().setFromEuler(
                new Euler((rng() - 0.5) * 1.1, rng() * Math.PI * 2, (rng() - 0.5) * 0.9),
              ),
            ),
            scale: scale * (0.7 + rng() * 0.6),
            arc: state.arc,
            order: state.order,
            seed: rng(),
            kind: m.s === 'K' ? 1 : 0,
          });
        }
        break;
      }

      case '[':
        stack.push({
          pos: state.pos.clone(),
          quat: state.quat.clone(),
          radius: state.radius,
          node: state.node,
          order: state.order,
          arc: state.arc,
          tropism: state.tropism,
        });
        state.order++;
        break;

      case ']': {
        const s = stack.pop();
        if (s) {
          state.pos.copy(s.pos);
          state.quat.copy(s.quat);
          state.radius = s.radius;
          state.node = s.node;
          state.order = s.order;
          state.arc = s.arc;
          state.tropism = s.tropism;
        }
        break;
      }

      default:
        // Non-terminals and decorations (`~`, `%`, unresolved apices) draw nothing.
        break;
    }
    if (truncated) break;
  }

  const count = parent.length;
  const parentArr = Int32Array.from(parent);
  const radiusArr = Float32Array.from(radius);
  const posArr = Float32Array.from(pos);

  if (opts.pipeModel) applyPipeModel(parentArr, radiusArr, count, opts.pipeExponent);
  normalizeRadii(radiusArr, count, opts.trunkRadius);

  // Sink the root below ground and flare it, so the trunk meets the earth
  // instead of showing the open end of a tube.
  if (count > 0) {
    posArr[1] = -Math.max(0.25, radiusArr[0] * 1.2);
    radiusArr[0] *= 1.35;
  }

  if (opts.autoLeaves && leaves.length === 0) {
    scatterLeavesOnTips(posArr, parentArr, arc, count, leaves, opts);
  }

  let maxRadius = 0;
  for (let i = 0; i < count; i++) if (radiusArr[i] > maxRadius) maxRadius = radiusArr[i];

  return {
    pos: posArr,
    parent: parentArr,
    radius: radiusArr,
    order: Uint8Array.from(order),
    arc: Float32Array.from(arc),
    count,
    leaves,
    maxArc: maxArc || 1,
    maxRadius,
    height: maxY - Math.min(0, minY),
    radiusXZ: Math.max(maxX - minX, maxZ - minZ) * 0.5 || 1,
    center: new Vector3((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5),
    truncated,
  };
}

/**
 * da Vinci's pipe model: a parent branch is as thick as its children combined.
 * Runs bottom-up, which is simply reverse index order because a node is always
 * pushed after its parent.
 */
function applyPipeModel(parent: Int32Array, radius: Float32Array, count: number, exponent: number): void {
  const e = Math.max(1.2, exponent);
  const accum = new Float64Array(count);
  for (let i = 0; i < count; i++) accum[i] = 0;

  for (let i = count - 1; i >= 1; i--) {
    const own = accum[i] > 0 ? Math.pow(accum[i], 1 / e) : 1;
    radius[i] = own;
    const p = parent[i];
    if (p >= 0) accum[p] += Math.pow(own, e);
  }
  radius[0] = accum[0] > 0 ? Math.pow(accum[0], 1 / e) : 1;
}

function normalizeRadii(radius: Float32Array, count: number, trunkRadius: number): void {
  let max = 0;
  for (let i = 0; i < count; i++) if (radius[i] > max) max = radius[i];
  if (max <= 0) return;
  const k = trunkRadius / max;
  for (let i = 0; i < count; i++) radius[i] *= k;
}

/** Fallback foliage for grammars that never emit an `L` module. */
function scatterLeavesOnTips(
  pos: Float32Array,
  parent: Int32Array,
  arc: number[],
  count: number,
  leaves: LeafPlacement[],
  opts: TurtleOptions,
): void {
  const hasChild = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const p = parent[i];
    if (p >= 0) hasChild[p] = 1;
  }
  const { rng } = opts;
  const dir = new Vector3();
  const a = new Vector3();
  const b = new Vector3();
  for (let i = 1; i < count; i++) {
    if (hasChild[i]) continue;
    const p = parent[i] >= 0 ? parent[i] : i;
    a.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    b.set(pos[p * 3], pos[p * 3 + 1], pos[p * 3 + 2]);
    dir.subVectors(a, b);
    if (dir.lengthSq() < 1e-10) dir.set(0, 1, 0);
    dir.normalize();
    const quat = new Quaternion().setFromUnitVectors(LOCAL_HEADING, dir);
    for (let k = 0; k < 3; k++) {
      leaves.push({
        pos: a.clone().lerp(b, rng() * 0.5),
        quat: quat
          .clone()
          .multiply(new Quaternion().setFromEuler(new Euler((rng() - 0.5) * 1.4, rng() * Math.PI * 2, (rng() - 0.5) * 1.0))),
        scale: opts.leafScale * (0.7 + rng() * 0.6),
        arc: arc[i],
        order: 0,
        seed: rng(),
        kind: 0,
      });
    }
  }
}
