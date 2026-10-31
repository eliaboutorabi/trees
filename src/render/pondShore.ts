/**
 * What stands round the pond: stones on the bank, and reeds at the water.
 *
 * A pool of water edged by nothing but mud reads as a puddle; it is the
 * dressing that says *pond*. A few boulders, round and half sunk where the
 * bank meets the water, mossy on top, darker where they are wet, and capped
 * with snow in winter; and clumps of reeds and cattails standing in the
 * shallows, green in summer, gone to straw in autumn and staying up, dry and
 * gold, through the snow — as reeds do, where grass is buried.
 *
 * Both are single merged meshes, so the whole bank costs two draws.
 */
import { BufferAttribute, BufferGeometry, DoubleSide, IcosahedronGeometry, Mesh, Vector3 } from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, float, mix, normalWorld, positionLocal, positionWorld, sin, smoothstep, uv, vec3 } from 'three/tsl';
import { mulberry32 } from '../lib/rng';
import type { TreeUniforms } from '../engine/materials/shared';
import { POND, shorePoint } from './pondShape';

// --------------------------------------------------------------- stones

/** Where the stones sit round the pond — angle, how far out, size — placed by eye. */
const STONES: [number, number, number][] = [
  [-1.92, 1.04, 0.78],
  [-1.62, 1.08, 0.46],
  [-2.55, 1.06, 0.56],
  [0.12, 1.03, 0.62],
  [-0.38, 1.1, 0.34],
  [1.18, 1.05, 0.42],
  [1.46, 1.12, 0.26],
  [2.78, 1.07, 0.4],
  [-2.95, 1.13, 0.28],
  [0.48, 1.15, 0.22],
];

/** A boulder: an icosphere pushed in and out by a few lumps, flattened, and set into the bank. */
function boulder(seed: number, size: number): BufferGeometry {
  const rng = mulberry32(seed);
  // three's polyhedra come with every corner repeated per face; merged, each
  // corner is pushed out once (no cracks) and the normals come out smooth.
  const raw = new IcosahedronGeometry(1, 2);
  raw.deleteAttribute('normal');
  raw.deleteAttribute('uv');
  const g = mergeVertices(raw);
  raw.dispose();
  const pos = g.getAttribute('position');
  const lumps = Array.from({ length: 5 }, () => new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize());
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let r = 1;
    for (const l of lumps) r += Math.max(0, v.dot(l)) ** 3 * 0.22;
    r += (rng() - 0.5) * 0.06;
    v.multiplyScalar(r);
    // Flatter than it is wide, and flattest underneath, where it is buried.
    v.y *= v.y > 0 ? 0.62 : 0.4;
    pos.setXYZ(i, v.x * size, v.y * size, v.z * size);
  }
  g.computeVertexNormals();
  return g;
}

/** Each stone, built and set in place: the same every time it is asked for. */
function placedStones(): { geometry: BufferGeometry; size: number }[] {
  const rng = mulberry32(9311);
  return STONES.map(([theta, f, size], i) => {
    const g = boulder(4001 + i * 17, size);
    g.rotateY(rng() * Math.PI * 2);
    const at = shorePoint(theta, f);
    // Sunk about a third of its height into the bank or the shallows.
    g.translate(at.x, at.y + size * 0.12, at.z);
    return { geometry: g, size };
  });
}

/** The tops of the bigger stones, where a small bird could stand: the highest point of each. */
export function stoneTops(): Vector3[] {
  const tops: Vector3[] = [];
  for (const { geometry, size } of placedStones()) {
    if (size >= 0.4) {
      const pos = geometry.getAttribute('position');
      const top = new Vector3(0, -Infinity, 0);
      const v = new Vector3();
      for (let i = 0; i < pos.count; i++) if (v.fromBufferAttribute(pos, i).y > top.y) top.copy(v);
      tops.push(top);
    }
    geometry.dispose();
  }
  return tops;
}

