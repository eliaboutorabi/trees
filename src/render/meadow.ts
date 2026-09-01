/**
 * Wildflowers around the tree, and butterflies that visit them.
 *
 * The two belong in one module because the butterflies land on the *actual*
 * flowers: the same scatter that places the meadow hands its positions to the
 * flight paths, so a butterfly settling somewhere is settling on a flower that
 * is really there rather than on a plausible-looking patch of grass.
 *
 * Both are entirely GPU-animated. The flowers sway on the scene's wind uniforms,
 * exactly as the grass does, and every butterfly's whole life — perch, launch,
 * cross, land, flap — is a function of `time` and a handful of per-vertex
 * constants. Nothing here runs on the CPU after it is built, so a meadow full of
 * butterflies costs the same as an empty one.
 */
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  float,
  instanceIndex,
  mix,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  time,
  uv,
  vec3,
} from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { mulberry32 } from '../lib/rng';
import { terrainHeight, type LandscapeOptions } from './landscape';
import type { TreeUniforms } from '../engine/materials/shared';

export interface MeadowOptions {
  /** Flowers scattered over the ring around the tree. */
  flowerCount: number;
  butterflyCount: number;
  /** Keep clear of the trunk, and stop before the ground stops being flat. */
  minRadius: number;
  maxRadius: number;
  seed: number;
}

const DEFAULTS: MeadowOptions = {
  flowerCount: 7000,
  butterflyCount: 16,
  minRadius: 1.6,
  maxRadius: 13,
  seed: 20260831,
};

/**
 * A stem with a rosette of petals on top.
 *
 * `uv.y` runs 0 at the root to 1 at the petal tips, because that is what the
 * ground-cover material shades and sways against — so a flower gets the grass's
 * wind and its distance LOD for nothing.
 */
function flowerGeometry(petals = 5): BufferGeometry {
  const position: number[] = [];
  const uvs: number[] = [];
  const normal: number[] = [];
  const index: number[] = [];

  // Matched to the grass, which is a 0.62-tall tuft scattered at 0.15-0.34: a
  // meadow flower stands a little above the sward, not four times over it.
  const stemH = 0.62;
  const stemW = 0.03;

  // Stem: one narrow strip. It is short and mostly buried in grass, so it does
  // not earn more than two triangles.
  const base = position.length / 3;
  position.push(-stemW, 0, 0, stemW, 0, 0, -stemW * 0.6, stemH, 0, stemW * 0.6, stemH, 0);
  uvs.push(0, 0, 1, 0, 0, 0.55, 1, 0.55);
  for (let i = 0; i < 4; i++) normal.push(0, 0, 1);
  index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);

  // Petals, splayed around the top and tipped up a little so the flower reads
  // as a face rather than a flat disc. Narrow at the throat and widest past
  // halfway, or they read as the sails of a windmill.
  const petalL = 0.115;
  const petalW = 0.052;
  for (let p = 0; p < petals; p++) {
    const a = (p / petals) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const b = position.length / 3;
    const lift = 0.055;
    position.push(
      0, stemH, 0,
      ca * petalL * 0.55 - sa * petalW, stemH + lift * 0.6, sa * petalL * 0.55 + ca * petalW,
      ca * petalL * 0.55 + sa * petalW, stemH + lift * 0.6, sa * petalL * 0.55 - ca * petalW,
      ca * petalL, stemH + lift, sa * petalL,
    );
    uvs.push(0.5, 0.78, 0.2, 0.93, 0.8, 0.93, 0.5, 1);
    for (let i = 0; i < 4; i++) normal.push(0, 1, 0);
    index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

/**
 * The flower's own material.
 *
 * It would be tidier to reuse the grass material and colour each flower with
 * `instanceColor`, and that was the first attempt — but a node material
 * multiplies the instance colour over the *whole* mesh, so the stems came out
 * pink along with the petals. There is no way to exempt them after the fact.
 *
 * So the petal colour is hashed out of `instanceIndex` inside the shader
 * instead, and mixed in only above the throat. Same wind, same distance LOD,
 * green stems.
 */
function createFlowerMaterial(u: TreeUniforms, fadeStart = 20, fadeEnd = 44): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.side = DoubleSide;
  material.metalness = 0;
  material.roughness = 0.88;

  const t = uv().y;
  const lod = smoothstep(fadeEnd, fadeStart, cameraPosition.sub(positionWorld).length());

  // Same trick the grass uses: the golden ratio turns consecutive instance
  // indices into well-spread phases, so neighbours never beat in step.
  const idx = instanceIndex.toFloat();
  const phase = idx.mul(0.6180339887).fract().mul(Math.PI * 2);
  const speed = u.windSpeed.mul(1.9);
  const gust = sin(time.mul(speed).add(phase))
    .mul(0.62)
    .add(sin(time.mul(speed.mul(2.3)).add(phase.mul(1.7))).mul(0.38));
  const lean = gust.mul(u.wind).mul(0.5).mul(t.mul(t).mul(0.7).add(t.mul(0.3))).mul(lod);
  const dir = u.windDir.normalize();
  material.positionNode = vec3(
    positionLocal.x.add(dir.x.mul(lean).mul(positionLocal.y)),
    positionLocal.y.mul(float(1).sub(lean.mul(lean).mul(0.3))),
    positionLocal.z.add(dir.y.mul(lean).mul(positionLocal.y)),
  ).mul(lod);

  // Three drifts of colour, picked per flower, so a meadow is never one hue.
  const h = idx.mul(127.1).sin().mul(43758.5453).fract();
  const warm = mix(vec3(0.95, 0.9, 0.72), vec3(0.92, 0.66, 0.72), smoothstep(0.0, 0.45, h));
  const petal = mix(warm, vec3(0.82, 0.85, 0.95), smoothstep(0.62, 1.0, h));
  // A yellow eye at the throat, which is what stops them reading as paper discs.
  const eye = smoothstep(0.86, 0.76, t);
  const head = mix(petal, vec3(0.95, 0.78, 0.3), eye.mul(0.8));

  const stem = vec3(0.24, 0.33, 0.14);
  const isPetal = smoothstep(0.6, 0.78, t);
  material.colorNode = mix(stem, head, isPetal).mul(mix(float(0.45), float(1), t.pow(0.7)));

  return material;
}

