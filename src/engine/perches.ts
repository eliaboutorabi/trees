/**
 * Places on a tree where something small could sit: a bird, a lantern, a
 * squirrel. Taken from the skeleton, so they are on real wood.
 *
 * A perch has to be a branch a bird would actually choose. Too thick and it is
 * a limb, not a perch; too thin and nothing could grip it; too steep and a bird
 * would slide off it; and too far inside the crown and nobody would see it. So
 * candidates are filtered on all four, scored toward the outer, upper crown
 * where birds sit in real trees, and thinned so no two are on top of each
 * other.
 */
import type { Skeleton } from './lsystem/turtle';

export interface Perch {
  /** Where the feet go: on top of the branch, at rest. Tree space. */
  x: number;
  y: number;
  z: number;
  /** Wind weight, exactly as the branch vertices under it carry it. */
  flex: number;
  /** Bearing of the branch, in radians about +Y. A bird sits across it. */
  along: number;
  /** When this part of the tree grows in, in growth units. */
  birth: number;
}

export interface PerchOptions {
  max?: number;
  /** Closest two perches may be, in world units. */
  spacing?: number;
}

export function findPerches(skel: Skeleton, options: PerchOptions = {}): Perch[] {
  const { max = 64, spacing = 0.75 } = options;
  const { pos, parent, radius, order, arc, count } = skel;
  const height = Math.max(0.5, skel.height);
  const spread = Math.max(0.5, skel.radiusXZ);
  const rootRadius = Math.max(1e-5, skel.maxRadius);
  const maxArc = Math.max(1e-5, skel.maxArc);

  // Leaves, hashed into cells about a perch's sight-line deep, so each
  // candidate only has to look at the few cells around it.
  const CELL = 0.6;
  const key = (x: number, y: number, z: number) =>
    `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
  const cells = new Map<string, number[]>();
  for (const leaf of skel.leaves) {
    const k = key(leaf.pos.x, leaf.pos.y, leaf.pos.z);
    let list = cells.get(k);
    if (!list) cells.set(k, (list = []));
    list.push(leaf.pos.x, leaf.pos.y, leaf.pos.z);
  }

  /*
   * How much foliage stands between a point and the open air: leaves within
   * reach that lie further out than it does. A crown is a shell of leaves right
   * to its edge, so "far from the trunk" is not enough — a twig a metre inside
   * that shell is invisible from anywhere the camera goes. A twig with nothing
   * outside it is one that pokes out of the crown, which is where a bird sits
   * to look out and where it can be seen.
   */
  const cover = (x: number, y: number, z: number) => {
    const out = Math.hypot(x, z) || 1;
    // Outward is mostly sideways, a little up: the camera sees a crown from
    // the side and a little above.
    let ox = x / out;
    let oy = 0.55;
    let oz = z / out;
    const ol = Math.hypot(ox, oy, oz);
    ox /= ol;
    oy /= ol;
    oz /= ol;
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    const cz = Math.floor(z / CELL);
    let n = 0;
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (let c = -1; c <= 1; c++) {
          const list = cells.get(`${cx + a},${cy + b},${cz + c}`);
          if (!list) continue;
          for (let k = 0; k < list.length; k += 3) {
            const dx = list[k] - x;
            const dy = list[k + 1] - y;
            const dz = list[k + 2] - z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > CELL * CELL) continue;
            if (dx * ox + dy * oy + dz * oz > 0.04) n++;
          }
        }
    return n;
  };

  const found: (Perch & { score: number })[] = [];
  for (let i = 1; i < count; i++) {
    const p = parent[i];
    if (p < 0 || order[i] < 1) continue;

    const r = radius[i];
    if (r < rootRadius * 0.03 || r > rootRadius * 0.3) continue;

    // Most of the way along the segment rather than at its end, where the
    // next segment's joint would put the feet in mid-air.
    const ax = pos[p * 3];
    const ay = pos[p * 3 + 1];
    const az = pos[p * 3 + 2];
    const dx = pos[i * 3] - ax;
    const dy = pos[i * 3 + 1] - ay;
    const dz = pos[i * 3 + 2] - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4 || Math.abs(dy) / len > 0.55) continue;

    const x = ax + dx * 0.6;
    const y = ay + dy * 0.6;
    const z = az + dz * 0.6;
    if (y < height * 0.3) continue;
    // On the outside of the crown, where a bird would be seen and could see
    // out. Deeper in, a summer canopy hides everything sitting there.
    const out = Math.hypot(x, z);
    if (out < spread * 0.5) continue;

    // The same weight the branch geometry is built with, so a perched bird
    // sways by exactly what its twig does.
    const thin = 1 - Math.min(1, r / rootRadius);
    const flex = Math.pow(Math.min(1, y / height), 1.3) * (0.62 + 0.38 * Math.pow(thin, 1.5));

    // A deterministic jitter, so ties break differently on every tree.
    const jitter = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    found.push({
      x,
      y: y + r,
      z,
      flex,
      along: Math.atan2(dx, dz),
      birth: Math.min(1, arc[i] / maxArc),
      score:
        (out / spread) * 1.0 + (y / height) * 0.6 + Math.abs(jitter) * 0.3 - Math.min(40, cover(x, y + r, z)) * 0.06,
    });
  }

  found.sort((a, b) => b.score - a.score);
  const kept: Perch[] = [];
  const gap2 = spacing * spacing;
  for (const c of found) {
    if (kept.length >= max) break;
    let clear = true;
    for (const k of kept) {
      const dx = k.x - c.x;
      const dy = k.y - c.y;
      const dz = k.z - c.z;
      if (dx * dx + dy * dy + dz * dz < gap2) {
        clear = false;
        break;
      }
    }
    if (clear) kept.push({ x: c.x, y: c.y, z: c.z, flex: c.flex, along: c.along, birth: c.birth });
  }
  return kept;
}
