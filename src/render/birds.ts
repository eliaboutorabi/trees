/**
 * Doves.
 *
 * A dozen of them, of four kinds, living on the tree: sitting on real twigs and
 * swaying with them, walking and pecking in the meadow, crossing from one
 * perch to another, and going up together when the crown is rustled — wheeling
 * round the tree before they drift back down.
 *
 * Every bird is one rig with one number of state that matters for the eye:
 * its wings. On the wing a dove beats in short runs and glides between them on
 * wings held up in a shallow V; it leans into its turns, lifts its nose and
 * fans its wings to brake as it comes in; and on the branch it folds them along
 * its back and spends its time turning its head in small quick jerks.
 *
 * The whole flock is one draw. The birds are merged into a single mesh, each
 * vertex tagged with its bird and its part of the bird, and each bird's
 * position, attitude, wing pose and head pose are four vec4s in uniform arrays
 * that the vertex shader reads. A uniform array rather than an instanced mesh
 * because it is the transport already proven here — see `createFruitMaterial`
 * for the sync it needs.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  DoubleSide,
  Euler,
  MathUtils,
  Mesh,
  Quaternion,
  Vector3,
  Vector4,
} from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, mix, positionLocal, step, uniformArray, vec3 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import type { Perch, Tree } from '../engine';
import { mulberry32 } from '../lib/rng';

const MAX_BIRDS = 16;

type Vec3Node = Node<'vec3'>;
type Vec4Node = Node<'vec4'>;
type FloatNode = Node<'float'>;
type RGB = readonly [number, number, number];

// ------------------------------------------------------------------ kinds

interface Plumage {
  back: RGB;
  belly: RGB;
  neck: RGB;
  /** The coverts — the inner, upper wing. */
  coverts: RGB;
  /** Where the wing goes dark: the bars across the coverts, or their spots. */
  bars: RGB;
  primaries: RGB;
  beak: RGB;
  /** A dark half-collar at the nape, as the collared dove has. */
  collar: boolean;
}

/*
 * Four doves that share a lawn in real life, so a flock of them reads as
 * birds that live here rather than as one bird copied twelve times. Picked for
 * how they separate at a distance: a white one, a dark grey one, a warm buff
 * one, and a pale one with a black collar.
 */
const KINDS: readonly Plumage[] = [
  // White dove.
  {
    back: [0.9, 0.9, 0.89],
    belly: [0.95, 0.94, 0.92],
    neck: [0.92, 0.92, 0.91],
    coverts: [0.88, 0.88, 0.88],
    bars: [0.78, 0.79, 0.81],
    primaries: [0.74, 0.75, 0.78],
    beak: [0.78, 0.52, 0.48],
    collar: false,
  },
  // Rock pigeon: slate, an oil-sheen neck, two black bars.
  {
    back: [0.46, 0.49, 0.54],
    belly: [0.44, 0.46, 0.52],
    neck: [0.26, 0.4, 0.37],
    coverts: [0.56, 0.59, 0.64],
    bars: [0.12, 0.12, 0.14],
    primaries: [0.22, 0.23, 0.26],
    beak: [0.18, 0.17, 0.17],
    collar: false,
  },
  // Mourning dove: buff, with dark spots on the wing.
  {
    back: [0.6, 0.5, 0.4],
    belly: [0.74, 0.62, 0.52],
    neck: [0.68, 0.57, 0.49],
    coverts: [0.55, 0.49, 0.43],
    bars: [0.17, 0.14, 0.12],
    primaries: [0.33, 0.31, 0.3],
    beak: [0.14, 0.13, 0.13],
    collar: false,
  },
  // Collared dove: pale grey-buff and the black half-collar.
  {
    back: [0.72, 0.67, 0.61],
    belly: [0.81, 0.76, 0.71],
    neck: [0.78, 0.73, 0.68],
    coverts: [0.69, 0.65, 0.6],
    bars: [0.58, 0.55, 0.52],
    primaries: [0.4, 0.38, 0.38],
    beak: [0.14, 0.13, 0.13],
    collar: true,
  },
];

// --------------------------------------------------------------- geometry

/** Body parts, as the shader tells them apart. */
const PART = { body: 0, head: 1, tail: 2, arm: 3, hand: 4 } as const;

/*
 * Bird space: +Z forward, +Y up, the feet at the origin. About a unit from
 * tail tip to beak; the flock scales that to a little over a third of a metre,
 * a touch bigger than life so a bird in the crown reads from where the camera
 * usually is.
 */
const SHOULDER_Y = 0.19;
const SHOULDER_X = 0.09;
const WRIST_X = 0.36;
const TIP_X = 0.76;
const NECK = [0, 0.23, 0.2] as const;
const TAIL_ROOT = [0, 0.19, -0.24] as const;

