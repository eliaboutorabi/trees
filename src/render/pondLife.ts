/**
 * The pond's own creatures: a family of mallards, and a robin in winter.
 *
 * The ducks keep the year as the pond does. In spring a pair arrives and the
 * hen has ducklings, tiny, trailing her in a line; in summer the ducklings
 * are half grown and the drake has gone off; in autumn the pair is back
 * together; and when the ice closes over, they are gone — they slip under the
 * water as it freezes rather than vanishing on the surface — and a robin
 * comes to hop about the snowy stones instead.
 *
 * The hen paddles a slow loop round the pond, stopping now and then to
 * up-end and dabble; the ducklings follow her actual wake, each a little way
 * further back along it, so they bunch up when she stops and string out when
 * she sets off; the drake keeps her company a length behind. Each duck is a
 * small mesh of a few shapes coloured per vertex, placed every frame; they
 * stand in the water's reflection, and hand their positions to the water so
 * it can trail a V behind each one.
 */
import {
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  SphereGeometry,
  Vector3,
  Vector4,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { mulberry32 } from '../lib/rng';
import { POND, shorePoint } from './pondShape';

/** The most ducks there can be, for the water's wakes. */
export const MAX_DUCKS = 6;

type Plumage = 'hen' | 'drake' | 'duckling';

interface Part {
  geometry: BufferGeometry;
  colour: (p: Vector3) => Color;
}

const c = (r: number, g: number, b: number) => new Color(r, g, b);

/**
 * A mallard, facing +z with its waterline at y = 0: an egg of a body riding
 * low, a short tail cocked up, a round head on a short neck, and a flat bill.
 * Coloured per vertex by what it is and where on the bird it falls.
 */
function duckGeometry(kind: Plumage): BufferGeometry {
  const body = new SphereGeometry(1, 14, 10);
  body.scale(0.15, 0.1, 0.28);
  body.translate(0, 0.045, 0);
  const tail = new ConeGeometry(0.055, 0.13, 6);
  tail.rotateX(-Math.PI / 2 - 0.55);
  tail.translate(0, 0.1, -0.28);
  const neck = new CylinderGeometry(0.035, 0.045, 0.12, 8);
  neck.rotateX(0.35);
  neck.translate(0, 0.15, 0.17);
  const head = new SphereGeometry(0.068, 12, 9);
  head.scale(1, 0.95, 1.12);
  head.translate(0, 0.225, 0.22);
  const bill = new ConeGeometry(0.03, 0.085, 6);
  bill.rotateX(Math.PI / 2);
  bill.scale(1.25, 0.55, 1);
  bill.translate(0, 0.212, 0.3);
  const eyes = new SphereGeometry(0.011, 6, 4);
  const eyeL = eyes.clone().translate(0.05, 0.24, 0.255);
  const eyeR = eyes.clone().translate(-0.05, 0.24, 0.255);
  eyes.dispose();

  const P: Record<Plumage, { body: (p: Vector3) => Color; head: Color; bill: Color; tail: Color; neck: (p: Vector3) => Color }> = {
    hen: {
      // Mottled brown, a little darker on the back.
      body: (p) => c(0.42, 0.3, 0.18).multiplyScalar(0.85 + Math.sin(p.x * 61 + p.z * 47) * 0.08 + (p.y > 0.08 ? -0.08 : 0.04)),
      head: c(0.36, 0.26, 0.15),
      bill: c(0.86, 0.5, 0.16),
      tail: c(0.3, 0.21, 0.12),
      neck: () => c(0.38, 0.27, 0.16),
    },
    drake: {
      // Grey flanks, a chestnut breast, a white collar under a green head.
      body: (p) => (p.z > 0.13 && p.y < 0.11 ? c(0.42, 0.21, 0.12) : c(0.66, 0.64, 0.6).multiplyScalar(p.y > 0.11 ? 0.82 : 1)),
      head: c(0.04, 0.3, 0.15),
      bill: c(0.86, 0.76, 0.22),
      tail: c(0.12, 0.11, 0.1),
      neck: (p) => (p.y < 0.13 ? c(0.94, 0.93, 0.9) : c(0.04, 0.3, 0.15)),
    },
    duckling: {
      // Yellow down, a dark cap and back.
      body: (p) => (p.y > 0.1 ? c(0.45, 0.36, 0.2) : c(0.96, 0.83, 0.32)),
      head: c(0.96, 0.82, 0.3),
      bill: c(0.3, 0.24, 0.12),
      tail: c(0.45, 0.36, 0.2),
      neck: () => c(0.96, 0.83, 0.32),
    },
  };
  const look = P[kind];
  const parts: Part[] = [
    { geometry: body, colour: look.body },
    { geometry: tail, colour: () => look.tail },
    { geometry: neck, colour: look.neck },
    { geometry: head, colour: (p) => (kind === 'duckling' && p.y > 0.26 ? c(0.45, 0.36, 0.2) : look.head) },
    { geometry: bill, colour: () => look.bill },
    { geometry: eyeL, colour: () => c(0.04, 0.03, 0.03) },
    { geometry: eyeR, colour: () => c(0.04, 0.03, 0.03) },
  ];
  const v = new Vector3();
  const coloured = parts.map(({ geometry, colour }) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = g.getAttribute('position');
    const colours: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const col = colour(v.fromBufferAttribute(pos, i));
      colours.push(col.r, col.g, col.b);
    }
    g.setAttribute('color', new Float32BufferAttribute(colours, 3));
    g.deleteAttribute('uv');
    return g;
  });
  const merged = mergeGeometries(coloured)!;
  for (const g of [...coloured, ...parts.map((p) => p.geometry)]) g.dispose();
  return merged;
}

