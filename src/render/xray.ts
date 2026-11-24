/**
 * The L-system view: the tree with everything but its structure taken away.
 *
 * What is left is the turtle's own drawing: each `F` a tube from where the
 * turtle was to where it went, as thick as the pipe model says (thinned, so
 * it lies inside the wood and the finest twigs still read), a bead at every
 * fork, a dot at every tip, a larger one at the root.
 *
 * It is drawn where the garden's wood is, not beside it: the same skeleton,
 * grown as far as the garden's tree is grown and bending in the same wind,
 * so the view can come in over the garden as a scan, bark and leaves giving
 * way to the bones under them in place. Once the garden has gone, the wind
 * lets go of it and it grows the rest of the way, and then holds still to be
 * read.
 *
 * Stepping through the derivation turns one step's tree into the next: each
 * node of the new tree starts where the module it descends from was, so an
 * apex sprouts its branches and an `F` that became two stretches into them.
 * A branch can be picked, or a production pointed at: what it names is lit
 * while the rest recedes.
 *
 * Colour is one of three readings of the same drawing: how many brackets
 * deep each segment was drawn, how many rewrites ago its wood first
 * appeared, or which production put it there. Two themes, paper by day and
 * ink by night, eased between.
 */
import {
  BufferAttribute,
  CircleGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  Ray,
  Vector3,
} from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
// `three/webgpu` re-exports the concrete node classes but not the base `Node`.
import type Node from 'three/src/nodes/core/Node.js';
import {
  abs,
  attribute,
  cameraViewMatrix,
  clamp,
  dot,
  float,
  int,
  max,
  mix,
  normalize,
  positionGeometry,
  positionView,
  pow,
  screenCoordinate,
  screenUV,
  smoothstep,
  uniform,
  uniformArray,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { SkeletonData } from '../engine';
import { rotateAboutAxis, type TreeUniforms } from '../engine/materials/shared';
import { pack, PEND_UNIT } from '../engine/sway';
import { VEIL_EDGE } from './post';

/**
 * What the view borrows: the garden's wind and the shape of its growth, and
 * the scan's front, which the picture's grade follows too (see `post.ts`).
 */
export type XrayHost = Pick<TreeUniforms, 'windPhase' | 'wind' | 'windDir' | 'windBend' | 'growthWindow'> & {
  front: FloatUniform;
};

const floatUniform = (v: number) => uniform(v);
type FloatUniform = ReturnType<typeof floatUniform>;

/** What colour says: bracket depth, age in rewrites, or the production that made it. */
export type Lens = 'depth' | 'age' | 'rule';

/** The colours of a theme. */
interface Theme {
  /** By depth, trunk to tips. */
  ramp: [number, number, number, number];
  /** By age, the oldest wood to the newest. */
  ages: [number, number, number, number];
  /** By production: the axiom's, then one each, round again after eight. */
  rules: number[];
  tip: number;
  lit: number;
  hover: number;
  top: number;
  bottom: number;
  shadow: number;
  /** The scan's line. */
  scan: number;
}

const DAY: Theme = {
  // Ink: bark brown at the trunk, through olive, to a soft sage at the tips.
  ramp: [0x5e4b36, 0x5f6236, 0x6e7d48, 0x8c9a68],
  // Heartwood to this year's shoots: umber, walnut, ochre, new green.
  ages: [0x45342a, 0x8a5a3a, 0xb88d45, 0x88a650],
  rules: [0x6b5b4a, 0xbc5b3b, 0x5d873c, 0x3c6f95, 0x92568c, 0xb98b28, 0x2e877a, 0xa1475c],
  tip: 0xd8cca4,
  lit: 0xe2702f,
  hover: 0xd09a52,
  top: 0xfaf6ee,
  bottom: 0xeee5d3,
  shadow: 0x9c8a66,
  scan: 0x9d88d8,
};

const NIGHT: Theme = {
  // Candle gold at the trunk, through sea-glass, to lavender at the tips.
  ramp: [0xe8c98a, 0x8fbcc4, 0x7fb59a, 0xb7a2e0],
  ages: [0xf0c07a, 0xe2988a, 0xa3a7ee, 0x8ee2c4],
  rules: [0xe7dabd, 0xf29f7f, 0xb5dc8a, 0x8ec5ef, 0xd5a5ea, 0xf1d17a, 0x84dbca, 0xf19eae],
  tip: 0xd9c9f2,
  lit: 0xf6b354,
  hover: 0xd7a868,
  top: 0x1c2336,
  bottom: 0x0c1019,
  shadow: 0x000000,
  scan: 0xc9b8ff,
};

const hex = (h: number) => `#${h.toString(16).padStart(6, '0')}`;

/** A lens's colours as CSS, for a legend beside the drawing: the ramp's four, or one per production. */
export function lensColours(lens: Lens, night: boolean): string[] {
  const t = night ? NIGHT : DAY;
  return (lens === 'depth' ? t.ramp : lens === 'age' ? t.ages : t.rules).map(hex);
}

/** A production's colour, by its index (-1 for the axiom). */
export function ruleColour(rule: number, night: boolean): string {
  const rules = (night ? NIGHT : DAY).rules;
  return hex(rules[(((rule + 1) % rules.length) + rules.length) % rules.length]);
}

const colour = (hex: number) => uniform(new Color(hex));
type ColourUniform = ReturnType<typeof colour>;
interface Pair {
  day: ColourUniform;
  night: ColourUniform;
}
const pair = (day: number, night: number): Pair => ({ day: colour(day), night: colour(night) });
const palette = (hexes: number[]) => uniformArray(hexes.map((h) => new Color(h)), 'color');

/** Uniforms shared by everything the view draws. */
function themeUniforms(front: XrayHost['front']) {
  return {
    night: uniform(0),
    /** How far something picked has drawn attention to itself, 0–1. */
    focus: uniform(0),
    /**
     * How far from the eye the tree's middle is, and how deep it is: what
     * is behind the middle is drawn fainter, toward the page, as an
     * illustrator lets the far side of a crown fall back.
     */
    cueMiddle: uniform(10),
    cueDepth: uniform(3),
    /** How much each reading of colour is showing; they sum to one, and ease. */
    byDepth: uniform(1),
    byAge: uniform(0),
    byRule: uniform(0),
    ramp: DAY.ramp.map((h, i) => pair(h, NIGHT.ramp[i])),
    ages: DAY.ages.map((h, i) => pair(h, NIGHT.ages[i])),
    rules: { day: palette(DAY.rules), night: palette(NIGHT.rules) },
    tip: pair(DAY.tip, NIGHT.tip),
    lit: pair(DAY.lit, NIGHT.lit),
    hover: pair(DAY.hover, NIGHT.hover),
    top: pair(DAY.top, NIGHT.top),
    bottom: pair(DAY.bottom, NIGHT.bottom),
    shadow: pair(DAY.shadow, NIGHT.shadow),
    scan: pair(DAY.scan, NIGHT.scan),
    /**
     * The scan's front, as a fraction of the screen's height from the
     * bottom: below it the view, above it the garden. Past the top, all
     * view; below the bottom, none.
     */
    front,
    /** The view's own growth, as the garden's tree counts it: 0 seed, 1 grown. */
    growth: uniform(1),
    /** How much the drawing bends with the garden's wind, 0–1. */
    sway: uniform(0),
  };
}
type ThemeUniforms = ReturnType<typeof themeUniforms>;

/** One of the theme's colours, as it stands between day and night. */
const pick = (u: ThemeUniforms, p: Pair) => mix(p.day, p.night, u.night);

/** Four colours along a 0–1 value. */
function ramp4(u: ThemeUniforms, stops: Pair[], t: Node<'float'>) {
  const r = stops.map((s) => pick(u, s));
  let col = mix(r[0], r[1], clamp(t.mul(3), 0, 1));
  col = mix(col, r[2], clamp(t.mul(3).sub(1), 0, 1));
  return mix(col, r[3], clamp(t.mul(3).sub(2), 0, 1));
}

/** How far up the screen a pixel is, 0 at the bottom. */
const screenHeight = () => screenUV.y.oneMinus();

/** 1 where the scan has passed, 0 where it has not, with a short soft edge. */
const scanned = (u: ThemeUniforms) => smoothstep(0, 0.05, u.front.sub(screenHeight()));

/** Smooth in and out. */
const ease = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** Tubes this many sides round: enough to read as round, little enough to be ten thousand of. */
const SIDES = 7;

/**
 * The one tube every segment is an instance of: a ring at each end, as a
 * strip of quads. Each vertex is (cos, sin, end); the shader turns the ring
 * to face along its segment and sizes it.
 */
function ringTemplate(): { position: Float32Array; index: Uint16Array } {
  const position = new Float32Array(SIDES * 2 * 3);
  for (let end = 0; end < 2; end++) {
    for (let k = 0; k < SIDES; k++) {
      const a = (k / SIDES) * Math.PI * 2;
      const v = end * SIDES + k;
      position[v * 3] = Math.cos(a);
      position[v * 3 + 1] = Math.sin(a);
      position[v * 3 + 2] = end;
    }
  }
  const index = new Uint16Array(SIDES * 6);
  for (let k = 0, t = 0; k < SIDES; k++) {
    const k2 = (k + 1) % SIDES;
    index[t++] = k;
    index[t++] = SIDES + k;
    index[t++] = k2;
    index[t++] = k2;
    index[t++] = SIDES + k;
    index[t++] = SIDES + k2;
  }
  return { position, index };
}
const RING = ringTemplate();

/** The one bead every fork, tip and root is an instance of: a unit sphere, shared corners and all (its position is its normal). */
const SPHERE = (() => {
  const g = new IcosahedronGeometry(1, 1);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const m = mergeVertices(g);
  return { position: m.attributes.position.array as Float32Array, index: (m.index!.array as Uint16Array | Uint32Array) };
})();

/** An instanced mesh's geometry: its own copy of the template (shared buffers are released with any one of their geometries), and room for `count` instances. */
function instanced(template: { position: Float32Array; index: Uint16Array | Uint32Array }, count: number, attributes: Record<string, Float32Array>): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(template.position.slice(), 3));
  g.setIndex(new BufferAttribute(template.index.slice(), 1));
  for (const [name, array] of Object.entries(attributes)) g.setAttribute(name, new InstancedBufferAttribute(array, 4));
  g.instanceCount = count;
  return g;
}

