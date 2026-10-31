/**
 * The ground the tree stands on.
 *
 * A flat symmetric disc is what makes a slow orbit look like a turntable: the
 * environment is identical from every angle, so the only thing that appears to
 * move is the tree. Two things fix that, and both are cheap here because
 * profiling showed this scene is fill-rate bound rather than geometry bound:
 *
 *   1. Real terrain relief, so the horizon silhouette changes as you come
 *      around — an asymmetric landmark to orbit *against*.
 *   2. Scattered near-field detail. Parallax is what the eye actually reads as
 *      camera movement, and parallax is strongest close to the camera.
 *
 * The mesh uses a polar grid with quadratic radial spacing so vertices bunch up
 * near the tree, where the camera is, and thin out toward the horizon.
 */
import {
  InstancedBufferAttribute,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three';
import { MeshLambertNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { mulberry32 } from '../lib/rng';
import { pondField, pondGround } from './pond';
import { createGroundMaterial } from './materials/ground';
import { createGroundCoverMaterial } from './materials/groundCover';
import type { TreeUniforms } from '../engine/materials/shared';

export interface LandscapeOptions {
  seed: number;
  /** How far the meadow extends before the ground starts climbing. */
  radius: number;
  /** How far the mesh reaches in total, mountains included. */
  horizonRadius: number;
  /** Height of the tallest peaks. */
  mountainHeight: number;
  /** Ground stays flat within this radius so the tree is not on a slope. */
  flatRadius: number;
  /** Vertical scale of the relief. */
  relief: number;
  /** Scatter density multiplier, 0–1. */
  detail: number;
}

export const DEFAULT_LANDSCAPE: LandscapeOptions = {
  seed: 20250811,
  radius: 150,
  horizonRadius: 620,
  mountainHeight: 165,
  flatRadius: 7,
  relief: 1,
  detail: 1,
};

// ------------------------------------------------------------------ noise

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x: number, y: number, seed: number, octaves = 5): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq, seed + i * 1013) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/**
 * Ridged noise. Folding fbm about zero and inverting turns its smooth hills
 * into sharp crests with rounded valleys between them, which is the standard
 * way to get a mountain profile out of a function that otherwise only makes
 * dunes. Squaring sharpens the ridge lines further.
 */
function ridged(x: number, y: number, seed: number, octaves = 5): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  let weight = 1;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise(x * freq, y * freq, seed + i * 1013) * 2 - 1);
    // Each octave is attenuated by the one above it, so detail collects on the
    // ridges instead of spraying evenly over the slopes.
    sum += n * n * amp * weight;
    weight = Math.min(1, n * 1.4);
    norm += amp;
    amp *= 0.5;
    freq *= 2.07;
  }
  return sum / norm;
}

const smootherstep = (t: number): number => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

/**
 * Terrain height at a world position. Exported so scatter and any future
 * gameplay can sit exactly on the surface rather than guessing.
 *
 * The mountains are part of this same function rather than a separate ring
 * mesh, which is what guarantees there is no seam or sky gap where one would
 * meet the other.
 */
export function terrainHeight(x: number, z: number, opts: LandscapeOptions): number {
  const dist = Math.hypot(x, z);

  // Keep the ground level under the tree, then ease into the relief.
  const ease = smootherstep((dist - opts.flatRadius) / (opts.radius * 0.35));

  const broad = fbm(x * 0.018, z * 0.018, opts.seed, 5) - 0.5;
  const medium = fbm(x * 0.06, z * 0.06, opts.seed + 77, 4) - 0.5;
  const fine = fbm(x * 0.22, z * 0.22, opts.seed + 991, 3) - 0.5;

  // Distant ground rises into hills, which is what gives the horizon a
  // silhouette to orbit against.
  const far = Math.min(1, dist / (opts.radius * 0.7));
  const hills = broad * (14 + 26 * far * far);
  const meadow = (hills + medium * 2.2 + fine * 0.5) * ease;

  // Mountains take over past the meadow. The range is not a uniform wall: a
  // very low frequency mass term lets whole massifs rise and others sink to
  // foothills, so the skyline has somewhere for the eye to rest.
  const rise = smootherstep((dist - opts.radius * 1.05) / (opts.horizonRadius * 0.42));
  if (rise <= 0) return meadow * opts.relief + pondGround(x, z);

  const mass = Math.pow(fbm(x * 0.0026, z * 0.0026, opts.seed + 1777, 3), 1.5);
  const crest = ridged(x * 0.0043, z * 0.0043, opts.seed + 313, 6);
  const peaks = crest * (0.28 + 1.5 * mass) * opts.mountainHeight;
  // Foothills bridge the gap so the range does not spring out of flat ground.
  const skirt = (fbm(x * 0.012, z * 0.012, opts.seed + 55, 4) - 0.35) * 26;

  return (meadow + (peaks + skirt) * rise) * opts.relief;
}



