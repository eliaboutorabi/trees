/**
 * What floats on the pond: lily pads with their flowers, and fallen leaves.
 *
 * The pads gather in a few rafts off the shore, each a round leaf with its
 * notch, a little drift and a slow turn about its stem. In spring they come
 * up one by one and a few flower; in summer they are all out and pink water
 * lilies open on them; in autumn they brown and the flowers are gone; by
 * winter they have died back under the ice. Autumn also brings the tree's
 * own leaves down onto the water, where they wander on slow currents, and
 * stay where the ice catches them.
 *
 * Everything is placed once and moved on the GPU. The clock they move by is
 * the pond's own — time that only passes while the water is open — so a leaf
 * caught in the ice stays caught, and moves on from the same place when it
 * thaws.
 */
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, cos, float, mix, positionLocal, sin, smoothstep, uv, vec3 } from 'three/tsl';
import { mulberry32 } from '../lib/rng';
import type { TreeUniforms } from '../engine/materials/shared';
import { POND, shorePoint } from './pondShape';
import type { PondUniforms } from './pond';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

const SURFACE = POND.level + 0.006;

/** Rafts of pads: angle round the pond, how far out, how many. */
const RAFTS: [number, number, number][] = [
  [0.25, 0.58, 7],
  [-1.45, 0.55, 6],
  [2.35, 0.5, 5],
  [-0.6, 0.35, 3],
];

/**
 * Every pad and flower in one mesh. Each vertex carries where its pad floats
 * (`aCentre`, xz and a phase), its place in the order the pads come up in
 * (`aRank`, and for a flower its own), and what it is (`uv.x`: 0 pad, 1
 * petal, 2 the flower's heart; `uv.y` how far out from the middle).
 */
function lilyGeometry(): BufferGeometry {
  const rng = mulberry32(5501);
  const position: number[] = [];
  const centre: number[] = [];
  const rank: number[] = [];
  const uvs: number[] = [];
  const normal: number[] = [];
  const index: number[] = [];
  let order = 0;
  const total = RAFTS.reduce((n, r) => n + r[2], 0);

  const vertex = (x: number, y: number, z: number, c: [number, number, number], k: number, r: number, kind: number, out: number) => {
    position.push(x, y, z);
    centre.push(c[0], c[1], c[2]);
    rank.push(k, r);
    uvs.push(kind, out);
    normal.push(0, 1, 0);
  };

  for (const [theta, f, count] of RAFTS) {
    const raft = shorePoint(theta, f);
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const d = Math.sqrt(rng()) * 0.55;
      const c: [number, number, number] = [raft.x + Math.cos(a) * d, raft.z + Math.sin(a) * d, rng() * 6.28];
      const radius = 0.15 + rng() * 0.14;
      const notch = rng() * Math.PI * 2;
      const k = (order + rng() * 0.5) / total;
      const flowerRank = rng();
      order++;

      // The pad: a fan from its middle, open by a notch where the stem joins.
      const base = position.length / 3;
      vertex(0, 0, 0, c, k, flowerRank, 0, 0);
      const steps = 16;
      const gap = 0.32;
      for (let s = 0; s <= steps; s++) {
        const ang = notch + gap + (s / steps) * (Math.PI * 2 - gap * 2);
        const wob = 1 + Math.sin(ang * 3 + c[2]) * 0.04;
        vertex(Math.cos(ang) * radius * wob, 0, Math.sin(ang) * radius * wob, c, k, flowerRank, 0, 1);
      }
      for (let s = 0; s < steps; s++) index.push(base, base + s + 2, base + s + 1);

      // One pad in three carries a flower: two rings of pointed petals,
      // the inner ones more upright, round a small golden heart.
      if (rng() < 0.38) {
        const fx = Math.cos(notch + Math.PI) * radius * 0.25;
        const fz = Math.sin(notch + Math.PI) * radius * 0.25;
        const petal = (ang: number, len: number, lift: number, wid: number) => {
          const p0 = position.length / 3;
          const ca = Math.cos(ang);
          const sa = Math.sin(ang);
          const out = Math.cos(lift) * len;
          const up = Math.sin(lift) * len;
          vertex(fx, 0.012, fz, c, k, flowerRank, 1, 0);
          vertex(fx + ca * out * 0.5 - sa * wid, 0.012 + up * 0.5, fz + sa * out * 0.5 + ca * wid, c, k, flowerRank, 1, 0.5);
          vertex(fx + ca * out, 0.012 + up, fz + sa * out, c, k, flowerRank, 1, 1);
          vertex(fx + ca * out * 0.5 + sa * wid, 0.012 + up * 0.5, fz + sa * out * 0.5 - ca * wid, c, k, flowerRank, 1, 0.5);
          index.push(p0, p0 + 1, p0 + 2, p0, p0 + 2, p0 + 3);
        };
        const spin = rng() * 6.28;
        for (let pIdx = 0; pIdx < 8; pIdx++) petal(spin + (pIdx / 8) * Math.PI * 2, 0.085, 0.42, 0.024);
        for (let pIdx = 0; pIdx < 7; pIdx++) petal(spin + 0.4 + (pIdx / 7) * Math.PI * 2, 0.065, 0.95, 0.019);
        const h0 = position.length / 3;
        vertex(fx, 0.03, fz, c, k, flowerRank, 2, 0);
        for (let s = 0; s < 6; s++) {
          const ang = (s / 6) * Math.PI * 2;
          vertex(fx + Math.cos(ang) * 0.018, 0.02, fz + Math.sin(ang) * 0.018, c, k, flowerRank, 2, 1);
        }
        for (let s = 0; s < 6; s++) index.push(h0, h0 + 1 + ((s + 1) % 6), h0 + 1 + s);
      }
    }
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setAttribute('aCentre', new BufferAttribute(new Float32Array(centre), 3));
  g.setAttribute('aRank', new BufferAttribute(new Float32Array(rank), 2));
  g.setIndex(index);
  g.computeBoundingSphere();
  g.boundingSphere?.set(g.boundingSphere.center.set(POND.x, SURFACE, POND.z), POND.rx * 1.4);
  return g;
}