type V3 = Node<'vec3'>;
type F1 = Node<'float'>;

/** How far a point born at `birth` has grown, as the garden's tree counts it (see `growthPosition`). */
function extendAt(u: ThemeUniforms, host: XrayHost, birth: F1): F1 {
  const win = host.growthWindow;
  return smoothstep(0, 1, u.growth.mul(float(1).add(win)).sub(birth).div(win).clamp(0, 1));
}

/** A point bent by the garden's wind as its wood is, while the drawing stands in for it (see `growthPosition`). */
function swayed(u: ThemeUniforms, host: XrayHost, placed: V3, centre: V3, packed: F1, extend: F1): V3 {
  const pairs = packed.mul(0.5).floor();
  const flex = packed.sub(pairs.mul(2));
  const pend = pairs.mul(PEND_UNIT);
  const t = host.windPhase;
  const windDir = vec3(host.windDir.x, 0, host.windDir.y).normalize();
  const travel = placed.x.mul(windDir.x).add(placed.z.mul(windDir.z)).mul(0.2);
  const gust = t
    .sub(travel)
    .sin()
    .mul(0.5)
    .add(t.mul(1.63).sub(travel.mul(1.7)).add(1.3).sin().mul(0.3))
    .add(t.mul(0.37).sub(travel.mul(0.5)).sin().mul(0.2));
  const bend = gust.mul(0.62).add(0.38).mul(host.wind).mul(flex).mul(extend).mul(host.windBend).mul(u.sway);
  const bendAxis = vec3(0, 1, 0).cross(windDir).normalize();
  const across = vec3(windDir.z.negate(), 0, windDir.x);
  const beat = t.mul(0.83).add(centre.x.mul(1.7)).add(centre.z.mul(2.3)).sin();
  const hang = windDir
    .mul(bend.mul(pend).mul(1.6))
    .add(across.mul(beat.mul(pend).mul(host.wind).mul(host.windBend).mul(extend).mul(0.12).mul(u.sway)));
  return rotateAboutAxis(placed, bendAxis, bend).add(hang);
}