// -------------------------------------------------------------- terrain

function buildTerrainGeometry(opts: LandscapeOptions): BufferGeometry {
  // Cubic rather than quadratic ring spacing, and more rings: the same detail
  // at the horizon, but rings under a third of a metre apart around the pond,
  // where the bank has to slope down to the water smoothly.
  const rings = 320;
  const sectors = 224;

  const vertexCount = (rings + 1) * (sectors + 1);
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  let p = 0;
  let t = 0;
  for (let i = 0; i <= rings; i++) {
    // Dense where the camera is, sparse at the horizon.
    const radius = opts.horizonRadius * Math.pow(i / rings, 3);
    for (let j = 0; j <= sectors; j++) {
      const a = (j / sectors) * Math.PI * 2;
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius;
      positions[p++] = x;
      positions[p++] = terrainHeight(x, z, opts);
      positions[p++] = z;
      uvs[t++] = j / sectors;
      uvs[t++] = i / rings;
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < sectors; j++) {
      const a = i * (sectors + 1) + j;
      const b = a + sectors + 1;
      // Counter-clockwise seen from above. Radius grows with `i` and angle with
      // `j`, so (a, b, a+1) spans +x then +z and its normal is x̂ × ẑ = -ŷ —
      // the whole terrain faces down, and all you see is the sky showing
      // through where the ground should be.
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setAttribute('uv', new BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// -------------------------------------------------------------- scatter

export interface TuftOptions {
  blades?: number;
  /** Sideways reach of the tip, as a fraction of the blade's height. */
  lean?: number;
  height?: number;
  width?: number;
  /** 0 keeps the true blade normal, 1 points every normal straight up. */
  upBias?: number;
}

/**
 * A clump of curved, tapered blades.
 *
 * Each blade is three triangles rather than one, which costs almost nothing and
 * buys the curve — a straight triangle reads as a splinter no matter how it is
 * shaded. Normals are bent toward vertical (see the material) and `uv.y` runs
 * from 0 at the root to 1 at the tip so the shader can shade the clump from the
 * ground up.
 */
function tuftGeometry(options: TuftOptions = {}): BufferGeometry {
  const { blades = 6, lean = 0.45, height = 0.62, width = 0.05, upBias = 0.72 } = options;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Golden angle, so the blades of one clump never line up into a star.
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));

  for (let b = 0; b < blades; b++) {
    const a = b * GOLDEN;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    // Perpendicular in the ground plane: the blade's width axis.
    const px = -dz;
    const pz = dx;

    const wobble = 0.72 + ((b * 7919) % 100) / 180;
    const h = height * wobble;
    const l = lean * (0.65 + ((b * 6151) % 100) / 130);
    const w = width * wobble;

    const base = positions.length / 3;
    const steps = [0, 0.55, 1];
    const halfWidth = [w, w * 0.55, 0];

    for (let s = 0; s < steps.length; s++) {
      const t = steps[s];
      // Blades bow over rather than tilting, so the curve is superlinear.
      const reach = l * h * Math.pow(t, 1.7);
      const cx = dx * reach;
      const cy = h * t;
      const cz = dz * reach;

      // Tangent along the blade, for the true surface normal.
      const dReach = l * h * 1.7 * Math.pow(Math.max(t, 0.001), 0.7);
      const tx = dx * dReach;
      const ty = h;
      const tz = dz * dReach;
      const tl = Math.hypot(tx, ty, tz) || 1;
      const ux = tx / tl;
      const uy = ty / tl;
      const uz = tz / tl;
      // n = p × tangent, with p = (px, 0, pz).
      let nx = -pz * uy;
      let ny = pz * ux - px * uz;
      let nz = px * uy;
      // Bend toward straight up. A near-horizontal normal renders black under a
      // low sun, which is exactly the failure mode this whole file exists to
      // avoid.
      nx = nx * (1 - upBias);
      ny = ny * (1 - upBias) + upBias;
      nz = nz * (1 - upBias);
      const nl = Math.hypot(nx, ny, nz) || 1;

      if (t < 1) {
        positions.push(cx + px * halfWidth[s], cy, cz + pz * halfWidth[s]);
        positions.push(cx - px * halfWidth[s], cy, cz - pz * halfWidth[s]);
        normals.push(nx / nl, ny / nl, nz / nl, nx / nl, ny / nl, nz / nl);
        uvs.push(0, t, 1, t);
      } else {
        positions.push(cx, cy, cz);
        normals.push(nx / nl, ny / nl, nz / nl);
        uvs.push(0.5, 1);
      }
    }

    // base(0,1) → mid(2,3) → tip(4)
    indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
    indices.push(base + 2, base + 3, base + 4);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * A distant tree: a trunk under a crown built from stacked, jittered rings.
 *
 * A single cone reads as a cone no matter how far away it is, because its
 * silhouette is two perfectly straight lines meeting at a point. Real trees
 * read as trees at distance almost entirely through an irregular outline, so
 * each ring's radius here is pushed around by a deterministic wobble and the
 * profile is a curve rather than a straight taper.
 */
function distantTreeGeometry(kind: 'conifer' | 'broadleaf' | 'columnar', variant: number): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const segments = 7;
  const rings = kind === 'conifer' ? 8 : 6;
  const rand = mulberry32(variant * 7919 + 17);
  // Three numbers for each ring of vertices — and there are rings + 1 of them,
  // top and bottom both. (Sized for `rings`, the crown's tip read past the end,
  // and its last row of vertices came out NaN.)
  const jitter: number[] = [];
  for (let i = 0; i < (rings + 1) * 3; i++) jitter.push(rand());

  // Trunk height as a fraction of the whole, and where the crown is widest.
  const bare = kind === 'conifer' ? 0.1 : kind === 'columnar' ? 0.08 : 0.3;
  const widest = kind === 'conifer' ? 0.12 : kind === 'columnar' ? 0.45 : 0.35;
  const maxWidth = kind === 'conifer' ? 0.3 : kind === 'columnar' ? 0.17 : 0.42;

  const profile = (t: number): number => {
    if (t <= bare) return 0.035;
    const u = (t - bare) / (1 - bare);
    if (kind === 'conifer') {
      // Concave taper, plus tiers — a spruce is a stack of skirts, not a cone.
      const tier = 1 + Math.sin(u * Math.PI * 3.4) * 0.13;
      return maxWidth * Math.pow(1 - u, 0.78) * tier;
    }
    if (kind === 'columnar') {
      return maxWidth * Math.sin(Math.pow(u, 0.62) * Math.PI) ** 0.55;
    }
    // Broadleaf: a rounded mass sitting on the trunk.
    const d = (u - widest) / (u > widest ? 1 - widest : widest);
    return maxWidth * Math.sqrt(Math.max(0, 1 - d * d));
  };

  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const base = profile(t);
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      // Two harmonics of wobble: the outline has to break up, but coherently,
      // or the crown turns into noise instead of foliage.
      const wob =
        1 +
        Math.sin(a * 3 + jitter[r * 3] * 6.28) * 0.19 +
        Math.sin(a * 5 - jitter[r * 3 + 1] * 6.28 + t * 4) * 0.11;
      const radius = base * (t <= bare ? 1 : wob);
      const y = t + (t > bare ? (jitter[r * 3 + 2] - 0.5) * 0.035 : 0);
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      positions.push(nx * radius, y, nz * radius);
      // Normals lean upward for the same reason grass normals do: a distant
      // crown lit only on its sides goes black against a low sun.
      normals.push(nx * 0.6, 0.75, nz * 0.6);
      uvs.push(s / segments, t);
    }
  }

  const stride = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * stride + s;
      const b = a + stride;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * How likely a plant at (x, z) is to be there, near the rim of a patch.
 *
 * A patch scattered evenly over a disc ends in a circle, and from any height
 * the circle is all you see. So the density falls away over the outer
 * `softness` of the radius, towards a rim that itself wanders in and out with
 * low-frequency noise — a ragged, uneven edge, the way a meadow gives way to
 * shorter turf. 1 well inside the patch, 0 beyond its rim.
 */
export function rimKeep(x: number, z: number, maxRadius: number, softness: number, seed: number): number {
  const wobble = fbm(x * 0.06 + 31.7, z * 0.06 - 12.3, seed + 911, 3);
  const rim = maxRadius * (0.72 + 0.4 * wobble);
  const start = rim * (1 - softness);
  const r = Math.hypot(x, z);
  const t = Math.min(1, Math.max(0, (r - start) / Math.max(1e-3, rim - start)));
  return 1 - t * t * (3 - 2 * t);
}

export interface ScatterOptions {
  count: number;
  minRadius: number;
  maxRadius: number;
  /** Uniform scale range. */
  scale: [number, number];
  seedOffset: number;
  /** How far to bury the instance, in scaled units. */
  sink?: number;
  castShadow?: boolean;
  /** Maximum yaw, in radians. Kept small where the shader sways in local space. */
  yaw?: number;
  /**
   * Reject placements where the terrain noise falls below `threshold`, so
   * instances gather into patches instead of spreading evenly. Woodland follows
   * the land; a uniform scatter of trees reads as an orchard, or as wallpaper.
   */
  clump?: { scale: number; threshold: number };
  /** Thin out towards an irregular rim over this fraction of the radius (see `rimKeep`). */
  rim?: number;
  /**
   * Smaller towards the rim as well as fewer: full size inside the first
   * radius, shrinking to nothing at the second. Baked into each instance once,
   * by distance from the tree, so it is a fact about the field, not the view.
   */
  taper?: [number, number];
  /** Per-instance tint. Hue and value variation is what stops a field of
   *  identical instances from reading as wallpaper. */
  tint?: { base: number; vary: number };
  /** Stay out of the pond: nothing where `pondField` is below this (1 is the water's edge). */
  keepOut?: number;
}

function scatter(
  geometry: BufferGeometry,
  material: MeshStandardNodeMaterial | MeshLambertNodeMaterial,
  opts: LandscapeOptions,
  s: ScatterOptions,
): InstancedMesh {
  const rng = mulberry32(opts.seed + s.seedOffset);
  const mesh = new InstancedMesh(geometry, material, s.count);
  const m = new Matrix4();
  const pos = new Vector3();
  const quat = new Quaternion();
  const scl = new Vector3();
  const axis = new Vector3(0, 1, 0);
  const color = s.tint ? new Color() : null;
  const base = s.tint ? new Color(s.tint.base) : null;
  const sink = s.sink ?? 0;
  const yaw = s.yaw ?? Math.PI * 2;

  // Each instance's root, for materials that need to grow or shrink it about
  // its own base (see the ground cover material).
  const roots = new Float32Array(s.count * 3);

  let placed = 0;
  for (let i = 0; i < s.count; i++) {
    // Square-root radial distribution keeps density even over the annulus.
    let r = 0;
    let a = 0;
    let x = 0;
    let z = 0;
    // Rejection sampling against the clump mask. Bounded, because a mask that
    // rejects everywhere must not turn into an infinite loop.
    for (let attempt = 0; attempt < 12; attempt++) {
      r = Math.sqrt(rng()) * (s.maxRadius - s.minRadius) + s.minRadius;
      a = rng() * Math.PI * 2;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      const edgeOk = !s.rim || rng() < rimKeep(x, z, s.maxRadius, s.rim, opts.seed + s.seedOffset);
      const dry = !s.keepOut || pondField(x, z) >= s.keepOut;
      if (edgeOk && dry && (!s.clump || fbm(x * s.clump.scale, z * s.clump.scale, opts.seed + 401, 3) >= s.clump.threshold)) break;
      if (attempt === 11) x = NaN;
    }
    if (Number.isNaN(x)) continue;
    let scale = s.scale[0] + rng() * (s.scale[1] - s.scale[0]);
    if (s.taper) {
      const k = Math.min(1, Math.max(0, (s.taper[1] - Math.hypot(x, z)) / (s.taper[1] - s.taper[0])));
      scale *= k * k * (3 - 2 * k);
    }
    const i2 = placed++;

    pos.set(x, terrainHeight(x, z, opts) - sink * scale, z);
    roots.set([pos.x, pos.y, pos.z], i2 * 3);
    quat.setFromAxisAngle(axis, (rng() - 0.5) * yaw);
    scl.set(scale, scale * (0.75 + rng() * 0.5), scale);
    mesh.setMatrixAt(i2, m.compose(pos, quat, scl));

    if (color && base && s.tint) {
      const k = 1 + (rng() - 0.5) * s.tint.vary;
      // Shift hue slightly with value: sunlit patches go yellow, not just pale.
      color.setRGB(base.r * k, base.g * (1 + (k - 1) * 0.7), base.b * (2 - k));
      mesh.setColorAt(i2, color);
    }
  }

  // Rejected placements would otherwise draw as identity-matrix instances piled
  // on the origin.
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  geometry.setAttribute('root', new InstancedBufferAttribute(roots, 3));
  // Grass and horizon trees are not worth a shadow-map draw: they are either
  // too small to read or outside the shadow frustum fitted around the tree.
  mesh.castShadow = s.castShadow ?? false;
  mesh.receiveShadow = true;
  // Real bounds so these can be frustum-culled instead of always submitted.
  mesh.computeBoundingSphere();
  return mesh;
}

// ---------------------------------------------------------------- public

export interface Landscape {
  group: Group;
  /** Colours shared with the ground shader, so haze can be retinted. */
  uniforms: ReturnType<typeof createGroundMaterial>['uniforms'];
  dispose(): void;
}

export function createLandscape(
  treeUniforms: TreeUniforms,
  options: Partial<LandscapeOptions> = {},
): Landscape {
  const opts = { ...DEFAULT_LANDSCAPE, ...options };
  const group = new Group();
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T): T => (disposables.push(x), x);

  const ground = createGroundMaterial();
  const terrain = new Mesh(track(buildTerrainGeometry(opts)), track(ground.material));
  terrain.receiveShadow = true;
  terrain.castShadow = false;
  group.add(terrain);

  // Grass: the near-field parallax cue, so it is densest where the camera is.
  // Yaw is deliberately small — the sway in `createGroundCoverMaterial` runs in
  // local space, so a freely spinning tuft would lean the wrong way. Six blades
  // at the golden angle make each clump near enough rotationally symmetric that
  // the missing yaw is invisible.
  const grassGeo = track(tuftGeometry({ blades: 6, lean: 0.45, height: 0.62 }));
  const grassMat = track(createGroundCoverMaterial(treeUniforms, { sway: 0.55, rootShade: 0.28 }));
  group.add(
    scatter(grassGeo, grassMat, opts, {
      // Small and dense rather than large and sparse. At this camera distance a
      // tuft you can pick out individually reads as a weed; the field only
      // reads as grass once the clumps overlap and merge into texture.
      //
      // The count is high because profiling says it is nearly free: hiding
      // every mesh in the scene does not measurably change the frame, which is
      // fill-rate bound in post rather than geometry bound. Density is the one
      // lever here that buys realism without buying cost.
      count: Math.round(52000 * opts.detail),
      minRadius: 1.2,
      maxRadius: 30,
      rim: 0.6,
      taper: [17, 31],
      scale: [0.15, 0.34],
      seedOffset: 29,
      yaw: 0.7,
      tint: { base: 0x5c6b2b, vary: 0.4 },
      // Down the bank to just above the water, where turf gives way to mud.
      keepOut: 1.14,
    }),
  );

  // Tussocks: taller, sparser, and allowed to spin freely because at this size
  // the eye reads the clump's silhouette rather than which way it leans.
  const tussockGeo = track(tuftGeometry({ blades: 8, lean: 0.7, height: 1.0, width: 0.06 }));
  const tussockMat = track(createGroundCoverMaterial(treeUniforms, { sway: 0.4, rootShade: 0.22 }));
  group.add(
    scatter(tussockGeo, tussockMat, opts, {
      count: Math.round(4200 * opts.detail),
      minRadius: 3,
      maxRadius: 58,
      rim: 0.45,
      taper: [42, 60],
      scale: [0.28, 0.7],
      seedOffset: 71,
      yaw: 1.2,
      tint: { base: 0x4e5f26, vary: 0.5 },
      keepOut: 1.32,
    }),
  );

  // Rocks: low-poly and half-buried, so they read as part of the ground rather
  // than as objects resting on it.
  const rockGeo = track(new IcosahedronGeometry(1, 0));
  const rockMat = track(new MeshStandardNodeMaterial());
  rockMat.color = new Color(0x6b6355);
  rockMat.roughness = 0.98;
  group.add(
    scatter(rockGeo, rockMat, opts, {
      count: Math.round(90 * opts.detail),
      minRadius: 8,
      maxRadius: 70,
      scale: [0.1, 0.34],
      seedOffset: 11,
      sink: 0.62,
      keepOut: 1.5,
      castShadow: true,
      tint: { base: 0xffffff, vary: 0.35 },
    }),
  );

  // A distant treeline. Three silhouettes rather than one, clumped into stands
  // that follow the land, because a uniform scatter of identical shapes reads
  // as an orchard at best and as wallpaper at worst.
  // Diffuse only. Their normals lean upward so they do not go black under a
  // low sun, which also means a specular lobe — even a fully rough one — throws
  // a glancing sheen straight at a camera looking toward the light: facing
  // the low sun, or the moon at night, the whole treeline lit up pale, a row
  // of ghosts on the hill. Woodland at this distance has no shine to give.
  const distantMat = track(new MeshLambertNodeMaterial());
  // Dark: they catch a great deal of sky, and a mid-tone albedo comes out pale
  // grey, so the stand reads as fog rather than as woodland.
  distantMat.color = new Color(0x2b3520);
  const stands: [Parameters<typeof distantTreeGeometry>[0], number, number, [number, number]][] = [
    ['conifer', 0, 620, [2.6, 6.5]],
    ['broadleaf', 1, 900, [2.4, 5.5]],
    ['columnar', 2, 220, [3, 7]],
  ];
  for (const [kind, variant, count, scale] of stands) {
    const geo = track(distantTreeGeometry(kind, variant));
    group.add(
      scatter(geo, distantMat, opts, {
        count: Math.round(count * opts.detail),
        // Far enough out that they never rival the subject. A treeline that
        // starts close reads as a forest the tree is standing in, not as a
        // horizon it is standing against.
        minRadius: 85,
        maxRadius: 165,
        scale,
        seedOffset: 53 + variant * 13,
        clump: { scale: 0.021, threshold: 0.47 },
        tint: { base: 0xffffff, vary: 0.3 },
      }),
    );
  }

  return {
    group,
    uniforms: ground.uniforms,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
