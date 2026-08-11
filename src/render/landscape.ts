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
      indices.push(a, b, a + 1, a + 1, b, b + 1);
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

/** A grass tuft: a few tapered blades, cheap and readable in silhouette. */
function tuftGeometry(): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const blades = 5;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + 0.4;
    const lean = 0.34 + (b % 3) * 0.14;
    const h = 0.5 + (b % 2) * 0.22;
    const w = 0.028;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const base = positions.length / 3;
    // Triangle from a wide base to a leaning tip.
    positions.push(-dz * w, 0, dx * w);
    positions.push(dz * w, 0, -dx * w);
    positions.push(dx * lean * h, h, dz * lean * h);
    indices.push(base, base + 1, base + 2);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

interface ScatterResult {
  mesh: InstancedMesh;
}

function scatter(
  geometry: BufferGeometry,
  material: MeshStandardNodeMaterial,
  count: number,
  minRadius: number,
  maxRadius: number,
  scaleRange: [number, number],
  opts: LandscapeOptions,
  seedOffset: number,
  sink = 0,
  castShadow = false,
): ScatterResult {
  const rng = mulberry32(opts.seed + seedOffset);
  const mesh = new InstancedMesh(geometry, material, count);
  const m = new Matrix4();
  const pos = new Vector3();
  const quat = new Quaternion();
  const scl = new Vector3();

  for (let i = 0; i < count; i++) {
    // Square-root radial distribution keeps density even over the annulus.
    const r = Math.sqrt(rng()) * (maxRadius - minRadius) + minRadius;
    const a = rng() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const s = scaleRange[0] + rng() * (scaleRange[1] - scaleRange[0]);

    pos.set(x, terrainHeight(x, z, opts) - sink * s, z);
    quat.setFromAxisAngle(new Vector3(0, 1, 0), rng() * Math.PI * 2);
    scl.set(s, s * (0.75 + rng() * 0.5), s);
    mesh.setMatrixAt(i, m.compose(pos, quat, scl));
  }

  mesh.instanceMatrix.needsUpdate = true;
  // Grass and horizon trees are not worth a shadow-map draw: they are either
  // too small to read or outside the shadow frustum fitted around the tree.
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  // Real bounds so these can be frustum-culled instead of always submitted.
  mesh.computeBoundingSphere();
  return { mesh };
}

// ---------------------------------------------------------------- public

export interface Landscape {
  group: Group;
  /** Colours shared with the ground shader, so haze can be retinted. */
  uniforms: ReturnType<typeof createGroundMaterial>['uniforms'];
  dispose(): void;
}

export function createLandscape(options: Partial<LandscapeOptions> = {}): Landscape {
  const opts = { ...DEFAULT_LANDSCAPE, ...options };
  const group = new Group();

  const ground = createGroundMaterial();
  const terrain = new Mesh(buildTerrainGeometry(opts), ground.material);
  terrain.receiveShadow = true;
  terrain.castShadow = false;
  group.add(terrain);

  // Rocks: low-poly and half-buried, so they read as part of the ground rather
  // than as objects resting on it.
  const rockGeo = new IcosahedronGeometry(1, 0);
  const rockMat = new MeshStandardNodeMaterial();
  rockMat.color = new Color(0x473d31);
  rockMat.roughness = 0.98;
  const rocks = scatter(rockGeo, rockMat, Math.round(90 * opts.detail), 8, 70, [0.1, 0.34], opts, 11, 0.62, true);
  group.add(rocks.mesh);

  // Grass: the near-field parallax cue, so it is densest where the camera is.
  const grassGeo = tuftGeometry();
  const grassMat = new MeshStandardNodeMaterial();
  grassMat.color = new Color(0x6f6539);
  grassMat.roughness = 1;
  const grass = scatter(grassGeo, grassMat, Math.round(9000 * opts.detail), 1.5, 22, [0.16, 0.46], opts, 29);
  group.add(grass.mesh);

  // Mid-field shrubs, for parallax between the grass and the horizon.
  const shrubGeo = tuftGeometry();
  const shrubMat = new MeshStandardNodeMaterial();
  shrubMat.color = new Color(0x3d4626);
  shrubMat.roughness = 1;
  const shrubs = scatter(shrubGeo, shrubMat, Math.round(420 * opts.detail), 12, 62, [0.9, 2.4], opts, 71, 0, true);
  group.add(shrubs.mesh);

  // A distant treeline. Small, dark and numerous so it reads as a wooded
  // horizon the camera swings past — a few large pale cones read as traffic
  // cones instead, and the fog cannot rescue them once they are that big.
  const distantGeo = new ConeGeometry(0.85, 3.2, 5, 1);
  const distantMat = new MeshStandardNodeMaterial();
  distantMat.color = new Color(0x2f3626);
  distantMat.roughness = 1;
  const distant = scatter(distantGeo, distantMat, Math.round(900 * opts.detail), 62, 140, [0.6, 1.7], opts, 53, -1.55);
  group.add(distant.mesh);

  return {
    group,
    uniforms: ground.uniforms,
    dispose() {
      terrain.geometry.dispose();
      ground.material.dispose();
      rockGeo.dispose();
      rockMat.dispose();
      grassGeo.dispose();
      grassMat.dispose();
      shrubGeo.dispose();
      shrubMat.dispose();
      distantGeo.dispose();
      distantMat.dispose();
    },
  };
}