/**
 * The bones' look: flat, lit by one soft light from above and a little in
 * front, with a brighter rim (the glassy edge the night theme glows at). A
 * diagram, not a material; but placed, grown and bent exactly as the
 * garden's wood is, so it can stand in its place.
 *
 * Instanced: a segment, or a bead, is one instance, carrying where it is,
 * where it came from (for a morph), where it grows from, when, how it
 * sways, and what it is (depth, age, production, mark) in a few vec4s.
 * A tree of six thousand segments is a megabyte, not the sixty its beads
 * alone took as plain geometry, and a new step builds and uploads at once.
 */
function boneMaterial(u: ThemeUniforms, host: XrayHost, d: { morph: FloatUniform; fade: FloatUniform; hair: FloatUniform }, beads: boolean): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  const v4 = (name: string) => attribute<'vec4'>(name, 'vec4');
  const kind = v4('iKind'); // age (0–1), production slot, mark, —
  const mark = kind.z;
  // What is lit is thickened by a few hairs, so a picked twig reads as surely
  // as a limb, and a limb (already plain to see) hardly changes; what is
  // under the pointer, by one.
  const thicker = (w: F1) => mark.greaterThan(0.75).select(w.mul(1.1).add(d.hair.mul(1.7)), mark.greaterThan(0.25).select(w.mul(1.05).add(d.hair.mul(0.8)), w));
  const fillOf = (extend: F1) => extend.mul(float(0.34).add(u.growth.mul(0.66)));

  let normal: V3;
  let depth: F1;
  let tip: F1 = float(0);
  if (!beads) {
    const a = v4('iA'); // foot: centre, width
    const b = v4('iB'); // tip
    const fa = v4('iFA'); // where the foot came from (a morph), and its width then
    const fb = v4('iFB');
    const o = v4('iO'); // where the foot grows out of, and when it is born
    const more = v4('iM'); // tip's birth, foot's and tip's sway, depth
    const ring = attribute<'vec3'>('position', 'vec3');
    const end = ring.z;
    const ca = mix(fa.xyz, a.xyz, d.morph);
    const cb = mix(fb.xyz, b.xyz, d.morph);
    const extA = extendAt(u, host, o.w);
    const extB = extendAt(u, host, more.x);
    const ga = mix(o.xyz, ca, extA);
    const gb = mix(ca, cb, extB);
    // The ring turned to face along the segment as it now lies.
    const seg = cb.sub(ca);
    const dir = seg.length().greaterThan(1e-6).select(seg.normalize(), vec3(0, 1, 0));
    const s0 = vec3(0, 1, 0).cross(dir);
    const side = s0.length().greaterThan(1e-4).select(s0.normalize(), vec3(1, 0, 0).cross(dir).normalize());
    const up = dir.cross(side);
    const out = side.mul(ring.x).add(up.mul(ring.y));
    const atTip = end.greaterThan(0.5);
    const centre = atTip.select(gb, ga);
    const rest = atTip.select(cb, ca);
    const w = mix(mix(fa.w, a.w, d.morph), mix(fb.w, b.w, d.morph), end);
    const extend = atTip.select(extB, extA);
    const placed = centre.add(out.mul(thicker(w).mul(fillOf(extend))));
    m.positionNode = swayed(u, host, placed, rest, atTip.select(more.z, more.y), extend);
    normal = varying(out, 'vBoneNormal');
    depth = more.w;
  } else {
    const a = v4('iA'); // centre, size
    const fa = v4('iFA');
    const o = v4('iO');
    const more = v4('iM'); // sway, tip, depth, —
    const unit = attribute<'vec3'>('position', 'vec3');
    const c = mix(fa.xyz, a.xyz, d.morph);
    const w = mix(fa.w, a.w, d.morph);
    const extend = extendAt(u, host, o.w);
    const grown = mix(o.xyz, c, extend);
    const placed = grown.add(unit.mul(thicker(w).mul(fillOf(extend))));
    m.positionNode = swayed(u, host, placed, c, more.x, extend);
    normal = varying(unit, 'vBoneNormal');
    depth = more.z;
    tip = more.y;
  }

  // Colour: one of three readings, eased between.
  const byDepth = ramp4(u, u.ramp, depth);
  const byAge = ramp4(u, u.ages, kind.x);
  const slot = int(kind.y);
  const element = (a: typeof u.rules.day) => a.element(slot) as unknown as Node<'vec3'>;
  const byRule = mix(element(u.rules.day), element(u.rules.night), u.night);
  let col = byDepth.mul(u.byDepth).add(byAge.mul(u.byAge)).add(byRule.mul(u.byRule));
  // A tip is paler, as a bud is; not when colour is naming productions, where it would be a lie.
  if (beads) col = mix(col, pick(u, u.tip), tip.mul(0.55).mul(float(1).sub(u.byRule)));

  const n = normal.normalize();
  const light = normalize(vec3(0.35, 0.85, 0.45));
  const lambert = max(dot(n, light), 0);
  const nView = cameraViewMatrix.mul(vec4(n, 0)).xyz.normalize();
  const rim = pow(float(1).sub(abs(nView.z)), 2.2);
  const shade = mix(float(0.62), float(0.5), u.night).add(lambert.mul(mix(float(0.42), float(0.36), u.night)));
  const lit = mark.greaterThan(0.75);
  const hovered = mark.greaterThan(0.25).and(lit.not());
  // By day the edges are inked, darker, as a drawing's are; by night they glow.
  const inked = col.mul(shade).mul(float(1).sub(rim.mul(0.35)));
  const glowing = col.mul(shade).add(rim.mul(0.32).mul(col.add(0.2)));
  let base = mix(inked, glowing, u.night);
  const page = mix(pick(u, u.bottom), pick(u, u.top), 0.5);
  // The far side of the crown falls back toward the page, the near side
  // stays inked: the crown reads as a volume, not a flat mass of twigs.
  const behind = positionView.z.negate().sub(u.cueMiddle).div(u.cueDepth);
  base = mix(base, page, smoothstep(0.05, 1.15, behind).mul(mix(float(0.36), float(0.42), u.night)));
  // What is not picked recedes toward the page while something is.
  base = mix(base, page, u.focus.mul(mix(float(0.3), float(0.46), u.night)).mul(lit.not().select(float(1), float(0))));
  let glow = pick(u, u.lit).mul(float(0.85).add(lambert.mul(0.3))).add(rim.mul(0.35));
  // A lit tip is the lit colour's paler self, so a lit branch has its own buds.
  if (beads) glow = mix(glow, glow.add(0.35).min(1), tip.mul(0.6));
  const warm = mix(col.mul(shade), pick(u, u.hover), 0.7);
  m.colorNode = lit.select(glow, hovered.select(warm, base));
  // Only where the scan has passed: above it the garden is still there.
  m.opacityNode = d.fade.mul(scanned(u));
  m.alphaTest = 0.01;
  m.transparent = true;
  m.depthWrite = true;
  // A diagram has no air between it and you: the garden's haze is not for it.
  m.fog = false;
  return m;
}

