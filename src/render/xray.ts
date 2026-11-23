/**
 * The L-system view: the tree with everything but its structure taken away.
 *
 * What is left is the turtle's own drawing: each `F` a tube from where the
 * turtle was to where it went, as thick as the pipe model says (thinned, so
 * the finest twigs still read), a bead at every fork, a dot at every tip, a
 * larger one at the root. Colour is depth: how many brackets deep the turtle
 * was when it drew the segment, from the trunk's warm ink out to the tips.
 *
 * It draws the tree as it stood after any number of rewrites, and grows each
 * one in from the root along its path, so stepping through the derivation is
 * watching it happen. A branch can be picked: it, and everything grown from
 * it (the bracketed group it is written in), is lit while the rest recedes.
 *
 * Two themes, paper by day and ink by night, eased between, so the view
 * keeps the app's day and night without the garden.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  Ray,
  RingGeometry,
  Vector3,
} from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  abs,
  attribute,
  clamp,
  dot,
  float,
  max,
  mix,
  normalize,
  normalLocal,
  normalView,
  normalWorld,
  pow,
  screenUV,
  smoothstep,
  uniform,
  uv,
  vec3,
} from 'three/tsl';
import type { SkeletonData } from '../engine';

/** The colours of a theme: the ramp from trunk to tips, the lit branch, the page. */
interface Theme {
  ramp: [number, number, number, number];
  tip: number;
  lit: number;
  hover: number;
  top: number;
  bottom: number;
  shadow: number;
  line: number;
}

const DAY: Theme = {
  // Ink: bark brown at the trunk, through olive, to a soft sage at the tips.
  ramp: [0x5e4b36, 0x5f6236, 0x6e7d48, 0x8c9a68],
  tip: 0xd8cca4,
  lit: 0xe0612f,
  hover: 0xc98a4a,
  top: 0xfaf6ee,
  bottom: 0xeee5d3,
  shadow: 0x9c8a66,
  line: 0xb9a888,
};

const NIGHT: Theme = {
  // Candle gold at the trunk, through sea-glass, to lavender at the tips.
  ramp: [0xe8c98a, 0x8fbcc4, 0x7fb59a, 0xb7a2e0],
  tip: 0xd9c9f2,
  lit: 0xf6b354,
  hover: 0xd7a868,
  top: 0x1c2336,
  bottom: 0x0c1019,
  shadow: 0x000000,
  line: 0x5b6582,
};

/** The depth ramp of a theme, as CSS colours, for a legend drawn beside the tree. */
export function depthColours(night: boolean): string[] {
  return (night ? NIGHT : DAY).ramp.map((h) => `#${h.toString(16).padStart(6, '0')}`);
}

const colour = (hex: number) => uniform(new Color(hex));
type ColourUniform = ReturnType<typeof colour>;
interface Pair {
  day: ColourUniform;
  night: ColourUniform;
}
const pair = (day: number, night: number): Pair => ({ day: colour(day), night: colour(night) });

/** Uniforms shared by everything the view draws. */
function themeUniforms() {
  return {
    night: uniform(0),
    /** How far something picked has drawn attention to itself, 0–1. */
    focus: uniform(0),
    ramp: DAY.ramp.map((h, i) => pair(h, NIGHT.ramp[i])),
    tip: pair(DAY.tip, NIGHT.tip),
    lit: pair(DAY.lit, NIGHT.lit),
    hover: pair(DAY.hover, NIGHT.hover),
    top: pair(DAY.top, NIGHT.top),
    bottom: pair(DAY.bottom, NIGHT.bottom),
    shadow: pair(DAY.shadow, NIGHT.shadow),
    line: pair(DAY.line, NIGHT.line),
  };
}
type ThemeUniforms = ReturnType<typeof themeUniforms>;

/** One of the theme's colours, as it stands between day and night. */
const pick = (u: ThemeUniforms, p: Pair) => mix(p.day, p.night, u.night);