/**
 * z, half-width, height above the belly line. A deep round chest, a pinched
 * neck and a small round head — the neck is what turns a lathe of rings into a
 * bird; without it the head is just the body tapering off, which reads as a
 * fish or a dart.
 */
const PROFILE: readonly (readonly [number, number, number])[] = [
  [-0.26, 0.04, 0.04],
  [-0.17, 0.092, 0.02],
  [-0.05, 0.138, 0.005],
  [0.05, 0.15, 0.0],
  [0.14, 0.126, 0.02],
  [0.205, 0.072, 0.065],
  [0.255, 0.074, 0.105],
  [0.305, 0.08, 0.118],
  [0.355, 0.062, 0.118],
  [0.39, 0.03, 0.108],
];
const RING = 8;
const BODY_Y = 0.16;

function buildDoves(plumage: Plumage[]): BufferGeometry {
  const position: number[] = [];
  const color: number[] = [];
  const rig: number[] = [];
  const index: number[] = [];

  plumage.forEach((p, id) => {
    const base = position.length / 3;
    const push = (x: number, y: number, z: number, c: RGB, side: number, part: number) => {
      position.push(x, y, z);
      color.push(c[0], c[1], c[2]);
      rig.push(id, side, part, 0);
      return position.length / 3 - 1 - base;
    };

    // Body: rings along Z, belly paler than back, the neck its own colour.
    PROFILE.forEach(([z, r, lift], ringIndex) => {
      const part = z > 0.21 ? PART.head : PART.body;
      for (let j = 0; j < RING; j++) {
        const a = (j / RING) * Math.PI * 2;
        const up = Math.cos(a);
        const x = Math.sin(a) * r * 0.86;
        const y = BODY_Y + up * r + lift;
        let c: RGB = up < -0.2 && z > -0.2 ? p.belly : p.back;
        if (ringIndex === 4 || ringIndex === 5) c = p.neck;
        if (p.collar && ringIndex === 5 && up > -0.1) c = [0.1, 0.09, 0.09];
        push(x, y, z, c, 0, part);
      }
    });
    for (let i = 0; i < PROFILE.length - 1; i++) {
      for (let j = 0; j < RING; j++) {
        const a = base + i * RING + j;
        const b = base + i * RING + ((j + 1) % RING);
        index.push(a, a + RING, b, b, a + RING, b + RING);
      }
    }
    const lastRing = base + (PROFILE.length - 1) * RING;
    const beak = base + push(0, BODY_Y + 0.09, 0.45, p.beak, 0, PART.head);
    for (let j = 0; j < RING; j++) index.push(lastRing + j, beak, lastRing + ((j + 1) % RING));
    // Close the tail end of the body.
    const rump = base + push(0, BODY_Y + 0.04, -0.29, p.back, 0, PART.body);
    for (let j = 0; j < RING; j++) index.push(base + ((j + 1) % RING), rump, base + j);

    // Tail: a fan, broadening to a squared end, darker at the tip.
    const t0 = base + push(-0.045, 0.19, -0.24, p.back, 0, PART.tail);
    const t1 = base + push(0.045, 0.19, -0.24, p.back, 0, PART.tail);
    const t2 = base + push(0.12, 0.2, -0.53, p.primaries, 0, PART.tail);
    const t3 = base + push(-0.12, 0.2, -0.53, p.primaries, 0, PART.tail);
    index.push(t0, t1, t2, t0, t2, t3);

    // Wings: an arm from shoulder to wrist and a hand from wrist to tip, each
    // its own part so the hand can bend at the wrist. The leading edge is the
    // covert colour and the trailing edge the bar colour, which interpolates
    // into the band across the wing that a dove is recognised by in flight.
    for (const side of [-1, 1]) {
      const s = side;
      const a0 = base + push(s * SHOULDER_X, SHOULDER_Y, 0.13, p.coverts, s, PART.arm);
      const a1 = base + push(s * SHOULDER_X, SHOULDER_Y, -0.1, p.bars, s, PART.arm);
      const a2 = base + push(s * WRIST_X, SHOULDER_Y, 0.09, p.coverts, s, PART.arm);
      const a3 = base + push(s * WRIST_X, SHOULDER_Y, -0.17, p.bars, s, PART.arm);
      index.push(a0, a2, a1, a1, a2, a3);

      const h0 = base + push(s * WRIST_X, SHOULDER_Y, 0.09, p.coverts, s, PART.hand);
      const h1 = base + push(s * WRIST_X, SHOULDER_Y, -0.17, p.primaries, s, PART.hand);
      const h2 = base + push(s * 0.6, SHOULDER_Y, 0.0, p.primaries, s, PART.hand);
      const h3 = base + push(s * TIP_X, SHOULDER_Y, -0.2, p.primaries, s, PART.hand);
      const h4 = base + push(s * 0.55, SHOULDER_Y, -0.27, p.primaries, s, PART.hand);
      index.push(h0, h2, h1, h1, h2, h4, h2, h3, h4);
    }
  });

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(color), 3));
  g.setAttribute('aRig', new BufferAttribute(new Float32Array(rig), 4));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// --------------------------------------------------------------- material