function lilyMaterial(u: TreeUniforms, pond: PondUniforms): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.side = DoubleSide;
  const c = attribute<'vec3'>('aCentre', 'vec3') as N;
  const rank = attribute<'vec2'>('aRank', 'vec2') as N;
  const kind = uv().x;
  const out = uv().y;
  const isFlower = smoothstep(0.5, 1, kind);

  // Up one at a time as the season's count passes each, and the flowers by
  // their own count, opening about their own middle.
  const padUp = pond.pads.sub(rank.x).mul(6).clamp(0, 1);
  const flowerUp = pond.flowers.sub(rank.y).mul(5).clamp(0, 1).mul(padUp);
  const size = mix(padUp, flowerUp, isFlower);

  // A slow turn about the stem and a little wander, on open water only.
  const t = pond.flow.mul(0.08).add(c.z);
  const turn = sin(t).mul(0.35);
  const local = positionLocal.mul(size) as N;
  const ct = cos(turn);
  const st = sin(turn);
  const turned = vec3(local.x.mul(ct).sub(local.z.mul(st)), local.y, local.x.mul(st).add(local.z.mul(ct)));
  const wander = vec3(sin(t.mul(0.7)).mul(0.04), 0, cos(t.mul(0.9)).mul(0.04));
  material.positionNode = vec3(c.x, SURFACE, c.y).add(turned).add(wander);

  // Pads: deep green with a paler rim, browning in autumn. Flowers: pink
  // petals going white at the tips, round a golden heart.
  const pad = mix(vec3(0.07, 0.16, 0.05), vec3(0.2, 0.33, 0.09), out);
  const padColour = mix(pad, mix(vec3(0.3, 0.2, 0.07), vec3(0.45, 0.33, 0.12), out), u.autumn.mul(0.85));
  const petal = mix(vec3(0.9, 0.42, 0.6), vec3(0.98, 0.9, 0.92), out.mul(out));
  const heart = vec3(0.98, 0.76, 0.2);
  const flower = mix(petal, heart, smoothstep(1.5, 2, kind));
  material.colorNode = mix(padColour, flower, isFlower);
  material.roughnessNode = mix(float(0.42), float(0.65), isFlower);
  material.metalnessNode = float(0);
  return material;
}

// ---------------------------------------------------------------- leaves

const LEAVES = 46;