function stonesMesh(u: TreeUniforms): Mesh {
  const parts: BufferGeometry[] = [];
  const tint: number[] = [];
  const rng = mulberry32(9312);
  placedStones().forEach(({ geometry: g }) => {
    const shade = 0.82 + rng() * 0.3;
    const part = g.toNonIndexed();
    g.dispose();
    // Counted after unindexing: one tint per drawn vertex.
    const count = part.getAttribute('position').count;
    for (let k = 0; k < count; k++) tint.push(shade, shade * (0.97 + rng() * 0.04), shade * 0.95);
    parts.push(part);
  });
  const geometry = mergeGeometries(parts)!;
  geometry.setAttribute('aTint', new BufferAttribute(new Float32Array(tint), 3));
  for (const p of parts) p.dispose();

  const material = new MeshStandardNodeMaterial();
  const up = normalWorld.y;
  const rock = vec3(0.2, 0.195, 0.175).mul(attribute<'vec3'>('aTint', 'vec3'));
  // Moss where the top faces the sky, broken up by height so it is patches,
  // not a cap; the stone is darker and glossier where the water wets it.
  const patches = sin(positionWorld.x.mul(6.1).add(positionWorld.z.mul(4.3)))
    .mul(sin(positionWorld.z.mul(5.7).sub(positionWorld.y.mul(8.9))))
    .mul(0.6)
    .add(0.55)
    .clamp(0, 1);
  const mossy = smoothstep(0.25, 0.75, up).mul(patches);
  const wet = smoothstep(POND.level + 0.1, POND.level, positionWorld.y);
  const dry = mix(rock, vec3(0.13, 0.19, 0.06), mossy.mul(0.9).mul(u.snow.oneMinus()));
  // A cap of snow on top, the sides left dark.
  const snow = smoothstep(0.62, 0.86, up).mul(u.snow).mul(wet.oneMinus());
  material.colorNode = mix(dry.mul(wet.mul(0.45).oneMinus()), u.snowColor, snow);
  material.roughnessNode = mix(float(0.9), float(0.35), wet).sub(u.wetness.mul(0.35)).clamp(0.2, 1);
  material.metalnessNode = float(0);

  const mesh = new Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------- reeds

/** Clumps of reeds: angle round the pond, how far out, how many blades, how many cattails among them. */
const CLUMPS: [number, number, number, number][] = [
  [-1.25, 0.98, 16, 3],
  [-1.05, 1.06, 9, 1],
  [0.55, 1.0, 12, 2],
  [-2.3, 1.02, 11, 2],
  [0.92, 1.04, 7, 0],
  [2.45, 1.03, 8, 1],
];

/**
 * One merged mesh of every clump. Each blade is a curved, tapering strip,
 * each cattail a stem with a fat brown head near the top. Every vertex knows
 * its clump's root and how far up the blade it is, for the sway.
 */
function reedGeometry(): BufferGeometry {
  const rng = mulberry32(7717);
  const position: number[] = [];
  const normal: number[] = [];
  const uvs: number[] = [];
  const root: number[] = [];
  const kind: number[] = [];
  const index: number[] = [];

  const push = (p: Vector3, n: Vector3, t: number, r: Vector3, k: number) => {
    position.push(p.x, p.y, p.z);
    normal.push(n.x, n.y, n.z);
    uvs.push(k, t);
    root.push(r.x, r.y, r.z);
    kind.push(k);
  };

  for (const [theta, f, blades, cattails] of CLUMPS) {
    const centre = shorePoint(theta, f);
    const r = new Vector3(centre.x, centre.y, centre.z);
    for (let b = 0; b < blades + cattails; b++) {
      const isCattail = b >= blades;
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * 0.38;
      const base = new Vector3(r.x + Math.cos(a) * d, centre.y - 0.03, r.z + Math.sin(a) * d);
      const height = isCattail ? 1.05 + rng() * 0.35 : 0.65 + rng() * 0.7;
      const width = isCattail ? 0.014 : 0.028 + rng() * 0.02;
      const lean = (isCattail ? 0.08 : 0.22) * (0.5 + rng());
      const dir = rng() * Math.PI * 2;
      const lx = Math.cos(dir);
      const lz = Math.sin(dir);
      // The blade's flat face turns with its lean, so a clump is not a fan.
      const side = new Vector3(-lz, 0, lx);
      const steps = 5;
      const first = position.length / 3;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const bend = lean * t * t;
        const p = new Vector3(base.x + lx * bend * height, base.y + t * height, base.z + lz * bend * height);
        const w = width * (1 - t * (isCattail ? 0.2 : 0.92));
        const n = new Vector3(lx, 0.35, lz).normalize();
        push(p.clone().addScaledVector(side, w), n, t, r, 0);
        push(p.clone().addScaledVector(side, -w), n, t, r, 0);
        if (s < steps) {
          const i = first + s * 2;
          index.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
        }
      }
      if (isCattail) {
        // The head: a short brown spindle three-quarters of the way up.
        const headT = 0.78;
        const bend = lean * headT * headT;
        const c = new Vector3(base.x + lx * bend * height, base.y + headT * height, base.z + lz * bend * height);
        const len = 0.16 + rng() * 0.06;
        const rad = 0.03;
        const sides = 6;
        const start = position.length / 3;
        for (let ring = 0; ring <= 2; ring++) {
          const y = (ring / 2 - 0.5) * len;
          const rr = ring === 1 ? rad : rad * 0.82;
          for (let k = 0; k < sides; k++) {
            const ang = (k / sides) * Math.PI * 2;
            const n = new Vector3(Math.cos(ang), 0, Math.sin(ang));
            push(new Vector3(c.x + n.x * rr, c.y + y, c.z + n.z * rr), n, headT + y / height, r, 1);
          }
        }
        for (let ring = 0; ring < 2; ring++) {
          for (let k = 0; k < sides; k++) {
            const a0 = start + ring * sides + k;
            const a1 = start + ring * sides + ((k + 1) % sides);
            index.push(a0, a1, a0 + sides, a1, a1 + sides, a0 + sides);
          }
        }
      }
    }
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setAttribute('aRoot', new BufferAttribute(new Float32Array(root), 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

function reedMaterial(u: TreeUniforms): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.side = DoubleSide;
  const t = uv().y;
  const head = uv().x;
  const root = attribute<'vec3'>('aRoot', 'vec3');
  const rel = positionLocal.sub(root);

  // The same wind as the grass and the tree, with each clump on its own phase.
  const phase = root.x.mul(1.37).add(root.z.mul(2.11));
  const swing = u.windPhase.mul(1.3);
  const gust = sin(swing.add(phase)).mul(0.65).add(sin(swing.mul(2.1).add(phase.mul(1.6))).mul(0.35));
  const lean = gust.mul(u.wind).mul(0.16).mul(t.mul(t));
  const dir = u.windDir.normalize();
  material.positionNode = root.add(vec3(rel.x.add(dir.x.mul(lean).mul(rel.y)), rel.y, rel.z.add(dir.y.mul(lean).mul(rel.y))));

  // Green in the growing season, straw-gold once it is over — and still
  // standing when the snow comes.
  const green = mix(vec3(0.13, 0.2, 0.06), vec3(0.32, 0.42, 0.13), t);
  const straw = mix(vec3(0.3, 0.22, 0.1), vec3(0.72, 0.58, 0.3), t);
  const blade = mix(green, straw, u.autumn.mul(0.9));
  const cattail = vec3(0.24, 0.14, 0.07);
  const colour = mix(blade, cattail, head);
  // A little snow caught on the heads and the bent tops.
  material.colorNode = mix(colour, u.snowColor, u.snow.mul(head.mul(0.55).add(t.mul(0.2))));
  material.roughnessNode = float(0.8).sub(u.wetness.mul(0.3));
  material.metalnessNode = float(0);
  return material;
}

function reedsMesh(u: TreeUniforms): Mesh {
  const mesh = new Mesh(reedGeometry(), reedMaterial(u));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export interface PondShore {
  stones: Mesh;
  reeds: Mesh;
  dispose(): void;
}

export function createPondShore(u: TreeUniforms): PondShore {
  const stones = stonesMesh(u);
  const reeds = reedsMesh(u);
  return {
    stones,
    reeds,
    dispose() {
      for (const m of [stones, reeds]) {
        m.geometry.dispose();
        (m.material as MeshStandardNodeMaterial).dispose();
      }
    },
  };
}