/** About the Y axis. */
function turnY(v: Vec3Node, a: FloatNode): Vec3Node {
  const c = a.cos();
  const s = a.sin();
  return vec3(v.x.mul(c).add(v.z.mul(s)), v.y, v.z.mul(c).sub(v.x.mul(s)));
}
/** About the X axis; positive tips +Z down. */
function turnX(v: Vec3Node, a: FloatNode): Vec3Node {
  const c = a.cos();
  const s = a.sin();
  return vec3(v.x, v.y.mul(c).sub(v.z.mul(s)), v.y.mul(s).add(v.z.mul(c)));
}
/** About the Z axis; positive raises +X. */
function turnZ(v: Vec3Node, a: FloatNode): Vec3Node {
  const c = a.cos();
  const s = a.sin();
  return vec3(v.x.mul(c).sub(v.y.mul(s)), v.x.mul(s).add(v.y.mul(c)), v.z);
}

interface Rig {
  pose: Vector4[];
  attitude: Vector4[];
  wing: Vector4[];
  head: Vector4[];
}

function doveMaterial(r: Rig) {
  const material = new MeshStandardNodeMaterial();
  material.side = DoubleSide;
  // Facets, from screen-space derivatives. The wings fold and flap in the
  // vertex shader, so baked normals would be wrong in every pose but one, and
  // the low-poly faceting is the right look for a bird this size anyway.
  material.flatShading = true;
  material.roughness = 0.85;
  material.metalness = 0;

  const arrays = {
    pose: uniformArray(r.pose, 'vec4'),
    attitude: uniformArray(r.attitude, 'vec4'),
    wing: uniformArray(r.wing, 'vec4'),
    head: uniformArray(r.head, 'vec4'),
  };

  const tag = attribute<'vec4'>('aRig', 'vec4');
  const id = tag.x.toInt();
  const side = tag.y;
  const part = tag.z;
  const read = (a: ReturnType<typeof uniformArray>) => a.element(id) as unknown as Vec4Node;
  const pose = read(arrays.pose);
  const q = read(arrays.attitude);
  const wing = read(arrays.wing);
  const head = read(arrays.head);

  const is = (k: number) => step(k - 0.5, part).sub(step(k + 0.5, part));
  const isHead = is(PART.head);
  const isTail = is(PART.tail);
  const isHand = is(PART.hand);
  const isWing = is(PART.arm).add(isHand);

  const flap = wing.x;
  const fold = wing.y;
  const wristBend = wing.z;
  const tailLift = wing.w;

  const rest = positionLocal;

  // Folded: the wing laid back along the flank, the tip reaching the tail.
  // Spread: the rest pose. Everything between is a blend of the two, which at
  // this size reads as folding.
  const reach = rest.x.abs().sub(SHOULDER_X).div(TIP_X - SHOULDER_X).clamp(0, 1);
  const tucked = vec3(
    side.mul(reach.mul(0.035).add(0.11)),
    reach.mul(0.035).add(SHOULDER_Y - 0.005),
    rest.z.mul(0.3).add(0.07).sub(reach.mul(0.44)),
  );
  const folded = mix(rest, tucked, fold.mul(isWing));

  // The hand bends at the wrist first, then the whole wing turns about the
  // shoulder. Both scaled out as the wing folds, so a perched bird's tucked
  // wing cannot flap.
  const open = fold.oneMinus();
  const wrist = vec3(side.mul(WRIST_X), SHOULDER_Y, 0);
  const bentHand = wrist.add(turnZ(folded.sub(wrist), side.mul(wristBend).mul(open)));
  const handed = mix(folded, bentHand, isHand);
  const shoulder = vec3(side.mul(SHOULDER_X), SHOULDER_Y, 0);
  const flapped = shoulder.add(turnZ(handed.sub(shoulder), side.mul(flap).mul(open)));
  const winged = mix(handed, flapped, isWing);

  // The head turns and tips about the base of the neck, and is pushed forward
  // and back — the bob a walking dove makes with every step.
  const neck = vec3(NECK[0], NECK[1], NECK[2]);
  const headed = neck.add(turnX(turnY(winged.sub(neck), head.x), head.y)).add(vec3(0, 0, head.z));
  const withHead = mix(winged, headed, isHead);

  // The tail lifts and spreads to brake on landing.
  const root = vec3(TAIL_ROOT[0], TAIL_ROOT[1], TAIL_ROOT[2]);
  const tailed = root.add(turnX(withHead.sub(root), tailLift.negate()));
  const local = mix(withHead, tailed, isTail);

  // Into the world: scale, rotate by the bird's attitude quaternion, place.
  const v = local.mul(pose.w);
  const qv = vec3(q.x, q.y, q.z);
  const turned = v.add(qv.cross(qv.cross(v).add(v.mul(q.w))).mul(2));
  material.positionNode = turned.add(vec3(pose.x, pose.y, pose.z));

  material.colorNode = attribute<'vec3'>('color', 'vec3');

  const sync = () => {
    let ready = true;
    for (const a of Object.values(arrays)) {
      const node = a as unknown as { value: Float32Array | null; update(): void };
      if (node.value === null) ready = false;
      else node.update();
    }
    return ready;
  };

  return { material, sync };
}

