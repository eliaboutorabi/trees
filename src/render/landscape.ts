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
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { mulberry32 } from '../lib/rng';
import { createGroundMaterial } from './materials/ground';
import { createGroundCoverMaterial } from './materials/groundCover';
import type { TreeUniforms } from './materials/shared';

export interface LandscapeOptions {
  seed: number;
  /** How far the terrain extends. */
  radius: number;
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
 * Terrain height at a world position. Exported so scatter and any future
 * gameplay can sit exactly on the surface rather than guessing.
 */
export function terrainHeight(x: number, z: number, opts: LandscapeOptions): number {
  const dist = Math.hypot(x, z);

  // Keep the ground level under the tree, then ease into the relief.
  const t = Math.min(1, Math.max(0, (dist - opts.flatRadius) / (opts.radius * 0.35)));
  const ease = t * t * (3 - 2 * t);

  const broad = fbm(x * 0.018, z * 0.018, opts.seed, 5) - 0.5;
  const medium = fbm(x * 0.06, z * 0.06, opts.seed + 77, 4) - 0.5;
  const fine = fbm(x * 0.22, z * 0.22, opts.seed + 991, 3) - 0.5;

  // Distant ground rises into hills, which is what gives the horizon a
  // silhouette to orbit against.
  const far = Math.min(1, dist / (opts.radius * 0.7));
  const hills = broad * (14 + 26 * far * far);

  return (hills + medium * 2.2 + fine * 0.5) * ease * opts.relief;
}

// -------------------------------------------------------------- terrain

function buildTerrainGeometry(opts: LandscapeOptions): BufferGeometry {
  const rings = 150;
  const sectors = 192;

  const vertexCount = (rings + 1) * (sectors + 1);
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  let p = 0;
  let t = 0;
  for (let i = 0; i <= rings; i++) {
    // Quadratic spacing: dense where the camera is, sparse at the horizon.
    const radius = opts.radius * Math.pow(i / rings, 2);
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
  /** Per-instance tint. Hue and value variation is what stops a field of
   *  identical instances from reading as wallpaper. */
  tint?: { base: number; vary: number };
}

function scatter(
  geometry: BufferGeometry,
  material: MeshStandardNodeMaterial,
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

  for (let i = 0; i < s.count; i++) {
    // Square-root radial distribution keeps density even over the annulus.
    const r = Math.sqrt(rng()) * (s.maxRadius - s.minRadius) + s.minRadius;
    const a = rng() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const scale = s.scale[0] + rng() * (s.scale[1] - s.scale[0]);

    pos.set(x, terrainHeight(x, z, opts) - sink * scale, z);
    quat.setFromAxisAngle(axis, (rng() - 0.5) * yaw);
    scl.set(scale, scale * (0.75 + rng() * 0.5), scale);
    mesh.setMatrixAt(i, m.compose(pos, quat, scl));

    if (color && base && s.tint) {
      const k = 1 + (rng() - 0.5) * s.tint.vary;
      // Shift hue slightly with value: sunlit patches go yellow, not just pale.
      color.setRGB(base.r * k, base.g * (1 + (k - 1) * 0.7), base.b * (2 - k));
      mesh.setColorAt(i, color);
    }
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
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
      count: Math.round(26000 * opts.detail),
      minRadius: 1.2,
      maxRadius: 22,
      scale: [0.15, 0.34],
      seedOffset: 29,
      yaw: 0.7,
      tint: { base: 0x5c6b2b, vary: 0.4 },
    }),
  );

  // Tussocks: taller, sparser, and allowed to spin freely because at this size
  // the eye reads the clump's silhouette rather than which way it leans.
  const tussockGeo = track(tuftGeometry({ blades: 8, lean: 0.7, height: 1.0, width: 0.06 }));
  const tussockMat = track(createGroundCoverMaterial(treeUniforms, { sway: 0.4, rootShade: 0.22 }));
  group.add(
    scatter(tussockGeo, tussockMat, opts, {
      count: Math.round(2600 * opts.detail),
      minRadius: 3,
      maxRadius: 55,
      scale: [0.28, 0.7],
      seedOffset: 71,
      yaw: 1.2,
      tint: { base: 0x4e5f26, vary: 0.5 },
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
      castShadow: true,
      tint: { base: 0xffffff, vary: 0.35 },
    }),
  );

  // A distant treeline. Small, dark and numerous so it reads as a wooded
  // horizon the camera swings past — a few large pale cones read as traffic
  // cones instead, and the fog cannot rescue them once they are that big.
  const distantGeo = track(new ConeGeometry(0.85, 3.2, 5, 1));
  const distantMat = track(new MeshStandardNodeMaterial());
  distantMat.color = new Color(0x3d4a2b);
  distantMat.roughness = 1;
  group.add(
    scatter(distantGeo, distantMat, opts, {
      count: Math.round(1100 * opts.detail),
      minRadius: 58,
      maxRadius: 140,
      scale: [0.6, 1.8],
      seedOffset: 53,
      sink: -1.55,
      tint: { base: 0xffffff, vary: 0.4 },
    }),
  );

  return {
    group,
    uniforms: ground.uniforms,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