/**
 * A drawing's two materials, with the uniforms only that drawing moves.
 * Kept, and lent to the next drawing when this one is done with them: a
 * material is a shader to build, and a step of the derivation should cost
 * none (see `XrayView.lend`).
 */
class Slot {
  /** 0 where it came from, 1 where it is: eased. */
  readonly morph = floatUniform(1);
  readonly fade = floatUniform(1);
  /** The finest width drawn, in world units: what a lit twig is thickened by. */
  readonly hair = floatUniform(0.01);
  readonly tubes: MeshBasicNodeMaterial;
  readonly beads: MeshBasicNodeMaterial;
  busy = false;

  constructor(u: ThemeUniforms, host: XrayHost) {
    this.tubes = boneMaterial(u, host, this, false);
    this.beads = boneMaterial(u, host, this, true);
  }

  dispose(): void {
    this.tubes.dispose();
    this.beads.dispose();
  }
}

/** A tube's instance data: foot, tip, where each came from, where the foot grows out of, the rest, and what it is. */
interface TubeData {
  iA: Float32Array;
  iB: Float32Array;
  iFA: Float32Array;
  iFB: Float32Array;
  iO: Float32Array;
  iM: Float32Array;
  iK: Float32Array;
}
interface BeadData {
  iA: Float32Array;
  iFA: Float32Array;
  iO: Float32Array;
  iM: Float32Array;
  iK: Float32Array;
}

/** A drawing of one skeleton: its tubes and its beads. */
class Drawing {
  readonly group = new Group();
  readonly morph: FloatUniform;
  readonly fade: FloatUniform;
  /** The morph's progress, uneased, and which way it is going (0: still). */
  morphT = 1;
  morphDir: 1 | -1 | 0 = 0;
  morphSeconds = 0.6;
  private readonly tubes: Mesh;
  private readonly beads: Mesh;
  private readonly tube: TubeData;
  private readonly bead: BeadData;
  /** Each tube's two nodes, and each bead's node. */
  private readonly segFoot: Int32Array;
  private readonly segTip: Int32Array;
  private readonly beadNode: Int32Array;
  private readonly hairWidth: number;
  private readonly minWidth: number;