// --------------------------------------------------------------- behaviour

type Mode = 'away' | 'perched' | 'ground' | 'flying';
type Landing = 'perch' | 'ground';
type Act = 'still' | 'peck' | 'preen' | 'coo' | 'walk';

interface Dove {
  mode: Mode;
  size: number;
  /** Feet, in world space. */
  pos: Vector3;
  yaw: number;
  pitch: number;
  roll: number;

  perch: number;
  spot: Vector3;
  facing: number;

  curve: CatmullRomCurve3 | null;
  landing: Landing;
  t: number;
  duration: number;
  ramp: number;
  lastYaw: number;

  flapPhase: number;
  /** Beat amplitude, eased; 0 is a glide. */
  beat: number;
  beating: boolean;
  burst: number;
  fold: number;
  tailLift: number;

  /** Seconds until the next decision. */
  rest: number;
  act: Act;
  actTime: number;
  actLength: number;
  headYaw: number;
  headPitch: number;
  headPush: number;
  lookYaw: number;
  lookPitch: number;
  lookTimer: number;
  walkTo: Vector3 | null;
  stride: number;
  /** A startled bird waiting the fraction of a second before it goes. */
  flushIn: number;
  /** How much room the leaves are making for it, eased. */
  presence: number;
}

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _q = new Quaternion();
const _e = new Euler(0, 0, 0, 'YXZ');

/** Wrap an angle into (-π, π]. */
const wrap = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
/** Frame-rate independent approach: covers ~63% of the gap every 1/rate s. */
const ease = (from: number, to: number, rate: number, dt: number) => from + (to - from) * (1 - Math.exp(-rate * dt));

/**
 * Progress along a flight from its elapsed fraction: a trapezoid of speed with
 * soft ends, so a bird leaves a branch gently, cruises, and slows into the
 * next one rather than arriving at speed.
 */
function along(t: number, ramp: number): number {
  const vmax = 1 / (1 - ramp);
  if (t < ramp) return (vmax * t * t) / (2 * ramp);
  if (t > 1 - ramp) return 1 - (vmax * (1 - t) * (1 - t)) / (2 * ramp);
  return vmax * (ramp / 2 + (t - ramp));
}

export interface FlockOptions {
  count: number;
  seed: number;
}

export class Flock {
  readonly mesh: Mesh;

  private readonly doves: Dove[] = [];
  private readonly rig: Rig;
  private readonly sync: () => boolean;
  private readonly rng: () => number;
  private readonly taken = new Set<number>();
  private perches: Perch[] = [];
  private clock = 0;
  /** When the crown was last rustled hard enough to put the birds up. */
  private startledAt = -100;
  private wheelTurn = 1;
  private readonly guests: { x: number; y: number; z: number; radius: number }[] = [];