/** A robin: round, brown above with an orange breast, a thin tail and a dark bill. Feet at y = 0. */
function robinGeometry(): BufferGeometry {
  const body = new SphereGeometry(0.055, 12, 9);
  body.scale(1, 0.95, 1.15);
  body.translate(0, 0.07, 0);
  const head = new SphereGeometry(0.036, 10, 8);
  head.translate(0, 0.125, 0.04);
  const tail = new ConeGeometry(0.022, 0.07, 5);
  tail.rotateX(-Math.PI / 2 - 0.4);
  tail.translate(0, 0.07, -0.07);
  const bill = new ConeGeometry(0.008, 0.025, 5);
  bill.rotateX(Math.PI / 2);
  bill.translate(0, 0.122, 0.082);
  const legs = new CylinderGeometry(0.004, 0.004, 0.03, 4);
  const legL = legs.clone().translate(0.015, 0.015, 0);
  const legR = legs.clone().translate(-0.015, 0.015, 0);
  legs.dispose();
  const parts: Part[] = [
    { geometry: body, colour: (p) => (p.z > 0.0 && p.y < 0.095 ? c(0.88, 0.42, 0.16) : c(0.4, 0.31, 0.22)) },
    { geometry: head, colour: (p) => (p.z > 0.05 && p.y < 0.13 ? c(0.88, 0.42, 0.16) : c(0.4, 0.31, 0.22)) },
    { geometry: tail, colour: () => c(0.33, 0.25, 0.18) },
    { geometry: bill, colour: () => c(0.1, 0.08, 0.06) },
    { geometry: legL, colour: () => c(0.3, 0.22, 0.18) },
    { geometry: legR, colour: () => c(0.3, 0.22, 0.18) },
  ];
  const v = new Vector3();
  const coloured = parts.map(({ geometry, colour }) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = g.getAttribute('position');
    const colours: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const col = colour(v.fromBufferAttribute(pos, i));
      colours.push(col.r, col.g, col.b);
    }
    g.setAttribute('color', new Float32BufferAttribute(colours, 3));
    g.deleteAttribute('uv');
    return g;
  });
  const merged = mergeGeometries(coloured)!;
  for (const g of [...coloured, ...parts.map((p) => p.geometry)]) g.dispose();
  return merged;
}

/** Who is on the pond in each season: drake, ducklings, and how grown the ducklings are. */
export interface DuckSeason {
  drake: number;
  ducklings: number;
  grown: number;
}

interface Duck {
  mesh: Mesh;
  kind: Plumage;
  /** For a follower: how far back along the hen's wake, in metres. */
  behind: number;
  /** A sideways offset from the wake, so a line of ducklings is not a ruler. */
  side: number;
  phase: number;
  /** Shown, eased: in and out with the season and the ice. */
  shown: number;
  pos: Vector3;
  heading: number;
}