  constructor(
    readonly data: SkeletonData,
    readonly arc: Float32Array,
    readonly children: Uint16Array,
    readonly width: Float32Array,
    private readonly slot: Slot,
    hair: number,
  ) {
    const { count, pos, parent, order, age, rule, flex, pend } = data;
    slot.busy = true;
    this.morph = slot.morph;
    this.fade = slot.fade;
    this.morph.value = 1;
    this.fade.value = 1;
    slot.hair.value = hair;
    this.hairWidth = hair;
    let maxOrder = 1;
    let maxArc = 1e-3;
    let maxAge = 1;
    let minWidth = Infinity;
    for (let i = 0; i < count; i++) {
      if (order[i] > maxOrder) maxOrder = order[i];
      if (arc[i] > maxArc) maxArc = arc[i];
      if (age[i] > maxAge) maxAge = age[i];
      if (width[i] < minWidth) minWidth = width[i];
    }
    this.minWidth = Number.isFinite(minWidth) ? minWidth : 0.01;
    const slots = DAY.rules.length;
    const put = (to: Float32Array, at: number, x: number, y: number, z: number, w: number) => {
      to[at * 4] = x;
      to[at * 4 + 1] = y;
      to[at * 4 + 2] = z;
      to[at * 4 + 3] = w;
    };
    const P = (i: number, c: number) => pos[i * 3 + c];

    // ---- tubes: one instance per segment.
    let segs = 0;
    for (let i = 1; i < count; i++) if (parent[i] >= 0) segs++;
    const T: TubeData = { iA: new Float32Array(segs * 4), iB: new Float32Array(segs * 4), iFA: new Float32Array(segs * 4), iFB: new Float32Array(segs * 4), iO: new Float32Array(segs * 4), iM: new Float32Array(segs * 4), iK: new Float32Array(segs * 4) };
    this.segFoot = new Int32Array(segs);
    this.segTip = new Int32Array(segs);
    for (let i = 1, s = 0; i < count; i++) {
      const p = parent[i];
      if (p < 0) continue;
      const o = parent[p] >= 0 ? parent[p] : p;
      this.segFoot[s] = p;
      this.segTip[s] = i;
      put(T.iA, s, P(p, 0), P(p, 1), P(p, 2), width[p]);
      put(T.iB, s, P(i, 0), P(i, 1), P(i, 2), width[i]);
      put(T.iFA, s, P(p, 0), P(p, 1), P(p, 2), width[p]);
      put(T.iFB, s, P(i, 0), P(i, 1), P(i, 2), width[i]);
      put(T.iO, s, P(o, 0), P(o, 1), P(o, 2), Math.min(1, arc[p] / maxArc));
      put(T.iM, s, Math.min(1, arc[i] / maxArc), pack(flex[p] ?? 0, pend[p] ?? 0), pack(flex[i] ?? 0, pend[i] ?? 0), order[i] / maxOrder);
      put(T.iK, s, age[i] / maxAge, (rule[i] + 1) % slots, 0, 0);
      s++;
    }
    this.tube = T;
    this.tubes = new Mesh(instanced(RING, segs, { ...T }), slot.tubes);
    this.tubes.frustumCulled = false;
    this.tubes.renderOrder = ORDER.bones;

    // ---- beads: at the root, at every fork, at every tip.
    let beads = 0;
    for (let i = 0; i < count; i++) if (i === 0 || children[i] !== 1) beads++;
    const B: BeadData = { iA: new Float32Array(beads * 4), iFA: new Float32Array(beads * 4), iO: new Float32Array(beads * 4), iM: new Float32Array(beads * 4), iK: new Float32Array(beads * 4) };
    this.beadNode = new Int32Array(beads);
    for (let i = 0, b = 0; i < count; i++) {
      if (!(i === 0 || children[i] !== 1)) continue;
      const tip = children[i] === 0 && i !== 0;
      const r = this.beadSize(i, width[i]);
      const o = parent[i] >= 0 ? parent[i] : i;
      this.beadNode[b] = i;
      put(B.iA, b, P(i, 0), P(i, 1), P(i, 2), r);
      put(B.iFA, b, P(i, 0), P(i, 1), P(i, 2), r);
      // A bead appears a moment after the segment reaching it.
      put(B.iO, b, P(o, 0), P(o, 1), P(o, 2), Math.min(1, arc[i] / maxArc + 0.02));
      put(B.iM, b, pack(flex[i] ?? 0, pend[i] ?? 0), tip ? 1 : 0, order[i] / maxOrder, 0);
      put(B.iK, b, age[i] / maxAge, (rule[i] + 1) % slots, 0, 0);
      b++;
    }
    this.bead = B;
    this.beads = new Mesh(instanced(SPHERE, beads, { ...B }), slot.beads);
    this.beads.frustumCulled = false;
    this.beads.renderOrder = ORDER.bones + 1;

    this.group.add(this.tubes, this.beads);
  }

  /** A tip is a small dot, a fork a bead a little proud of its branch, the root larger still. */
  private beadSize(i: number, w: number): number {
    const kids = this.children[i];
    if (i === 0) return w * 1.2;
    if (kids === 0) return Math.max(w * 2.3, this.minWidth * 2.9);
    return w * (kids > 1 ? 1.4 : 1.15);
  }

  /** The width a node's radius is drawn at. */
  widthOf(r: number): number {
    return Math.max(this.hairWidth, r * 0.34);
  }

  /**
   * Where each node starts from (positions and radii, one per node), or null
   * for its own place: what a morph runs from.
   */
  setFrom(pos: Float32Array | null, radius: Float32Array | null): void {
    const src = pos ?? this.data.pos;
    const widthAt = (i: number) => (radius ? this.widthOf(radius[i]) : this.width[i]);
    const put = (to: Float32Array, at: number, i: number, w: number) => {
      to[at * 4] = src[i * 3];
      to[at * 4 + 1] = src[i * 3 + 1];
      to[at * 4 + 2] = src[i * 3 + 2];
      to[at * 4 + 3] = w;
    };
    for (let s = 0; s < this.segFoot.length; s++) {
      put(this.tube.iFA, s, this.segFoot[s], widthAt(this.segFoot[s]));
      put(this.tube.iFB, s, this.segTip[s], widthAt(this.segTip[s]));
    }
    for (let b = 0; b < this.beadNode.length; b++) {
      const i = this.beadNode[b];
      put(this.bead.iFA, b, i, this.beadSize(i, widthAt(i)));
    }
    this.touch(this.tubes, 'iFA', 'iFB');
    this.touch(this.beads, 'iFA');
  }

  private touch(mesh: Mesh, ...names: string[]): void {
    for (const name of names) (mesh.geometry.getAttribute(name) as InstancedBufferAttribute).needsUpdate = true;
  }

  /** Run toward its own place (1) or back to where it came from (-1). */
  run(dir: 1 | -1, seconds: number): void {
    this.morphDir = dir;
    this.morphSeconds = Math.max(0.05, seconds);
    if (dir > 0 && this.morphT >= 1) this.morphT = 0;
  }

  /** One frame of the morph; true while it is still running. */
  tick(dt: number): boolean {
    if (this.morphDir === 0) return false;
    this.morphT = Math.min(1, Math.max(0, this.morphT + (this.morphDir * dt) / this.morphSeconds));
    this.morph.value = ease(this.morphT);
    const done = this.morphDir > 0 ? this.morphT >= 1 : this.morphT <= 0;
    if (done) this.morphDir = 0;
    return !done;
  }

  /** Mark nodes: 1 lit, 0.5 hovered, 0 neither. A segment takes its tip node's mark. */
  mark(marks: Float32Array): void {
    for (let s = 0; s < this.segTip.length; s++) this.tube.iK[s * 4 + 2] = marks[this.segTip[s]];
    for (let b = 0; b < this.beadNode.length; b++) this.bead.iK[b * 4 + 2] = marks[this.beadNode[b]];
    this.touch(this.tubes, 'iK');
    this.touch(this.beads, 'iK');
  }

  /** Let go of its geometry, and give its materials back to be lent again. */
  dispose(): void {
    this.tubes.geometry.dispose();
    this.beads.geometry.dispose();
    this.slot.busy = false;
  }
}

/**
 * Drawn after everything of the garden, in this order: the veil the scan
 * lays over it, the ground's shadow, then the bones.
 */
