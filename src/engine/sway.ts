/**
 * How each part of the tree answers the wind.
 *
 * The shader leans the whole tree about its base, each vertex by an angle in
 * proportion to its `flex`, and flex grows with height: the crown moves, the
 * trunk does not. That is right for wood that grows up, and exactly wrong for
 * wood that hangs. A willow's shoot dropping from six metres up to one would
 * get a one-metre flex at its tip, so the branch it hangs from would sway
 * while its tip stood still — a curtain pinned to the lawn, swaying from the
 * bottom like weed in a current.
 *
 * So flex is taken per node, and a node never bends less than the wood it
 * hangs from: what hangs moves with what holds it. And whatever hangs below
 * where it started to fall carries a second weight, its *pendulum* length,
 * which the shader turns into a swing downwind on top of the lean — the
 * further a shoot hangs, the further its tip is blown.
 *
 * Both ride in the one `aParams` slot flex always had, `pack`ed, because
 * WebGPU gives a mesh only eight vertex buffers and all eight are spoken for.
 */
import type { Skeleton } from './lsystem/turtle';

export interface Sway {
  /** The lean weight of each node. */
  flex: Float32Array;
  /** How far each node hangs below where its run started to fall, in metres. */
  pend: Float32Array;
}

/** The lean weight of wood of radius `r` at height `y` taken on its own. */
export function flexOf(r: number, y: number, trunkRadius: number, height: number): number {
  const thin = 1 - Math.min(1, r / Math.max(1e-5, trunkRadius));
  const h = Math.max(0, Math.min(1, y / Math.max(0.5, height)));
  return Math.pow(h, 1.3) * (0.62 + 0.38 * Math.pow(thin, 1.5));
}

export function computeSway(skel: Skeleton): Sway {
  const { pos, parent, radius, count } = skel;
  const flex = new Float32Array(count);
  const pend = new Float32Array(count);
  const trunk = Math.max(1e-5, skel.maxRadius);
  // Parents are always pushed before their children, so one pass in index
  // order sees every parent finished.
  for (let i = 0; i < count; i++) {
    const y = pos[i * 3 + 1];
    const own = flexOf(radius[i], y, trunk, skel.height);
    const p = parent[i];
    if (p < 0) {
      flex[i] = own;
      continue;
    }
    const drop = pos[p * 3 + 1] - y;
    flex[i] = Math.max(own, flex[p]);
    // Falling adds to the pendulum; climbing again takes it back off.
    pend[i] = Math.max(0, pend[p] + drop);
  }
  return { flex, pend };
}

/** Pendulum lengths are kept to this resolution, in metres. */
const PEND_STEP = 0.05;
const PEND_MAX = 400;

/**
 * Both into one float: the pendulum, quantised, in the even integers, and
 * flex (always under 2) in what is left. `treeParams` takes them apart.
 */
export function pack(flex: number, pend: number): number {
  const q = Math.min(PEND_MAX, Math.max(0, Math.round(pend / PEND_STEP)));
  return 2 * q + Math.min(1.999, Math.max(0, flex));
}

export const PEND_UNIT = PEND_STEP;