/**
 * Scatter the flowers, and report where they went.
 *
 * The positions come back so the butterflies can perch on real ones.
 */
function scatterFlowers(
  geometry: BufferGeometry,
  material: MeshStandardNodeMaterial,
  o: MeadowOptions,
  land: LandscapeOptions,
): { mesh: InstancedMesh; positions: Vector3[] } {
  const rng = mulberry32(o.seed);
  const mesh = new InstancedMesh(geometry, material, o.flowerCount);
  const m = new Matrix4();
  const pos = new Vector3();
  const quat = new Quaternion();
  const scl = new Vector3();
  const axis = new Vector3(0, 1, 0);
  const positions: Vector3[] = [];

  let placed = 0;
  for (let i = 0; i < o.flowerCount; i++) {
    // Flowers grow in drifts, not evenly. Two octaves of hashing on the
    // position is enough to clump them without another noise field.
    const r = Math.sqrt(rng()) * (o.maxRadius - o.minRadius) + o.minRadius;
    const a = rng() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const drift = Math.sin(x * 0.55 + o.seed * 0.001) * Math.cos(z * 0.47) * 0.5 + 0.5;
    if (rng() > drift * 0.85 + 0.15) continue;

    const scale = 0.22 + rng() * 0.2;
    const y = terrainHeight(x, z, land);
    pos.set(x, y, z);
    quat.setFromAxisAngle(axis, rng() * Math.PI * 2);
    scl.set(scale, scale * (0.85 + rng() * 0.4), scale);
    mesh.setMatrixAt(placed, m.compose(pos, quat, scl));

    // Where a butterfly would stand: on the flower head, not inside the stem.
    positions.push(new Vector3(x, y + stemHeightOf(scale), z));
    placed++;
  }

  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  return { mesh, positions };
}

/** Top of the stem for an instance at this scale — where a butterfly perches. */
function stemHeightOf(scale: number): number {
  return 0.68 * scale;
}

const vec3Attr = (name: string) => attribute<'vec3'>(name, 'vec3');
const vec4Attr = (name: string) => attribute<'vec4'>(name, 'vec4');

/**
 * One merged mesh holding every butterfly.
 *
 * Each carries two perch points and a period. Its cycle is
 * `fract(time / period + seed)`: it sits on one flower for the first part,
 * crosses to the other for the rest, and swaps ends every cycle — so it works
 * its way back and forth between two real flowers forever, and no two are in
 * step because the seed offsets the phase.
 */