/** Tubes this many sides round: enough to read as round, little enough to be ten thousand of. */
const SIDES = 7;
const BEAD = new IcosahedronGeometry(1, 1);

/** A drawing of one skeleton: its tubes and its beads, growing in and fading out. */
class Drawing {
  readonly group = new Group();
  readonly reveal = uniform(0);
  readonly fade = uniform(1);
  private readonly tubes: Mesh;
  private readonly beads: Mesh;
  /** Where each segment's vertices start in the tube mesh, and each node's bead in the bead mesh (-1: none). */
  private readonly beadAt: Int32Array;
  private readonly tubeMark: Float32Array;
  private readonly beadMark: Float32Array;
  readonly maxArc: number;

  constructor(
    readonly data: SkeletonData,
    readonly arc: Float32Array,
    readonly children: Uint16Array,
    readonly width: Float32Array,
    u: ThemeUniforms,
  ) {
    const { count, pos, parent, order } = data;
    let maxOrder = 1;
    let maxArc = 1e-3;
    for (let i = 0; i < count; i++) {
      if (order[i] > maxOrder) maxOrder = order[i];
      if (arc[i] > maxArc) maxArc = arc[i];
    }
    this.maxArc = maxArc;

    // ---- tubes: one ring at each end of every segment, as a strip of quads.
    let segs = 0;
    for (let i = 1; i < count; i++) if (parent[i] >= 0) segs++;
    const verts = segs * SIDES * 2;
    const position = new Float32Array(verts * 3);
    const normal = new Float32Array(verts * 3);
    const start = new Float32Array(verts * 3);
    const depth = new Float32Array(verts);
    const grow = new Float32Array(verts * 2);
    const thick = new Float32Array(verts);
    this.tubeMark = new Float32Array(verts);
    const index = new Uint32Array(segs * SIDES * 6);
    const a = new Vector3();
    const b = new Vector3();
    const dir = new Vector3();
    const side = new Vector3();
    const up = new Vector3();
    const ring = new Vector3();
    let v = 0;
    let t = 0;
    for (let i = 1; i < count; i++) {
      const p = parent[i];
      if (p < 0) continue;
      a.fromArray(pos, p * 3);
      b.fromArray(pos, i * 3);
      dir.subVectors(b, a);
      const len = dir.length();
      if (len < 1e-6) dir.set(0, 1, 0);
      else dir.divideScalar(len);
      side.set(0, 1, 0).cross(dir);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0).cross(dir);
      side.normalize();
      up.crossVectors(dir, side).normalize();
      const r0 = width[p];
      const r1 = width[i];
      const d = order[i] / maxOrder;
      const from = arc[p] / maxArc;
      const to = arc[i] / maxArc;
      for (let end = 0; end < 2; end++) {
        const centre = end === 0 ? a : b;
        const r = end === 0 ? r0 : r1;
        for (let k = 0; k < SIDES; k++) {
          const ang = (k / SIDES) * Math.PI * 2;
          ring.copy(side).multiplyScalar(Math.cos(ang)).addScaledVector(up, Math.sin(ang));
          position[v * 3] = centre.x + ring.x * r;
          position[v * 3 + 1] = centre.y + ring.y * r;
          position[v * 3 + 2] = centre.z + ring.z * r;
          normal[v * 3] = ring.x;
          normal[v * 3 + 1] = ring.y;
          normal[v * 3 + 2] = ring.z;
          // Grown in from its foot: every vertex knows where the segment starts.
          start[v * 3] = a.x + ring.x * r0;
          start[v * 3 + 1] = a.y + ring.y * r0;
          start[v * 3 + 2] = a.z + ring.z * r0;
          depth[v] = d;
          grow[v * 2] = from;
          grow[v * 2 + 1] = to;
          thick[v] = r;
          v++;
        }
      }
      const base = v - SIDES * 2;
      for (let k = 0; k < SIDES; k++) {
        const k2 = (k + 1) % SIDES;
        const a0 = base + k;
        const a1 = base + k2;
        const b0 = base + SIDES + k;
        const b1 = base + SIDES + k2;
        index[t++] = a0;
        index[t++] = b0;
        index[t++] = a1;
        index[t++] = a1;
        index[t++] = b0;
        index[t++] = b1;
      }
    }
    const tubeGeo = new BufferGeometry();
    tubeGeo.setAttribute('position', new BufferAttribute(position, 3));
    tubeGeo.setAttribute('normal', new BufferAttribute(normal, 3));
    tubeGeo.setAttribute('aStart', new BufferAttribute(start, 3));
    tubeGeo.setAttribute('aDepth', new BufferAttribute(depth, 1));
    tubeGeo.setAttribute('aGrow', new BufferAttribute(grow, 2));
    tubeGeo.setAttribute('aMark', new BufferAttribute(this.tubeMark, 1));
    tubeGeo.setAttribute('aWidth', new BufferAttribute(thick, 1));
    tubeGeo.setIndex(new BufferAttribute(index, 1));
    this.tubes = new Mesh(tubeGeo, this.material(u, false));
    this.tubes.frustumCulled = false;