  constructor(
    private readonly tree: Tree,
    options: Partial<FlockOptions> = {},
  ) {
    const { count = 12, seed = 7 } = options;
    const n = Math.min(MAX_BIRDS, count);
    this.rng = mulberry32(seed + 4243);

    const blank = () => Array.from({ length: MAX_BIRDS }, () => new Vector4(0, 0, 0, 0));
    this.rig = { pose: blank(), attitude: blank(), wing: blank(), head: blank() };

    // Kinds in rotation from a random start, so every kind is present.
    const first = (this.rng() * KINDS.length) | 0;
    const plumage = Array.from({ length: n }, (_, i) => KINDS[(first + i) % KINDS.length]);

    const { material, sync } = doveMaterial(this.rig);
    this.sync = sync;
    this.mesh = new Mesh(buildDoves(plumage), material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = false;

    for (let i = 0; i < n; i++) {
      this.doves.push({
        mode: 'away',
        size: 0.34 + this.rng() * 0.08,
        pos: this.offstage(new Vector3()),
        yaw: 0,
        pitch: 0,
        roll: 0,
        perch: -1,
        spot: new Vector3(),
        facing: 1,
        curve: null,
        landing: 'perch',
        t: 0,
        duration: 1,
        ramp: 0.2,
        lastYaw: 0,
        flapPhase: this.rng() * 6.28,
        beat: 0,
        beating: true,
        burst: 0,
        fold: 1,
        tailLift: 0,
        // Arrivals staggered, so the tree fills up rather than being landed on.
        rest: 1.5 + i * 0.9 + this.rng() * 3,
        act: 'still',
        actTime: 0,
        actLength: 0,
        headYaw: 0,
        headPitch: 0,
        headPush: 0,
        lookYaw: 0,
        lookPitch: 0,
        lookTimer: 0,
        walkTo: null,
        stride: 0,
        flushIn: -1,
        presence: 0,
      });
    }
  }

  /**
   * Put up every bird near `point`: everything on the tree, and anything on
   * the ground close by. They go up within a fraction of a second of each
   * other and wheel round the tree together before coming back down — and if
   * the crown is still being rustled when they get back, they go up again.
   */
  startle(point: Vector3): void {
    if (this.clock - this.startledAt > 6) this.wheelTurn = this.rng() < 0.5 ? -1 : 1;
    this.startledAt = this.clock;
    for (const d of this.doves) {
      if (d.flushIn >= 0) continue;
      const onTree = d.mode === 'perched';
      const near = d.mode === 'ground' && Math.hypot(d.pos.x - point.x, d.pos.z - point.z) < 4;
      if (onTree || near) d.flushIn = this.rng() * 0.35;
    }
  }

  update(dt: number): void {
    this.clock += dt;
    const grown = this.tree.uniforms.growth.value >= 0.97;

    // A rebuilt tree has different perches; anyone on the old ones is put up.
    if (this.tree.perches !== this.perches) {
      this.perches = this.tree.perches;
      this.taken.clear();
      for (const d of this.doves) {
        if (d.mode === 'perched' || (d.mode === 'flying' && d.landing === 'perch')) {
          d.perch = -1;
          if (d.mode === 'perched') d.flushIn = this.rng() * 0.3;
          else this.redirect(d);
        }
      }
    }

    for (let i = 0; i < this.doves.length; i++) {
      const d = this.doves[i];

      if (d.flushIn >= 0) {
        d.flushIn -= dt;
        if (d.flushIn < 0) this.wheel(d);
      }

      switch (d.mode) {
        case 'away':
          d.rest -= dt;
          if (d.rest <= 0 && grown) this.arrive(d);
          break;
        case 'perched':
          if (!grown) {
            d.flushIn = Math.max(d.flushIn, this.rng() * 0.4);
            break;
          }
          this.sit(d, dt);
          break;
        case 'ground':
          this.forage(d, dt);
          break;
        case 'flying':
          this.fly(d, dt);
          break;
      }

      this.pose(i, d);

      // The leaves part as it comes in to a twig and close behind it when it
      // goes — eased both ways, so the canopy never snaps.
      const settling = d.mode === 'flying' && d.landing === 'perch' && d.t > 0.7;
      d.presence = ease(d.presence, d.mode === 'perched' || settling ? 1 : 0, settling ? 3 : 2, dt);
    }

    this.guests.length = 0;
    for (const d of this.doves) {
      if (d.presence < 0.01) continue;
      this.guests.push({ x: d.pos.x, y: d.pos.y + d.size * 0.25, z: d.pos.z, radius: 0.55 * d.presence });
    }
    this.tree.setGuests(this.guests);

    this.sync();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardNodeMaterial).dispose();
  }

  // ------------------------------------------------------------ choosing

  private offstage(out: Vector3): Vector3 {
    const a = this.rng() * Math.PI * 2;
    return out.set(Math.cos(a) * 46, 13 + this.rng() * 6, Math.sin(a) * 46);
  }

  private freePerch(): number {
    const growth = this.tree.uniforms.growth.value;
    const open: number[] = [];
    this.perches.forEach((p, i) => {
      if (!this.taken.has(i) && p.birth < growth) open.push(i);
    });
    return open.length ? open[(this.rng() * open.length) | 0] : -1;
  }

  private groundSpot(out: Vector3, avoidTree = false): Vector3 {
    const reach = Math.max(2.4, this.tree.radius * 0.9);
    const r = avoidTree ? reach + 1.5 + this.rng() * 3 : 2 + this.rng() * (reach + 3);
    const a = this.rng() * Math.PI * 2;
    return out.set(Math.cos(a) * Math.min(r, 6.5), 0, Math.sin(a) * Math.min(r, 6.5));
  }

  /**
   * Where it will land next: a free twig, or the grass.
   *
   * Chosen at take-off, so it cannot know whether the tree will still be
   * shaking when it gets back — and does not need to: a bird that comes down on
   * a crown that is still being rustled is simply put up again.
   */
  private chooseLanding(d: Dove, preferGround = false): void {
    const perch = preferGround ? -1 : this.freePerch();
    if (perch >= 0) {
      d.landing = 'perch';
      d.perch = perch;
      this.taken.add(perch);
    } else {
      d.landing = 'ground';
      this.groundSpot(d.spot, this.clock - this.startledAt < 3);
    }
  }