const ease = (from: number, to: number, rate: number, dt: number) => from + (to - from) * (1 - Math.exp(-rate * dt));
const wrap = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

export class PondLife {
  readonly group = new Group();
  /** Where each duck is and which way and how fast it is going, for the water's wakes: x, z, vx, vz. */
  readonly wakes: Vector4[] = Array.from({ length: MAX_DUCKS }, () => new Vector4());

  private readonly ducks: Duck[] = [];
  private readonly path: CatmullRomCurve3;
  private readonly length: number;
  private readonly robin: Mesh;
  private readonly material = new MeshStandardNodeMaterial();
  private readonly rng = mulberry32(31337);

  /** How far round the loop the hen is, 0–1. */
  private along = 0;
  /** Paddling or stopped to dabble, and for how much longer. */
  private dabbling = false;
  private stateTime = 6;
  private tip = 0;
  /** The hen's wake, newest first, for the followers to follow. */
  private readonly trail: Vector3[] = [];
  private robinSpot = 0;
  private robinHop = 0;
  private robinWait = 2;
  private robinShown = 0;
  private clock = 0;

  constructor() {
    this.material.vertexColors = true;
    this.material.roughness = 0.75;
    this.material.metalness = 0;

    // A slow, lopsided loop well inside the shore.
    const points = [0, 0.9, 1.7, 2.5, 3.3, 4.2, 5.2].map((theta, i) => {
      const at = shorePoint(theta + 0.2, 0.52 + (i % 2) * 0.12);
      return new Vector3(at.x, POND.level, at.z);
    });
    this.path = new CatmullRomCurve3(points, true, 'centripetal');
    this.length = this.path.getLength();

    const add = (kind: Plumage, behind: number, side: number, scale = 1) => {
      const mesh = new Mesh(duckGeometry(kind), this.material);
      mesh.scale.setScalar(scale);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.ducks.push({ mesh, kind, behind, side, phase: this.rng() * 6.28, shown: 0, pos: new Vector3(), heading: 0 });
    };
    add('hen', 0, 0);
    add('drake', 0.75, 0.22);
    for (let i = 0; i < 4; i++) add('duckling', 0.42 + i * 0.27, (i % 2 ? 1 : -1) * 0.05 * (1 + this.rng()));

    this.robin = new Mesh(robinGeometry(), this.material);
    this.robin.visible = false;
    this.group.add(this.robin);
  }

  /**
   * One frame. `season` says who should be here; `ice` how frozen the pond
   * is (the ducks leave under it, the robin comes); `perches` where on the
   * stones the robin can stand.
   */
  update(dt: number, season: DuckSeason, ice: number, perches: Vector3[]): void {
    this.clock += dt;
    const open = 1 - ice;

    // The hen: paddle, and every so often stop to up-end in the weed.
    this.stateTime -= dt;
    if (this.stateTime <= 0) {
      this.dabbling = !this.dabbling;
      this.stateTime = this.dabbling ? 2 + this.rng() * 2.5 : 6 + this.rng() * 9;
    }
    const speed = this.dabbling ? 0 : 0.22;
    this.along = (this.along + (speed * dt * open) / this.length) % 1;
    this.tip = ease(this.tip, this.dabbling && open > 0.5 ? 1 : 0, 5, dt);
    const head = this.path.getPointAt(this.along);
    const tangent = this.path.getTangentAt(this.along);

    // Her wake, kept a few metres long.
    if (!this.trail.length || this.trail[0].distanceTo(head) > 0.03) {
      this.trail.unshift(head.clone());
      if (this.trail.length > 160) this.trail.pop();
    }

    for (let i = 0; i < this.ducks.length; i++) {
      const d = this.ducks[i];
      const wanted =
        d.kind === 'hen' ? 1 : d.kind === 'drake' ? season.drake : season.ducklings * (i - 2 < Math.round(season.ducklings * 4) ? 1 : 0);
      d.shown = ease(d.shown, wanted * (open > 0.4 ? 1 : 0), 1.2, dt);

      let x: number;
      let z: number;
      let heading: number;
      if (d.kind === 'hen') {
        x = head.x;
        z = head.z;
        heading = Math.atan2(tangent.x, tangent.z);
      } else {
        const at = this.trailAt(d.behind);
        const ahead = this.trailAt(Math.max(0, d.behind - 0.12));
        heading = Math.atan2(ahead.x - at.x, ahead.z - at.z) || d.heading;
        x = at.x + Math.cos(heading) * d.side;
        z = at.z - Math.sin(heading) * d.side;
      }
      const moved = Math.hypot(x - d.pos.x, z - d.pos.z) / Math.max(dt, 1e-3);
      d.pos.set(x, 0, z);
      d.heading = d.heading + wrap(heading - d.heading) * (1 - Math.exp(-dt * 5));

      // Bobbing on the ripples, each to its own rhythm; sunk under the ice.
      const bob = Math.sin(this.clock * 2.1 + d.phase) * 0.007;
      const sink = (1 - Math.min(1, d.shown * 1.4)) * 0.45;
      const scale = d.kind === 'duckling' ? 0.36 + 0.16 * season.grown : 1;
      d.mesh.visible = d.shown > 0.01;
      d.mesh.position.set(x, POND.level + bob - sink, z);
      d.mesh.scale.setScalar(scale);
      // Up-ended, tail to the sky, when she dabbles; the others glance about.
      const pitch = d.kind === 'hen' ? this.tip * 1.25 : Math.sin(this.clock * 0.9 + d.phase) * 0.05;
      d.mesh.rotation.set(pitch, d.heading + Math.sin(this.clock * 0.7 + d.phase) * 0.12, Math.sin(this.clock * 1.7 + d.phase) * 0.04, 'YXZ');

      const w = this.wakes[i];
      const sp = Math.min(moved, 0.4) * (d.mesh.visible ? d.shown : 0) * scale;
      w.set(x, z, Math.sin(d.heading) * sp, Math.cos(d.heading) * sp);
    }

    this.updateRobin(dt, ice, perches);
  }