    // ---- beads: at the root, at every fork, at every tip.
    this.beadAt = new Int32Array(count).fill(-1);
    let beads = 0;
    for (let i = 0; i < count; i++) {
      if (i === 0 || children[i] !== 1) this.beadAt[i] = beads++;
    }
    const bv = BEAD.attributes.position.count;
    const bpos = new Float32Array(beads * bv * 3);
    const bnorm = new Float32Array(beads * bv * 3);
    const bstart = new Float32Array(beads * bv * 3);
    const bdepth = new Float32Array(beads * bv);
    const bgrow = new Float32Array(beads * bv * 2);
    const btip = new Float32Array(beads * bv);
    const bwidth = new Float32Array(beads * bv);
    this.beadMark = new Float32Array(beads * bv);
    const bidx = BEAD.index ? BEAD.index.array : null;
    const bindex = new Uint32Array(beads * (bidx ? bidx.length : bv));
    const src = BEAD.attributes.position.array as Float32Array;
    let w = 0;
    let bi = 0;
    for (let i = 0; i < count; i++) {
      const at = this.beadAt[i];
      if (at < 0) continue;
      const tip = children[i] === 0 && i !== 0;
      const fork = children[i] > 1;
      // A tip is a small dot, a fork a bead a little proud of its branch, the root larger still.
      const r = i === 0 ? width[0] * 1.2 : tip ? Math.max(width[i] * 2.3, this.minWidth(width) * 2.9) : width[i] * (fork ? 1.4 : 1.15);
      const cx = pos[i * 3];
      const cy = pos[i * 3 + 1];
      const cz = pos[i * 3 + 2];
      const d = order[i] / maxOrder;
      for (let k = 0; k < bv; k++) {
        const nx = src[k * 3];
        const ny = src[k * 3 + 1];
        const nz = src[k * 3 + 2];
        const o = w + k;
        bpos[o * 3] = cx + nx * r;
        bpos[o * 3 + 1] = cy + ny * r;
        bpos[o * 3 + 2] = cz + nz * r;
        bnorm[o * 3] = nx;
        bnorm[o * 3 + 1] = ny;
        bnorm[o * 3 + 2] = nz;
        // A bead appears where its node is, a moment after the segment reaching it.
        bstart[o * 3] = cx;
        bstart[o * 3 + 1] = cy;
        bstart[o * 3 + 2] = cz;
        bdepth[o] = d;
        bgrow[o * 2] = arc[i] / maxArc;
        bgrow[o * 2 + 1] = arc[i] / maxArc + 0.04;
        btip[o] = tip ? 1 : 0;
        bwidth[o] = r;
      }
      if (bidx) for (let k = 0; k < bidx.length; k++) bindex[bi++] = (bidx[k] as number) + w;
      else for (let k = 0; k < bv; k++) bindex[bi++] = w + k;
      w += bv;
    }
    const beadGeo = new BufferGeometry();
    beadGeo.setAttribute('position', new BufferAttribute(bpos, 3));
    beadGeo.setAttribute('normal', new BufferAttribute(bnorm, 3));
    beadGeo.setAttribute('aStart', new BufferAttribute(bstart, 3));
    beadGeo.setAttribute('aDepth', new BufferAttribute(bdepth, 1));
    beadGeo.setAttribute('aGrow', new BufferAttribute(bgrow, 2));
    beadGeo.setAttribute('aTip', new BufferAttribute(btip, 1));
    beadGeo.setAttribute('aMark', new BufferAttribute(this.beadMark, 1));
    beadGeo.setAttribute('aWidth', new BufferAttribute(bwidth, 1));
    beadGeo.setIndex(new BufferAttribute(bindex, 1));
    this.beads = new Mesh(beadGeo, this.material(u, true));
    this.beads.frustumCulled = false;