  private target(d: Dove, out: Vector3): Vector3 {
    if (d.landing === 'perch' && d.perch >= 0) {
      const p = this.perches[d.perch];
      return out.set(p.x, p.y, p.z);
    }
    return out.copy(d.spot);
  }

  // ------------------------------------------------------------- flights

  private launch(d: Dove, via: Vector3[]): void {
    if (d.mode === 'perched' && d.perch >= 0) this.taken.delete(d.perch);
    const to = this.target(d, new Vector3());
    const from = d.pos.clone();

    const points = [from];
    // Up and away from where it was sitting before anything else.
    const heading = new Vector3(Math.sin(d.yaw), 0, Math.cos(d.yaw));
    if (d.mode !== 'away') points.push(from.clone().addScaledVector(heading, 0.5).add(new Vector3(0, 0.6, 0)));
    points.push(...via);

    // Come in from outside the crown and a little above, so the last few
    // metres are a glide down onto the twig rather than through the leaves.
    const last = points[points.length - 1];
    const inward = _a.set(to.x - last.x, 0, to.z - last.z);
    if (d.landing === 'perch') inward.set(-to.x, 0, -to.z);
    if (inward.lengthSq() < 1e-4) inward.set(1, 0, 0);
    inward.normalize();
    points.push(to.clone().addScaledVector(inward, -1.1).add(new Vector3(0, 0.7, 0)));
    points.push(to);

    d.curve = new CatmullRomCurve3(points, false, 'centripetal');
    const length = d.curve.getLength();
    const speed = 3.6 + this.rng() * 1.2;
    d.duration = MathUtils.clamp(length / speed, 0.9, 40);
    d.ramp = MathUtils.clamp(1.1 / d.duration, 0.1, 0.4);
    d.t = 0;
    d.mode = 'flying';
    d.beating = true;
    d.burst = 0.6;
    d.act = 'still';
  }

  /** Around the crown, outside it, at roughly the height of the canopy. */
  private crossing(from: Vector3, to: Vector3): Vector3[] {
    const reach = Math.max(2.5, this.tree.radius) * 1.35;
    const a0 = Math.atan2(from.z, from.x);
    const a1 = Math.atan2(to.z, to.x);
    const mid = a0 + wrap(a1 - a0) / 2;
    const y = Math.max(from.y, to.y) + 0.8;
    if (from.distanceTo(to) < 1.8) return [];
    return [new Vector3(Math.cos(mid) * reach, y, Math.sin(mid) * reach)];
  }

  private arrive(d: Dove): void {
    this.chooseLanding(d);
    this.offstage(d.pos);
    const to = this.target(d, _b);
    const reach = Math.max(3, this.tree.radius) * 1.8;
    const a = Math.atan2(to.z, to.x) + (this.rng() - 0.5);
    const via = [new Vector3(Math.cos(a) * reach, to.y + 2.5, Math.sin(a) * reach)];
    d.yaw = Math.atan2(-d.pos.x, -d.pos.z);
    this.launch(d, via);
  }

  /** Up together and round the tree, then back down. */
  private wheel(d: Dove): void {
    d.flushIn = -1;
    if (d.mode === 'perched' && d.perch >= 0) this.taken.delete(d.perch);
    const radius = Math.max(4.5, this.tree.radius * 2.2) + this.rng() * 2.5;
    const height = Math.max(5, this.tree.height * 0.85) + this.rng() * 2.5;
    const start = Math.atan2(d.pos.z, d.pos.x);
    const turns = 0.9 + this.rng() * 0.7;
    const steps = Math.max(4, Math.round(turns * 7));
    const via: Vector3[] = [];
    for (let k = 1; k <= steps; k++) {
      const a = start + this.wheelTurn * (k / 7) * Math.PI * 2;
      const lift = Math.sin((k / steps) * Math.PI) * 1.5;
      via.push(new Vector3(Math.cos(a) * radius, height + lift, Math.sin(a) * radius));
    }
    this.chooseLanding(d);
    this.launch(d, via);
  }

  /** Change of plan mid-air: the perch it was heading for has gone. */
  private redirect(d: Dove): void {
    if (!d.curve) return;
    const here = d.curve.getPointAt(along(d.t, d.ramp));
    d.pos.copy(here);
    d.landing = 'ground';
    this.groundSpot(d.spot);
    d.mode = 'ground';
    this.launch(d, []);
  }