function butterflyGeometry(perches: Vector3[], count: number, seed: number): BufferGeometry | null {
  if (perches.length < 2) return null;
  const rng = mulberry32(seed + 7717);

  const position: number[] = [];
  const uvs: number[] = [];
  const params: number[] = [];
  const perchA: number[] = [];
  const perchB: number[] = [];
  const index: number[] = [];

  // Forewing and hindwing, as two quads per side. `spanT` is 0 at the hinge and
  // 1 at the wing tip, so the flap can bend the wing rather than swing it rigid.
  const wing = (side: number): { p: number[]; uv: number[]; span: number[] }[] => [
    {
      p: [0, 0, 0.06, side * 0.32, 0, 0.2, side * 0.34, 0, -0.04, 0, 0, -0.02],
      uv: [0.5, 1, 1, 0.85, 1, 0.35, 0.5, 0.45],
      span: [0, 1, 1, 0],
    },
    {
      p: [0, 0, -0.02, side * 0.34, 0, -0.04, side * 0.24, 0, -0.26, 0, 0, -0.16],
      uv: [0.5, 0.45, 1, 0.35, 0.9, 0, 0.5, 0.05],
      span: [0, 1, 1, 0],
    },
  ];

  for (let b = 0; b < count; b++) {
    const ia = (rng() * perches.length) | 0;
    let ib = (rng() * perches.length) | 0;
    // Pick a second flower that is a reasonable flight away, so the crossing
    // reads as a journey rather than a twitch.
    for (let attempt = 0; attempt < 24; attempt++) {
      if (perches[ia].distanceTo(perches[ib]) > 1.6) break;
      ib = (rng() * perches.length) | 0;
    }
    const A = perches[ia];
    const B = perches[ib];
    const s = rng();
    const period = 7 + rng() * 7;
    // Bigger than life — a true-to-scale butterfly here is under a pixel — but
    // small enough to still read as an insect rather than a bird.
    const scale = 0.3 + rng() * 0.16;

    const push = (p: number[], uvArr: number[], span: number[], side: number) => {
      const base = position.length / 3;
      for (let i = 0; i < 4; i++) {
        position.push(p[i * 3] * scale, p[i * 3 + 1] * scale, p[i * 3 + 2] * scale);
        uvs.push(uvArr[i * 2], uvArr[i * 2 + 1]);
        params.push(s, side, span[i], period);
        perchA.push(A.x, A.y, A.z);
        perchB.push(B.x, B.y, B.z);
      }
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    for (const side of [1, -1]) for (const w of wing(side)) push(w.p, w.uv, w.span, side);
    // Body: a slim dark spindle that never flaps.
    push(
      [-0.022 * 1, 0, 0.16, 0.022, 0, 0.16, 0.016, 0, -0.2, -0.016, 0, -0.2].map((v, i) => (i % 3 === 0 ? v : v)),
      [0, 0.5, 1, 0.5, 1, 0.5, 0, 0.5],
      [0, 0, 0, 0],
      0,
    );
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setAttribute('aParams', new BufferAttribute(new Float32Array(params), 4));
  g.setAttribute('aPerchA', new BufferAttribute(new Float32Array(perchA), 3));
  g.setAttribute('aPerchB', new BufferAttribute(new Float32Array(perchB), 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  // Every vertex is relocated in the shader, so the baked bounds mean nothing.
  g.boundingSphere?.set(new Vector3(0, 2, 0), 40);
  return g;
}

function butterflyMaterial(u: TreeUniforms): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.side = DoubleSide;

  const p = vec4Attr('aParams');
  const seed = p.x;
  const side = p.y;
  const spanT = p.z;
  const period = p.w;
  const A = vec3Attr('aPerchA');
  const B = vec3Attr('aPerchB');
  // `positionLocal`, not `attribute('position')`: the node system binds the
  // former as the vertex stage's local position and only guarantees that one.
  const local = positionLocal;

  // Which leg of the round trip, and how far through it.
  const cycle = time.div(period).add(seed.mul(11.7));
  const phase = cycle.fract();
  const leg = cycle.floor().mul(0.5).fract().mul(2);
  const from = mix(A, B, leg);
  const to = mix(B, A, leg);

  // Sits for the first 45% of the cycle, then crosses.
  const PERCH = 0.45;
  const flying = smoothstep(PERCH, PERCH + 0.06, phase);
  const t = phase.sub(PERCH).div(1 - PERCH).clamp(0, 1);
  // Ease out of the flower and back down onto the next one, so it never
  // arrives at speed.
  const glide = smoothstep(0, 1, t);

  const straight = mix(from, to, glide);
  // Guarded against a zero-length leg: `normalize` on it is NaN, and one NaN
  // anywhere in this chain takes the whole butterfly off screen silently.
  const away = to.sub(from);
  const flat = vec3(away.x, 0, away.z);
  const fwd = flat.div(flat.length().max(0.001));
  const lateral = vec3(fwd.z, 0, fwd.x.negate());
  // A butterfly does not fly in a straight line. An arc up and a slow lateral
  // weave, both vanishing at each end so the landing is still exact.
  const arc = sin(t.mul(Math.PI)).mul(flying);
  const weave = sin(t.mul(Math.PI * 3).add(seed.mul(21.3))).mul(arc).mul(0.55);
  const centre = straight
    .add(vec3(0, arc.mul(0.9).add(sin(time.mul(2.3).add(seed.mul(30.0))).mul(arc).mul(0.18)), 0))
    .add(lateral.mul(weave));

  // Flap hard in flight, and just breathe while perched. `spanT` is 0 at the
  // hinge, so the wing bends rather than swinging rigid, and `side` is 0 on the
  // body, which therefore never flaps.
  const flapRate = mix(float(2.6), float(19.0), flying);
  const beat = sin(time.mul(flapRate).add(seed.mul(40.0)));
  const swing = mix(float(0.3), float(1.15), flying).mul(beat).mul(spanT).mul(side.abs());

  // Both wings rise *together*, hinging about the body's long axis. Folding the
  // side into the angle instead sends one wing up while the other goes down,
  // which is a bird mid-stroke, not a butterfly.
  const cs = swing.cos();
  const sn = swing.sin();
  const flapped = vec3(local.x.mul(cs), local.y.add(local.x.abs().mul(sn)), local.z);

  // Face the way it is going, and hold that heading while perched.
  //
  // Built as a basis rather than an angle. Going via `atan(x, z)` and then
  // sin/cos of it is the obvious route and it is what broke this: the whole
  // mesh vanished, placement and all, while `positionLocal + centre` alone
  // placed the butterflies correctly. Rotating by the direction vector needs no
  // trig and has nothing to get wrong.
  const turned = lateral.mul(flapped.x).add(vec3(0, flapped.y, 0)).add(fwd.mul(flapped.z));

  material.positionNode = turned.add(centre);

  // No real lighting on something this small: a wing pattern, dimmed as it
  // turns edge-on, tinted by the sun so it belongs in the scene.
  const st = uv();
  const edge = smoothstep(0.35, 1.0, st.y.add(st.x.sub(0.5).abs()));
  const body = smoothstep(0.02, 0.0, spanT.add(st.y.sub(0.5).abs().mul(0.001)));
  const wingCol = mix(vec3(0.95, 0.72, 0.24), vec3(0.42, 0.13, 0.06), edge);
  const facing = cs.abs().mul(0.55).add(0.45);
  const lit = wingCol.mul(facing).mul(u.sunColor.mul(0.55).add(0.55));
  material.colorNode = mix(lit, vec3(0.06, 0.045, 0.035), body);

  // Fade out rather than shimmer once they are a few pixels across.
  const dist = cameraPosition.sub(positionWorld).length();
  material.opacity = 1;
  material.transparent = true;
  material.opacityNode = smoothstep(42, 24, dist);

  return material;
}

export interface Meadow {
  group: Group;
  flowerCount: number;
  butterflyCount: number;
  dispose(): void;
}

export function createMeadow(
  treeUniforms: TreeUniforms,
  land: LandscapeOptions,
  options: Partial<MeadowOptions> = {},
): Meadow {
  const o = { ...DEFAULTS, ...options };
  const group = new Group();

  const geo = flowerGeometry();
  const mat = createFlowerMaterial(treeUniforms);
  const { mesh: flowers, positions } = scatterFlowers(geo, mat, o, land);
  group.add(flowers);

  const bugGeo = butterflyGeometry(positions, o.butterflyCount, o.seed);
  const bugMat = butterflyMaterial(treeUniforms);
  let butterflies: Mesh | null = null;
  if (bugGeo) {
    butterflies = new Mesh(bugGeo, bugMat);
    butterflies.frustumCulled = false;
    butterflies.castShadow = false;
    butterflies.receiveShadow = false;
    // Drawn after the foliage so their alpha resolves against a finished scene.
    butterflies.renderOrder = 3;
    group.add(butterflies);
  }

  return {
    group,
    flowerCount: flowers.count,
    butterflyCount: bugGeo ? o.butterflyCount : 0,
    dispose() {
      geo.dispose();
      mat.dispose();
      bugGeo?.dispose();
      bugMat.dispose();
    },
  };
}