const ORDER = { veil: 1_000_000, shadow: 1_000_001, bones: 1_000_002 };

const _ray = new Ray();
const _a = new Vector3();
const _b = new Vector3();
const _p = new Vector3();
const _q = new Vector3();

/** A value carried to a target over a while. */
class Glide {
  private from = 0;
  private to = 0;
  private t = 1;
  private seconds = 1;
  constructor(public value: number) {
    this.to = value;
  }
  set(to: number, seconds = 0): void {
    if (seconds <= 0) {
      this.value = this.to = to;
      this.t = 1;
      return;
    }
    this.from = this.value;
    this.to = to;
    this.t = 0;
    this.seconds = seconds;
  }
  tick(dt: number): number {
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.seconds);
      this.value = this.from + (this.to - this.from) * ease(this.t);
    }
    return this.value;
  }
}

export class XrayView {
  readonly group = new Group();
  readonly uniforms: ThemeUniforms;
  /** The page behind the tree: paper by day, ink by night, a touch lighter toward the top. */
  readonly pageNode;
  private readonly slots: Slot[] = [];
  private warm: Drawing[] = [];
  private current: Drawing | null = null;
  /** Fading out, after a tree that is not one step of this one replaced it. */
  private leaving: Drawing[] = [];
  /** Running back into the step it is going to, which waits, hidden, to take over. */
  private collapsing: { old: Drawing; next: Drawing } | null = null;
  private readonly shadow: Mesh;
  private readonly veil: Mesh;
  private nightTarget = 0;
  private focusTarget = 0;
  private lensTarget: Lens = 'depth';
  /** The picked branch (its nodes), the one under the pointer, and nodes shown for a moment in their place. */
  private lit: Set<number> = new Set();
  private hovered: Set<number> = new Set();
  private shown: Set<number> | null = null;
  private selectedNode = -1;
  private hoverNode = -1;
  private readonly growth = new Glide(1);
  private readonly sway = new Glide(0);
  private scanning: { into: boolean; t: number; seconds: number; done: () => void } | null = null;