    this.group.add(this.tubes, this.beads);
  }

  private minWidth(width: Float32Array): number {
    let m = Infinity;
    for (let i = 0; i < width.length; i++) if (width[i] < m) m = width[i];
    return Number.isFinite(m) ? m : 0.01;
  }

  /**
   * Flat, lit by one soft light from above and a little in front, with a
   * brighter rim (the glassy edge the night theme glows at): a diagram,
   * not a material. Grown in along the tree's own paths; marked parts lit.
   */
  private material(u: ThemeUniforms, beads: boolean): MeshBasicNodeMaterial {
    const m = new MeshBasicNodeMaterial();
    const grow = attribute<'vec2'>('aGrow', 'vec2');
    const start = attribute<'vec3'>('aStart', 'vec3');
    const depth = attribute<'float'>('aDepth', 'float');
    const mark = attribute<'float'>('aMark', 'float');
    const reveal = this.reveal;
    // A segment unrolls from its foot as the reveal passes along its path.
    const g = clamp(reveal.mul(1.08).sub(grow.x).div(grow.y.sub(grow.x).max(1e-4)), 0, 1);
    const here = attribute<'vec3'>('position', 'vec3');
    // What is lit swells, so a picked twig reads as surely as a limb; what is under the pointer, a little.
    const swell = mark.greaterThan(0.75).select(float(1.15), mark.greaterThan(0.25).select(float(0.45), float(0)));
    m.positionNode = mix(start, here, g).add(normalLocal.mul(attribute<'float'>('aWidth', 'float').mul(swell)));

    const t = depth;
    const ramp = u.ramp.map((s) => pick(u, s));
    let col = mix(ramp[0], ramp[1], clamp(t.mul(3), 0, 1));
    col = mix(col, ramp[2], clamp(t.mul(3).sub(1), 0, 1));
    col = mix(col, ramp[3], clamp(t.mul(3).sub(2), 0, 1));
    if (beads) col = mix(col, pick(u, u.tip), attribute<'float'>('aTip', 'float').mul(0.55));

    const light = normalize(vec3(0.35, 0.85, 0.45));
    const lambert = max(dot(normalWorld, light), 0);
    const rim = pow(float(1).sub(abs(normalView.z)), 2.2);
    const shade = mix(float(0.62), float(0.5), u.night).add(lambert.mul(mix(float(0.42), float(0.36), u.night)));
    const lit = mark.greaterThan(0.75);
    const hovered = mark.greaterThan(0.25).and(lit.not());
    // By day the edges are inked, darker, as a drawing's are; by night they glow.
    const inked = col.mul(shade).mul(float(1).sub(rim.mul(0.35)));
    const glowing = col.mul(shade).add(rim.mul(0.32).mul(col.add(0.2)));
    let base = mix(inked, glowing, u.night);
    // What is not picked recedes toward the page while something is.
    const page = mix(pick(u, u.bottom), pick(u, u.top), 0.5);
    base = mix(base, page, u.focus.mul(mix(float(0.42), float(0.5), u.night)).mul(lit.not().select(float(1), float(0))));
    const glow = pick(u, u.lit).mul(float(0.85).add(lambert.mul(0.3))).add(rim.mul(0.35));
    const warm = mix(base, pick(u, u.hover), 0.55);
    m.colorNode = lit.select(glow, hovered.select(warm, base));
    m.opacityNode = this.fade;
    m.transparent = true;
    m.depthWrite = true;
    // A diagram has no air between it and you: the garden's haze is not for it.
    m.fog = false;
    return m;
  }

  /** Mark nodes: 1 lit, 0.5 hovered, 0 neither. Each segment takes its child node's mark. */
  mark(marks: Float32Array): void {
    const { count, parent } = this.data;
    let v = 0;
    for (let i = 1; i < count; i++) {
      if (parent[i] < 0) continue;
      const m = marks[i];
      this.tubeMark.fill(m, v, v + SIDES * 2);
      v += SIDES * 2;
    }
    const bv = BEAD.attributes.position.count;
    for (let i = 0; i < count; i++) {
      const at = this.beadAt[i];
      if (at >= 0) this.beadMark.fill(marks[i], at * bv, at * bv + bv);
    }
    (this.tubes.geometry.getAttribute('aMark') as BufferAttribute).needsUpdate = true;
    (this.beads.geometry.getAttribute('aMark') as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.tubes.geometry.dispose();
    this.beads.geometry.dispose();
    (this.tubes.material as MeshBasicNodeMaterial).dispose();
    (this.beads.material as MeshBasicNodeMaterial).dispose();
  }
}