/** Fallen leaves: small pointed ovals, each with a home on the water, a current to wander on, and a colour. */
function leafGeometry(): BufferGeometry {
  const rng = mulberry32(8803);
  const position: number[] = [];
  const anchor: number[] = [];
  const drift: number[] = [];
  const tint: number[] = [];
  const uvs: number[] = [];
  const normal: number[] = [];
  const index: number[] = [];
  const palette: [number, number, number][] = [
    [0.85, 0.4, 0.1],
    [0.74, 0.18, 0.07],
    [0.92, 0.66, 0.16],
    [0.5, 0.3, 0.12],
    [0.8, 0.52, 0.12],
  ];
  for (let i = 0; i < LEAVES; i++) {
    const at = shorePoint(rng() * Math.PI * 2, Math.sqrt(rng()) * 0.62);
    const len = 0.07 + rng() * 0.05;
    const wid = len * (0.38 + rng() * 0.15);
    const col = palette[(rng() * palette.length) | 0];
    // One home, current and spin per leaf, shared by its corners.
    const phase = rng() * 6.28;
    const reach = 0.15 + rng() * 0.45;
    const pace = (0.4 + rng() * 0.8) * (rng() < 0.5 ? -1 : 1);
    const spinRate = (rng() - 0.5) * 0.6;
    const base = position.length / 3;
    const pts: [number, number][] = [
      [-len, 0],
      [0, wid],
      [len, 0],
      [0, -wid],
    ];
    for (const [x, z] of pts) {
      position.push(x, 0, z);
      anchor.push(at.x, at.z, phase);
      // How far it wanders, how fast, and how fast it turns.
      drift.push(reach, pace, spinRate);
      tint.push(col[0], col[1], col[2]);
      uvs.push(x / len, i / LEAVES);
      normal.push(0, 1, 0);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setAttribute('aAnchor', new BufferAttribute(new Float32Array(anchor), 3));
  g.setAttribute('aDrift', new BufferAttribute(new Float32Array(drift), 3));
  g.setAttribute('aTint', new BufferAttribute(new Float32Array(tint), 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  g.boundingSphere?.set(g.boundingSphere.center.set(POND.x, SURFACE, POND.z), POND.rx * 1.4);
  return g;
}

function leafMaterial(u: TreeUniforms, pond: PondUniforms): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.side = DoubleSide;
  const anchor = attribute<'vec3'>('aAnchor', 'vec3') as N;
  const drift = attribute<'vec3'>('aDrift', 'vec3') as N;
  const tint = attribute<'vec3'>('aTint', 'vec3') as N;
  const order = uv().y;

  // Down in autumn, one after another; and buried as the snow comes.
  const present = u.autumn.sub(order.mul(0.7)).mul(3.3).clamp(0, 1).mul(u.snow.mul(0.85).oneMinus());
  const t = pond.flow.mul(0.05).mul(drift.y).add(anchor.z);
  const centre = vec3(anchor.x.add(cos(t).mul(drift.x)), POND.level + 0.004, anchor.y.add(sin(t.mul(0.8)).mul(drift.x)));
  const spin = pond.flow.mul(drift.z).add(anchor.z);
  const local = positionLocal.mul(present) as N;
  const turned = vec3(local.x.mul(cos(spin)).sub(local.z.mul(sin(spin))), 0, local.x.mul(sin(spin)).add(local.z.mul(cos(spin))));
  material.positionNode = centre.add(turned);

  // The tree's own autumn colour, varied leaf to leaf; darker once soaked.
  material.colorNode = mix(u.leafAutumn, tint, 0.55).mul(0.85);
  material.roughnessNode = float(0.5);
  material.metalnessNode = float(0);
  return material;
}

export interface PondSurface {
  lilies: Mesh;
  leaves: Mesh;
  dispose(): void;
}

export function createPondSurface(u: TreeUniforms, pond: PondUniforms): PondSurface {
  const lilies = new Mesh(lilyGeometry(), lilyMaterial(u, pond));
  const leaves = new Mesh(leafGeometry(), leafMaterial(u, pond));
  for (const m of [lilies, leaves]) {
    m.receiveShadow = true;
    m.castShadow = false;
  }
  return {
    lilies,
    leaves,
    dispose() {
      for (const m of [lilies, leaves]) {
        m.geometry.dispose();
        (m.material as MeshStandardNodeMaterial).dispose();
      }
    },
  };
}