  constructor(private readonly host: XrayHost) {
    const u = (this.uniforms = themeUniforms(host.front));
    // Paper has a tooth: a fine, still grain in its surface (by night, on
    // the dark page, all but gone, since it scales with the light).
    const grain = screenCoordinate.xy.dot(vec2(12.9898, 78.233)).sin().mul(43758.5453).fract().sub(0.5);
    const page = mix(pick(u, u.bottom), pick(u, u.top), smoothstep(0.05, 1, screenHeight())).mul(float(1).add(grain.mul(0.028)));
    this.pageNode = page;

    // A soft shadow on the ground: where the tree stands.
    const shadowMat = new MeshBasicNodeMaterial();
    const d = uv().sub(0.5).length().mul(2);
    shadowMat.colorNode = pick(u, u.shadow);
    shadowMat.opacityNode = pow(float(1).sub(smoothstep(0, 1, d)), 2).mul(mix(float(0.32), float(0.55), u.night)).mul(scanned(u));
    shadowMat.transparent = true;
    shadowMat.depthWrite = false;
    shadowMat.fog = false;
    this.shadow = new Mesh(new CircleGeometry(1, 64), shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.002;
    this.shadow.renderOrder = ORDER.shadow;

    // The page, laid over the garden from the scan's front down, with a fine
    // line of light at the front; it also clears the depth there, so the
    // bones are drawn over the wood they stand in for rather than inside it.
    // Once the scan has passed it is simply the page, and it stays up for as
    // long as the view is on screen: the garden is put back under it before
    // a scan uncovers it, never in front of it.
    const veilMat = new MeshBasicNodeMaterial();
    veilMat.vertexNode = vec4(positionGeometry.x, positionGeometry.y, 0.99999, 1);
    const behind = u.front.sub(screenHeight());
    const cover = smoothstep(0, VEIL_EDGE, behind);
    // A hairline, and a faint glow either side of it.
    const core = behind.div(0.0016).pow(2).negate().exp();
    const halo = behind.div(0.018).pow(2).negate().exp().mul(0.22);
    const line = max(core, halo);
    veilMat.colorNode = mix(page, pick(u, u.scan), core.mul(0.85).add(halo.mul(2)).min(1));
    veilMat.opacityNode = max(cover, line.mul(0.85));
    veilMat.alphaTest = 0.002;
    veilMat.transparent = true;
    veilMat.depthTest = false;
    veilMat.depthWrite = true;
    veilMat.fog = false;
    this.veil = new Mesh(new PlaneGeometry(2, 2), veilMat);
    this.veil.frustumCulled = false;
    this.veil.renderOrder = ORDER.veil;
    this.group.add(this.veil, this.shadow);
  }

  /** Where the tree's middle is from the eye, and its depth (its radius), for drawing the far side fainter. */
  setDepthCue(middle: number, depth: number): void {
    this.uniforms.cueMiddle.value = middle;
    this.uniforms.cueDepth.value = Math.max(0.5, depth);
  }

  /** Day (0) or night (1); eased. */
  setNight(n: number): void {
    this.nightTarget = n;
  }

  /** Jump straight to the theme, without easing. */
  settleTheme(): void {
    this.uniforms.night.value = this.nightTarget;
  }

  /** What colour says. */
  setLens(lens: Lens): void {
    this.lensTarget = lens;
  }

  /**
   * Show a tree. One step of the derivation from the one on show turns into
   * it: forward, the new tree grows out of the old one's nodes; back, the
   * old one draws in onto the new one's. Anything else (another tree
   * altogether) fades across. `seconds` 0 shows it at once.
   */
  setSkeleton(data: SkeletonData, seconds = 0.6, footprint?: { radius: number }): void {
    const { count, pos, parent, radius } = data;
    // A morph still running back is finished at once: its successor takes over.
    this.finishCollapse();
    const arc = new Float32Array(count);
    const children = new Uint16Array(count);
    for (let i = 1; i < count; i++) {
      const p = parent[i];
      if (p < 0) continue;
      children[p]++;
      arc[i] = arc[p] + Math.hypot(pos[i * 3] - pos[p * 3], pos[i * 3 + 1] - pos[p * 3 + 1], pos[i * 3 + 2] - pos[p * 3 + 2]);
    }
    // Thinner than the wood, so the structure reads and stays inside it, and
    // never thinner than a hair at the scale of the tree, so the finest twig is still there.
    const hair = Math.max(0.005, (data.height || 1) * 0.0013);
    const width = new Float32Array(count);
    for (let i = 0; i < count; i++) width[i] = Math.max(hair, radius[i] * 0.34);

    const drawing = new Drawing(data, arc, children, width, this.lend(), hair);
    const old = this.current;
    const m = data.morph;
    const related = !!(m && old && old.data.step === m.from);
    if (seconds > 0 && related && m!.grow) {
      drawing.setFrom(m!.pos, m!.radius);
      drawing.morphT = 0;
      drawing.morph.value = 0;
      drawing.run(1, seconds);
      this.drop(old!);
    } else if (seconds > 0 && related && !m!.grow && m!.radius.length === old!.data.count) {
      old!.setFrom(m!.pos, m!.radius);
      old!.morphT = 1;
      old!.run(-1, seconds);
      drawing.group.visible = false;
      this.collapsing = { old: old!, next: drawing };
    } else if (old) {
      if (seconds > 0) {
        this.leaving.push(old);
        drawing.fade.value = 0;
      } else {
        this.drop(old);
      }
    }
    this.current = drawing;
    this.group.add(drawing.group);
    this.lit.clear();
    this.hovered.clear();
    this.shown = null;
    this.selectedNode = -1;
    this.hoverNode = -1;
    this.focusTarget = 0;

    const r = Math.max(footprint?.radius ?? data.radiusXZ, 0.5);
    this.shadow.scale.setScalar(r * 1.05);
  }

  /** A pair of materials no drawing is using, made if there is none. */
  private lend(): Slot {
    let slot = this.slots.find((s) => !s.busy);
    if (!slot) {
      slot = new Slot(this.uniforms, this.host);
      this.slots.push(slot);
    }
    return slot;
  }

  /**
   * Drawings to compile the view's shaders on before it is first wanted: a
   * few tiny trees, in materials that are then lent to real ones. Shown
   * (masked out by the scan) until `endWarmUp`.
   */
  beginWarmUp(): Group {
    const twig: SkeletonData = {
      step: -1,
      count: 3,
      pos: new Float32Array([0, 0, 0, 0, 1, 0, 0.3, 1.6, 0]),
      parent: new Int32Array([-1, 0, 1]),
      radius: new Float32Array([0.1, 0.06, 0.03]),
      order: new Uint8Array([0, 0, 1]),
      module: new Int32Array([-1, 0, 1]),
      age: new Uint8Array([0, 0, 1]),
      rule: new Int16Array([-1, -1, 0]),
      flex: new Float32Array(3),
      pend: new Float32Array(3),
      height: 1.6,
      radiusXZ: 0.3,
    };
    const arc = new Float32Array([0, 1, 1.7]);
    const children = new Uint16Array([1, 1, 0]);
    const width = new Float32Array([0.034, 0.02, 0.01]);
    // As many as are ever on screen at once: the one shown, one going, one more on a quick scrub.
    for (let i = 0; i < 3; i++) {
      const d = new Drawing(twig, arc, children, width, this.lend(), 0.005);
      this.warm.push(d);
      this.group.add(d.group);
    }
    return this.group;
  }

  endWarmUp(): void {
    for (const d of this.warm) this.drop(d);
    this.warm = [];
  }

  private drop(d: Drawing): void {
    this.group.remove(d.group);
    d.dispose();
  }

  private finishCollapse(): void {
    const c = this.collapsing;
    if (!c) return;
    this.collapsing = null;
    this.drop(c.old);
    c.next.group.visible = true;
  }

  get skeleton(): SkeletonData | null {
    return this.current?.data ?? null;
  }

  get selected(): number {
    return this.selectedNode;
  }

  /**
   * The branch a node belongs to: back up to where it left its parent axis
   * (its order drops), then everything grown from there. The trunk's own
   * axis is the trunk alone, not the whole tree.
   */
  branchOf(node: number): Set<number> {
    const d = this.current?.data;
    const out = new Set<number>();
    if (!d || node < 0) return out;
    const { parent, order, count } = d;
    let start = node;
    while (parent[start] >= 0 && order[parent[start]] === order[node] && order[start] === order[node]) start = parent[start];
    if (order[node] === 0) {
      for (let i = 0; i < count; i++) if (order[i] === 0) out.add(i);
      return out;
    }
    out.add(start);
    // Nodes are pushed after their parents, so one pass forward finds every descendant.
    for (let i = start + 1; i < count; i++) if (parent[i] >= 0 && out.has(parent[i])) out.add(i);
    return out;
  }

  /** Light a branch (or nothing, with -1). */
  select(node: number): void {
    this.selectedNode = node;
    this.lit = this.branchOf(node);
    this.applyMarks();
  }

  /** Warm the branch under the pointer (or nothing). */
  hover(node: number): void {
    if (node === this.hoverNode) return;
    this.hoverNode = node;
    this.hovered = node >= 0 && !this.lit.has(node) ? this.branchOf(node) : new Set();
    this.applyMarks();
  }

  /**
   * Light some nodes for a while in place of the picked branch (a
   * production pointed at: everything it drew), or put the pick back with null.
   */
  show(nodes: Set<number> | null): void {
    this.shown = nodes;
    this.applyMarks();
  }

  /** The segments a production drew, by its index (-1: the axiom's). */
  madeBy(rule: number): Set<number> {
    const d = this.current?.data;
    const out = new Set<number>();
    if (!d) return out;
    for (let i = 1; i < d.count; i++) if (d.parent[i] >= 0 && d.rule[i] === rule) out.add(i);
    return out;
  }

  private applyMarks(): void {
    const d = this.current;
    if (!d) return;
    const marks = new Float32Array(d.data.count);
    const lit = this.shown ?? this.lit;
    if (!this.shown) for (const i of this.hovered) marks[i] = 0.5;
    for (const i of lit) marks[i] = 1;
    this.focusTarget = lit.size > 0 ? 1 : 0;
    d.mark(marks);
  }

  /**
   * The segment under the ray, as its end node, or -1. Within `tolerance`
   * world units per unit of distance, the thicker wins: pointing at a limb
   * through a haze of twigs means the limb.
   */
  pick(ray: Ray, tolerance: number): number {
    const cur = this.current;
    const d = cur?.data;
    if (!cur || !d) return -1;
    _ray.copy(ray);
    const { count, pos, parent } = d;
    const width = cur.width;
    let best = -1;
    let bestScore = Infinity;
    for (let i = 1; i < count; i++) {
      const p = parent[i];
      if (p < 0) continue;
      _a.fromArray(pos, p * 3);
      _b.fromArray(pos, i * 3);
      const dist2 = _ray.distanceSqToSegment(_a, _b, _p, _q);
      const along = _p.distanceTo(_ray.origin);
      const reach = tolerance * along + width[i] * 3;
      if (dist2 > reach * reach) continue;
      // Near the pointer, thick, and near the eye, in that order.
      const score = Math.sqrt(dist2) / reach - Math.min(0.6, (width[i] / (tolerance * along)) * 0.35) + along * 0.001;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  /** The node at the end of the first segment of the branch a node's branch grows from; or -1 at the trunk. */
  parentBranch(node: number): number {
    const d = this.current?.data;
    if (!d || node < 0) return -1;
    const { parent, order } = d;
    let start = node;
    while (parent[start] >= 0 && order[parent[start]] === order[node]) start = parent[start];
    const fork = parent[start];
    return fork > 0 ? fork : order[node] > 0 ? 1 : -1;
  }

  /**
   * Stand in for the garden's tree: grown as far as it is, and bending in
   * its wind. Then, with `seconds`, ease out of it: grow the rest of the way
   * and come to rest. Or back into it, before the garden returns.
   */
  standIn(growth: number): void {
    this.growth.set(growth);
    this.sway.set(1);
  }
  letGo(seconds: number): void {
    this.growth.set(1, seconds);
    this.sway.set(0, seconds * 1.3);
  }
  takeUp(growth: number, seconds: number): void {
    this.growth.set(growth, seconds);
    this.sway.set(1, seconds);
  }

  /**
   * The scan over the screen, up from the bottom bringing the view in, or
   * down from the top taking it away. Resolves when it has passed.
   */
  scan(into: boolean, seconds: number): Promise<void> {
    this.scanning?.done();
    return new Promise((done) => {
      this.scanning = { into, t: 0, seconds, done };
      this.uniforms.front.value = into ? SCAN_BOTTOM : SCAN_TOP;
    });
  }

  /** Cover the whole screen with the page at once (nothing of the garden showing), or none of it. */
  cover(all: boolean): void {
    this.uniforms.front.value = all ? COVERED : UNCOVERED;
  }

  /** The page covers everything: nothing of the garden is on screen. */
  get covering(): boolean {
    return this.uniforms.front.value >= SCAN_TOP;
  }

  get scanRunning(): boolean {
    return this.scanning !== null;
  }

  /** One frame: morphs, fades, theme, focus, lens, growth, sway and scan. */
  tick(dt: number): void {
    const u = this.uniforms;
    u.night.value += (this.nightTarget - u.night.value) * (1 - Math.exp(-dt / 0.5));
    u.focus.value += (this.focusTarget - u.focus.value) * (1 - Math.exp(-dt / 0.18));
    const k = 1 - Math.exp(-dt / 0.22);
    u.byDepth.value += ((this.lensTarget === 'depth' ? 1 : 0) - u.byDepth.value) * k;
    u.byAge.value += ((this.lensTarget === 'age' ? 1 : 0) - u.byAge.value) * k;
    u.byRule.value += ((this.lensTarget === 'rule' ? 1 : 0) - u.byRule.value) * k;
    u.growth.value = this.growth.tick(dt);
    u.sway.value = this.sway.tick(dt);

    this.current?.tick(dt);
    const c = this.collapsing;
    if (c && !c.old.tick(dt)) this.finishCollapse();
    const cur = this.current;
    if (cur && cur.fade.value < 1 && !this.collapsing) cur.fade.value = Math.min(1, cur.fade.value + dt / 0.3);
    for (const old of this.leaving) old.fade.value = Math.max(0, old.fade.value - dt / 0.3);
    this.leaving = this.leaving.filter((old) => {
      if (old.fade.value > 0) return true;
      this.drop(old);
      return false;
    });

    const s = this.scanning;
    if (s) {
      s.t = Math.min(1, s.t + dt / s.seconds);
      const e = ease(s.t);
      u.front.value = s.into ? SCAN_BOTTOM + (SCAN_TOP - SCAN_BOTTOM) * e : SCAN_TOP - (SCAN_TOP - SCAN_BOTTOM) * e;
      if (s.t >= 1) {
        this.scanning = null;
        u.front.value = s.into ? COVERED : UNCOVERED;
        s.done();
      }
    }
  }

  dispose(): void {
    this.scanning?.done();
    this.current?.dispose();
    this.collapsing?.old.dispose();
    for (const old of this.leaving) old.dispose();
    this.endWarmUp();
    for (const slot of this.slots) slot.dispose();
    this.shadow.geometry.dispose();
    this.veil.geometry.dispose();
  }
}

/**
 * Where the scan's front has to reach for its softened edge to have cleared
 * the top of the screen, and where it starts from below the bottom so that
 * not even its glow shows.
 */
const SCAN_TOP = 1 + VEIL_EDGE + 0.04;
const SCAN_BOTTOM = -0.06;
/** The front, once the scan has passed one way or the other. */
export const COVERED = 2;
export const UNCOVERED = -1;