const _ray = new Ray();
const _a = new Vector3();
const _b = new Vector3();
const _p = new Vector3();
const _q = new Vector3();

export class XrayView {
  readonly group = new Group();
  readonly uniforms = themeUniforms();
  /** The page behind the tree: paper by day, ink by night, a touch lighter toward the top. */
  readonly backgroundNode;
  private current: Drawing | null = null;
  private leaving: Drawing[] = [];
  private readonly shadow: Mesh;
  private readonly ring: Mesh;
  private nightTarget = 0;
  private focusTarget = 0;
  /** The picked branch (its nodes) and the one under the pointer. */
  private lit: Set<number> = new Set();
  private hovered: Set<number> = new Set();
  private selectedNode = -1;
  private hoverNode = -1;
  /** Seconds a reveal takes. */
  private growSeconds = 1.2;

  constructor() {
    const u = this.uniforms;
    this.backgroundNode = mix(pick(u, u.bottom), pick(u, u.top), smoothstep(0.05, 1, screenUV.y.oneMinus()));

    // A soft shadow on the ground, and one fine ring round it: where the tree stands.
    const shadowMat = new MeshBasicNodeMaterial();
    const d = uv().sub(0.5).length().mul(2);
    shadowMat.colorNode = pick(u, u.shadow);
    shadowMat.opacityNode = pow(float(1).sub(smoothstep(0, 1, d)), 2).mul(mix(float(0.32), float(0.55), u.night));
    shadowMat.transparent = true;
    shadowMat.depthWrite = false;
    shadowMat.fog = false;
    this.shadow = new Mesh(new CircleGeometry(1, 64), shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.002;
    this.shadow.renderOrder = -1;

    const ringMat = new MeshBasicNodeMaterial({ side: DoubleSide });
    ringMat.colorNode = pick(u, u.line);
    ringMat.opacityNode = mix(float(0.45), float(0.5), u.night);
    ringMat.transparent = true;
    ringMat.depthWrite = false;
    ringMat.fog = false;
    this.ring = new Mesh(new RingGeometry(0.995, 1, 128), ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.004;
    this.ring.renderOrder = -1;
    this.group.add(this.shadow, this.ring);
  }

  /** Day (0) or night (1); eased. */
  setNight(n: number): void {
    this.nightTarget = n;
  }

  /** Jump straight to the theme, without easing (on entering the view). */
  settleTheme(): void {
    this.uniforms.night.value = this.nightTarget;
  }

  /**
   * Show the tree after some number of rewrites, growing it in from the root
   * over `seconds` (0: at once). The one it replaces fades out meanwhile.
   */
  setSkeleton(data: SkeletonData, seconds = 1.2, footprint?: { radius: number }): void {
    const { count, pos, parent, radius } = data;
    const arc = new Float32Array(count);
    const children = new Uint16Array(count);
    for (let i = 1; i < count; i++) {
      const p = parent[i];
      if (p < 0) continue;
      children[p]++;
      arc[i] = arc[p] + Math.hypot(pos[i * 3] - pos[p * 3], pos[i * 3 + 1] - pos[p * 3 + 1], pos[i * 3 + 2] - pos[p * 3 + 2]);
    }
    // Thinner than the wood, so the structure reads, and never thinner than
    // a hair at the scale of the tree, so the finest twig is still there.
    const hair = Math.max(0.005, (data.height || 1) * 0.0013);
    const width = new Float32Array(count);
    for (let i = 0; i < count; i++) width[i] = Math.max(hair, radius[i] * 0.34);

    if (this.current) {
      this.leaving.push(this.current);
    }
    const drawing = new Drawing(data, arc, children, width, this.uniforms);
    drawing.reveal.value = seconds > 0 ? 0 : 1;
    this.growSeconds = Math.max(0.05, seconds);
    this.current = drawing;
    this.group.add(drawing.group);
    this.lit.clear();
    this.hovered.clear();
    this.selectedNode = -1;
    this.hoverNode = -1;
    this.focusTarget = 0;

    const r = Math.max(footprint?.radius ?? data.radiusXZ, 0.5);
    this.shadow.scale.setScalar(r * 1.05);
    this.ring.scale.setScalar(r * 1.05);
  }

  get skeleton(): SkeletonData | null {
    return this.current?.data ?? null;
  }

  /** Arc length, for the annotations. */
  get arcs(): Float32Array | null {
    return this.current?.arc ?? null;
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
    this.focusTarget = node >= 0 ? 1 : 0;
    this.applyMarks();
  }

  /** Warm the branch under the pointer (or nothing). */
  hover(node: number): void {
    if (node === this.hoverNode) return;
    this.hoverNode = node;
    this.hovered = node >= 0 && !this.lit.has(node) ? this.branchOf(node) : new Set();
    this.applyMarks();
  }

  private applyMarks(): void {
    const d = this.current;
    if (!d) return;
    const marks = new Float32Array(d.data.count);
    for (const i of this.hovered) marks[i] = 0.5;
    for (const i of this.lit) marks[i] = 1;
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

  /** One frame: growth, fades, theme and focus easing. */
  tick(dt: number): void {
    const u = this.uniforms;
    u.night.value += (this.nightTarget - u.night.value) * (1 - Math.exp(-dt / 0.5));
    u.focus.value += (this.focusTarget - u.focus.value) * (1 - Math.exp(-dt / 0.18));
    const cur = this.current;
    if (cur && cur.reveal.value < 1) cur.reveal.value = Math.min(1, cur.reveal.value + dt / this.growSeconds);
    for (const old of this.leaving) old.fade.value = Math.max(0, old.fade.value - dt / 0.35);
    this.leaving = this.leaving.filter((old) => {
      if (old.fade.value > 0) return true;
      this.group.remove(old.group);
      old.dispose();
      return false;
    });
  }

  /** Grown all the way in. */
  get grown(): boolean {
    return !this.current || this.current.reveal.value >= 1;
  }

  dispose(): void {
    this.current?.dispose();
    for (const old of this.leaving) old.dispose();
    this.shadow.geometry.dispose();
    this.ring.geometry.dispose();
  }
}
