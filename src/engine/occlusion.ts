/**
 * Canopy self-shadowing, baked once at build time.
 *
 * A real canopy is much darker inside than out, and without that gradient a
 * tree reads as a flat green mass no matter how many leaves it has. Shadow maps
 * only handle direct sun, so this covers the other half: how much *sky* each
 * leaf can actually see.
 *
 * Leaf area is splatted into a coarse voxel grid to give an extinction
 * coefficient per cell, then Beer–Lambert gives transmittance. Because the grid
 * stores real area per real volume, the result self-normalises — a sparse birch
 * and a dense oak both come out sensible without tuning constants per species.
 */
import { Vector3 } from 'three';

const MAX_CELLS_PER_AXIS = 48;

export class CanopyOcclusion {
  private readonly nx: number;
  private readonly ny: number;
  private readonly nz: number;
  private readonly cell: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly minZ: number;

  /** Extinction coefficient per cell, in 1/length. */
  private readonly density: Float32Array;
  /** Optical depth from each cell straight up to the sky. */
  private readonly skyDepth: Float32Array;
  private finalized = false;

  constructor(min: Vector3, max: Vector3, targetCells = 30) {
    const extent = Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 0.5);
    this.cell = extent / targetCells;

    const dim = (lo: number, hi: number) =>
      Math.min(MAX_CELLS_PER_AXIS, Math.max(1, Math.ceil((hi - lo) / this.cell) + 2));

    this.nx = dim(min.x, max.x);
    this.ny = dim(min.y, max.y);
    this.nz = dim(min.z, max.z);

    // One cell of padding, so trilinear splats near the bounds stay in range.
    this.minX = min.x - this.cell;
    this.minY = min.y - this.cell;
    this.minZ = min.z - this.cell;

    this.density = new Float32Array(this.nx * this.ny * this.nz);
    this.skyDepth = new Float32Array(this.density.length);
  }

  private index(i: number, j: number, k: number): number {
    return (k * this.ny + j) * this.nx + i;
  }

  /** Splat one leaf's surface area across the eight surrounding cells. */
  addArea(x: number, y: number, z: number, area: number): void {
    const fx = (x - this.minX) / this.cell;
    const fy = (y - this.minY) / this.cell;
    const fz = (z - this.minZ) / this.cell;

    const i0 = Math.floor(fx);
    const j0 = Math.floor(fy);
    const k0 = Math.floor(fz);
    const tx = fx - i0;
    const ty = fy - j0;
    const tz = fz - k0;

    // Area per cell volume gives an extinction coefficient in 1/length.
    const perVolume = area / (this.cell * this.cell * this.cell);

    for (let dk = 0; dk < 2; dk++) {
      const k = k0 + dk;
      if (k < 0 || k >= this.nz) continue;
      const wz = dk ? tz : 1 - tz;
      for (let dj = 0; dj < 2; dj++) {
        const j = j0 + dj;
        if (j < 0 || j >= this.ny) continue;
        const wy = dj ? ty : 1 - ty;
        for (let di = 0; di < 2; di++) {
          const i = i0 + di;
          if (i < 0 || i >= this.nx) continue;
          const wx = di ? tx : 1 - tx;
          this.density[this.index(i, j, k)] += perVolume * wx * wy * wz;
        }
      }
    }
  }

  /** Integrate density upward into an optical depth toward the sky. */
  finalize(): void {
    for (let k = 0; k < this.nz; k++) {
      for (let i = 0; i < this.nx; i++) {
        let accumulated = 0;
        for (let j = this.ny - 1; j >= 0; j--) {
          const idx = this.index(i, j, k);
          this.skyDepth[idx] = accumulated;
          accumulated += this.density[idx] * this.cell;
        }
      }
    }
    this.finalized = true;
  }

  private trilinear(field: Float32Array, x: number, y: number, z: number): number {
    const fx = (x - this.minX) / this.cell;
    const fy = (y - this.minY) / this.cell;
    const fz = (z - this.minZ) / this.cell;

    const i0 = Math.max(0, Math.min(this.nx - 1, Math.floor(fx)));
    const j0 = Math.max(0, Math.min(this.ny - 1, Math.floor(fy)));
    const k0 = Math.max(0, Math.min(this.nz - 1, Math.floor(fz)));
    const i1 = Math.min(this.nx - 1, i0 + 1);
    const j1 = Math.min(this.ny - 1, j0 + 1);
    const k1 = Math.min(this.nz - 1, k0 + 1);

    const tx = Math.max(0, Math.min(1, fx - i0));
    const ty = Math.max(0, Math.min(1, fy - j0));
    const tz = Math.max(0, Math.min(1, fz - k0));

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const c00 = lerp(field[this.index(i0, j0, k0)], field[this.index(i1, j0, k0)], tx);
    const c10 = lerp(field[this.index(i0, j1, k0)], field[this.index(i1, j1, k0)], tx);
    const c01 = lerp(field[this.index(i0, j0, k1)], field[this.index(i1, j0, k1)], tx);
    const c11 = lerp(field[this.index(i0, j1, k1)], field[this.index(i1, j1, k1)], tx);

    return lerp(lerp(c00, c10, ty), lerp(c01, c11, ty), tz);
  }

  /**
   * How buried a point is, 0 (open sky) to 1 (deep inside the canopy).
   */
  sample(x: number, y: number, z: number): number {
    if (!this.finalized) return 0;

    // Sky visibility: what survives the leaf area directly overhead.
    const skyVisibility = Math.exp(-this.trilinear(this.skyDepth, x, y, z));

    // Contact term: leaves immediately around this point block light from
    // every other direction too.
    const local = this.trilinear(this.density, x, y, z);
    const contact = Math.exp(-local * this.cell * 2.2);

    const light = skyVisibility * 0.72 + contact * 0.28;
    return Math.max(0, Math.min(1, 1 - light));
  }
}