  private fly(d: Dove, dt: number): void {
    const curve = d.curve!;
    d.t = Math.min(1, d.t + dt / d.duration);
    const u = along(d.t, d.ramp);
    curve.getPointAt(u, d.pos);

    // A swaying twig is a moving target: blend its sway in over the approach.
    if (d.landing === 'perch' && d.perch >= 0) {
      const p = this.perches[d.perch];
      this.tree.swayed(p.x, p.y, p.z, p.flex, _a).sub(_b.set(p.x, p.y, p.z));
      d.pos.addScaledVector(_a, MathUtils.smoothstep(u, 0.75, 1));
    }

    // Attitude off the path: heading along it, nose following the climb, and
    // a bank into the turn proportional to how fast the heading is changing.
    curve.getTangentAt(Math.min(0.999, u), _c);
    const flat = Math.hypot(_c.x, _c.z);
    const yaw = flat > 1e-3 ? Math.atan2(_c.x, _c.z) : d.yaw;
    const turnRate = wrap(yaw - d.lastYaw) / Math.max(dt, 1e-3);
    d.lastYaw = yaw;
    d.yaw = d.yaw + wrap(yaw - d.yaw) * (1 - Math.exp(-dt * 10));

    const landing = d.t > 1 - d.ramp * 1.1;
    const climb = -Math.atan2(_c.y, Math.max(flat, 1e-3)) * 0.6;
    d.pitch = ease(d.pitch, landing ? -0.75 : MathUtils.clamp(climb, -0.6, 0.45), 6, dt);
    d.roll = ease(d.roll, MathUtils.clamp(-turnRate * 0.32, -0.85, 0.85), 5, dt);

    // Beat in runs and glide between them. Always beat to climb, to leave a
    // branch and to come in; glide on the level and on the way down.
    const climbing = _c.y > 0.35;
    const forced = climbing || d.t < d.ramp * 1.2 || landing;
    d.burst -= dt;
    if (d.burst <= 0) {
      d.beating = !d.beating;
      d.burst = d.beating ? 0.35 + this.rng() * 0.5 : 0.5 + this.rng() * 0.9;
    }
    const beating = forced || d.beating;
    d.beat = ease(d.beat, beating ? 1 : 0, beating ? 12 : 5, dt);
    d.flapPhase += dt * Math.PI * 2 * (landing ? 8 : 6.2) * (0.4 + 0.6 * d.beat);
    d.fold = ease(d.fold, 0, 10, dt);
    d.tailLift = ease(d.tailLift, landing ? 0.55 : 0.05, 6, dt);
    d.headYaw = ease(d.headYaw, 0, 6, dt);
    d.headPitch = ease(d.headPitch, 0, 6, dt);
    d.headPush = ease(d.headPush, 0, 6, dt);

    if (d.t >= 1) this.land(d);
  }

  private land(d: Dove): void {
    d.curve = null;
    d.beat = 0;
    if (d.landing === 'perch' && d.perch >= 0) {
      d.mode = 'perched';
      // Across the branch, facing whichever way it came in.
      const p = this.perches[d.perch];
      const across = p.along + Math.PI / 2;
      d.facing = Math.cos(wrap(d.yaw - across)) >= 0 ? 1 : -1;
      d.rest = 6 + this.rng() * 16;
    } else {
      d.mode = 'ground';
      d.rest = 5 + this.rng() * 12;
    }
    d.act = 'still';
    d.lookTimer = 0.3;
  }

  // ------------------------------------------------------------- at rest

  /** Life on a branch: head jerks, the odd preen or coo, then off. */
  private sit(d: Dove, dt: number): void {
    const p = this.perches[d.perch];
    this.tree.swayed(p.x, p.y, p.z, p.flex, d.pos);
    const across = p.along + Math.PI / 2 + (d.facing < 0 ? Math.PI : 0);
    d.yaw = d.yaw + wrap(across - d.yaw) * (1 - Math.exp(-dt * 6));
    // A perched dove sits up, chest out, tail down.
    d.pitch = ease(d.pitch, -0.38, 4, dt);
    d.roll = ease(d.roll, 0, 4, dt);

    this.live(d, dt, false);

    d.rest -= dt;
    if (d.rest > 0) return;
    const roll = this.rng();
    if (roll < 0.55) {
      // To another twig, round the outside of the crown if it is far.
      const from = d.pos.clone();
      this.taken.delete(d.perch);
      this.chooseLanding(d);
      this.launch(d, this.crossing(from, this.target(d, new Vector3())));
    } else if (roll < 0.85) {
      this.taken.delete(d.perch);
      this.chooseLanding(d, true);
      this.launch(d, []);
    } else {
      this.wheel(d);
    }
  }

  /** On the grass: walking a few steps at a time, pecking. */
  private forage(d: Dove, dt: number): void {
    d.pitch = ease(d.pitch, d.act === 'walk' ? -0.08 : -0.2, 4, dt);
    d.roll = ease(d.roll, 0, 4, dt);

    if (d.act === 'walk' && d.walkTo) {
      _a.subVectors(d.walkTo, d.pos).setY(0);
      const left = _a.length();
      if (left < 0.03) {
        d.act = 'still';
        d.walkTo = null;
      } else {
        const heading = Math.atan2(_a.x, _a.z);
        d.yaw = d.yaw + wrap(heading - d.yaw) * (1 - Math.exp(-dt * 8));
        const step = Math.min(left, dt * 0.32);
        d.pos.addScaledVector(_a.normalize(), step);
        // The head stays put while the body walks under it, then snaps forward.
        d.stride += dt * 5.2;
        d.headPush = (((d.stride / (Math.PI * 2)) % 1) - 0.5) * 0.09;
      }
    }

    this.live(d, dt, true);

    d.rest -= dt;
    if (d.rest > 0) return;
    const grown = this.tree.uniforms.growth.value >= 0.97;
    const roll = this.rng();
    if (grown && roll < 0.6) {
      this.chooseLanding(d);
      this.launch(d, []);
    } else if (roll < 0.85) {
      d.landing = 'ground';
      this.groundSpot(d.spot);
      this.launch(d, []);
    } else {
      this.wheel(d);
    }
  }