  /** A point `back` metres along the hen's wake. */
  private trailAt(back: number): Vector3 {
    let left = back;
    for (let i = 1; i < this.trail.length; i++) {
      const step = this.trail[i - 1].distanceTo(this.trail[i]);
      if (step >= left) return this.trail[i - 1].clone().lerp(this.trail[i], step > 0 ? left / step : 0);
      left -= step;
    }
    return (this.trail[this.trail.length - 1] ?? this.path.getPointAt(this.along)).clone();
  }

  /**
   * The robin: in winter only, hopping between the tops of the stones — a
   * short arc, a pause, a turn of the head — and gone again when it thaws.
   */
  private updateRobin(dt: number, ice: number, perches: Vector3[]): void {
    this.robinShown = ease(this.robinShown, ice > 0.6 ? 1 : 0, 1.5, dt);
    this.robin.visible = this.robinShown > 0.02 && perches.length > 1;
    if (!this.robin.visible) return;
    this.robinWait -= dt;
    let from = perches[this.robinSpot % perches.length];
    if (this.robinWait <= 0 && this.robinHop === 0) {
      this.robinHop = 0.0001;
    }
    let pos = from.clone();
    let facing = this.robin.rotation.y;
    if (this.robinHop > 0) {
      const to = perches[(this.robinSpot + 1) % perches.length];
      // A hop to a near stone, a short flight to a far one.
      const gap = from.distanceTo(to);
      this.robinHop = Math.min(1, this.robinHop + dt / (0.35 + gap * 0.22));
      const t = this.robinHop;
      pos = from.clone().lerp(to, t);
      pos.y += Math.sin(t * Math.PI) * (0.15 + gap * 0.12);
      facing = Math.atan2(to.x - from.x, to.z - from.z);
      if (t >= 1) {
        this.robinSpot = (this.robinSpot + 1) % perches.length;
        this.robinHop = 0;
        this.robinWait = 2.5 + this.rng() * 4;
        from = to;
      }
    } else {
      facing += Math.sin(this.clock * 3 + Math.floor(this.clock * 0.8) * 1.7) * 0.02;
    }
    this.robin.position.copy(pos);
    this.robin.rotation.y = facing;
    // A little larger than life, like the doves, so it reads from where the camera usually is.
    this.robin.scale.setScalar(this.robinShown * 1.5);
  }

  dispose(): void {
    for (const d of this.ducks) d.mesh.geometry.dispose();
    this.robin.geometry.dispose();
    this.material.dispose();
  }
}