  /** The small business of a bird at rest. Shared by branch and ground. */
  private live(d: Dove, dt: number, onGround: boolean): void {
    d.fold = ease(d.fold, d.act === 'preen' ? 0.6 : 1, 8, dt);
    d.tailLift = ease(d.tailLift, 0, 5, dt);
    d.flapPhase = 0;

    // Looking about, in quick turns and long holds.
    d.lookTimer -= dt;
    if (d.lookTimer <= 0) {
      d.lookTimer = 0.5 + this.rng() * 2.2;
      d.lookYaw = (this.rng() - 0.5) * 1.9;
      d.lookPitch = (this.rng() - 0.5) * 0.35;
    }

    if (d.act === 'still' || d.act === 'walk') {
      d.actTime -= dt;
      if (d.act === 'still' && d.actTime <= 0) {
        const r = this.rng();
        d.actTime = 0;
        if (onGround && r < 0.4) this.begin(d, 'peck', 0.6 + this.rng() * 1.2);
        else if (onGround && r < 0.75) {
          d.act = 'walk';
          d.walkTo = d.pos.clone().add(_a.set((this.rng() - 0.5) * 1.2, 0, (this.rng() - 0.5) * 1.2));
          if (Math.hypot(d.walkTo.x, d.walkTo.z) > 6.5) d.walkTo.multiplyScalar(0.8);
        } else if (r < 0.88) this.begin(d, 'preen', 0.8 + this.rng() * 1.2);
        else if (r < 0.96) this.begin(d, 'coo', 1.2 + this.rng());
        else d.actTime = 1 + this.rng() * 3;
      }
    }

    let yaw = d.lookYaw;
    let pitch = d.lookPitch;
    let push = d.act === 'walk' ? d.headPush : 0;
    if (d.act === 'peck' || d.act === 'preen' || d.act === 'coo') {
      d.actTime += dt;
      const k = d.actTime / d.actLength;
      if (d.act === 'peck') {
        // Down to the grass and back, two or three times.
        const dip = Math.max(0, Math.sin(d.actTime * 9));
        pitch = 0.95 * dip;
        push = 0.04 * dip;
        yaw = 0;
      } else if (d.act === 'preen') {
        // Head round into the shoulder.
        yaw = 1.7 * (d.actLength > 1.4 ? 1 : -1);
        pitch = 0.5 + Math.sin(d.actTime * 14) * 0.08;
      } else {
        // The bow of a cooing dove: head down and up, slowly.
        pitch = 0.45 * Math.max(0, Math.sin(d.actTime * 5));
        yaw = 0;
      }
      if (k >= 1) {
        d.act = 'still';
        d.actTime = 0.8 + this.rng() * 2.5;
      }
    }

    // Jerks, not swings: a bird's head moves fast and then holds.
    d.headYaw = ease(d.headYaw, yaw, 16, dt);
    d.headPitch = ease(d.headPitch, pitch, 16, dt);
    d.headPush = ease(d.headPush, push, 20, dt);
  }

  private begin(d: Dove, act: Act, length: number): void {
    d.act = act;
    d.actTime = 0;
    d.actLength = length;
  }

  // ----------------------------------------------------------------- out

  private pose(i: number, d: Dove): void {
    const r = this.rig;
    const visible = d.mode !== 'away';
    r.pose[i].set(d.pos.x, d.pos.y, d.pos.z, visible ? d.size : 0);

    _e.set(d.pitch, d.yaw, d.roll, 'YXZ');
    _q.setFromEuler(_e);
    r.attitude[i].set(_q.x, _q.y, _q.z, _q.w);

    // In the glide the wings are held up in a shallow V; the beat swings
    // through it, and the hand trails the arm by a fraction of a stroke.
    const dihedral = 0.3;
    const flap = dihedral + d.beat * 0.95 * Math.sin(d.flapPhase);
    const wrist = d.beat * 0.5 * Math.sin(d.flapPhase - 1.1) - 0.08 * (1 - d.beat);
    r.wing[i].set(flap, d.fold, wrist, d.tailLift);
    r.head[i].set(d.headYaw, d.headPitch, d.headPush, 0);
  }
}
