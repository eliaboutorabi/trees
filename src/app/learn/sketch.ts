/**
 * The Learn page's drawing board: an L-system drawn as ink on paper.
 *
 * Not the garden's renderer. A lesson wants to show what a grammar *says* —
 * the turtle's path, where it branches, where the leaves go — and a lit,
 * shaded, wind-blown tree buries that under everything that makes it pretty.
 * So the same engine builds the same skeleton, and this draws it plainly: a
 * line for every internode, as thick as the pipe model makes it, and a leaf as
 * a small almond of green. It is a 2D canvas: no second WebGPU device, nothing
 * to compile, and a few thousand lines a frame cost next to nothing.
 *
 * It grows. A new lesson draws its tree in along its own branches, by distance
 * from the root — the same wavefront the garden's trees grow by. And a grammar
 * that leaves the page, with pitch and roll, turns slowly so its depth shows,
 * and can be turned by hand.
 */
import { Vector3 } from 'three';
import { buildTree, type GrammarIssue, type Module } from '../../engine';

/** Everything that decides what a grammar draws. */
export interface SketchSource {
  axiom: string;
  rules: string;
  iterations: number;
  /** `ANG`, and the turn of a bare `+`. */
  angle: number;
  /** `LEN`, and the step of a bare `F`. */
  step: number;
  /** `SHRINK`. */
  shrink: number;
  tropism: number;
  seed: number;
}

/** Plain pen lines, or a tree: thickness from the pipe model, and a ground. */
export type SketchLook = 'line' | 'tree';

export interface SketchInfo {
  issues: GrammarIssue[];
  /** The derived word as source text, cut short if it is long. */
  word: string;
  modules: number;
  segments: number;
  leaves: number;
  /** A budget stopped the grammar before it finished. */
  truncated: boolean;
  /** The drawing leaves the page, so it turns. */
  solid: boolean;
}

const WORD_PREVIEW = 520;
/** Generous for a lesson, and still quick enough to rebuild as you type. */
const MAX_MODULES = 200_000;
const MAX_SEGMENTS = 20_000;
const GROW_SECONDS = 1.7;
const TURN_SPEED = 0.32;

interface Drawing {
  /** Segment endpoints, xyz each. */
  a: Float32Array;
  b: Float32Array;
  /** Distance from the root at each end, for growing in. */
  arcA: Float32Array;
  arcB: Float32Array;
  /** Thickness, 0–1 of the thickest. */
  width: Float32Array;
  segments: number;
  /** Leaf base, blade direction, size, arc and kind (0 leaf, 1 blossom). */
  leafPos: Float32Array;
  leafDir: Float32Array;
  leafSize: Float32Array;
  leafArc: Float32Array;
  leafKind: Uint8Array;
  leaves: number;
  maxArc: number;
  solid: boolean;
  /** Bounds: radial reach about the Y axis, and the box on the page. */
  reach: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  height: number;
}

const EMPTY: Drawing = {
  a: new Float32Array(0),
  b: new Float32Array(0),
  arcA: new Float32Array(0),
  arcB: new Float32Array(0),
  width: new Float32Array(0),
  segments: 0,
  leafPos: new Float32Array(0),
  leafDir: new Float32Array(0),
  leafSize: new Float32Array(0),
  leafArc: new Float32Array(0),
  leafKind: new Uint8Array(0),
  leaves: 0,
  maxArc: 1,
  solid: false,
  reach: 1,
  minX: -1,
  maxX: 1,
  minY: 0,
  maxY: 1,
  height: 1,
};

function formatNumber(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** The derived word back as source text, as far as `limit` characters. */
function wordText(word: Module[], limit: number): string {
  let out = '';
  for (const m of word) {
    out += m.p.length ? `${m.s}(${m.p.map(formatNumber).join(',')})` : m.s;
    if (out.length > limit) return out.slice(0, limit) + ' …';
  }
  return out;
}

const UP = new Vector3(0, 1, 0);
const _dir = new Vector3();

export class Sketch {
  private readonly ctx: CanvasRenderingContext2D;
  private drawing: Drawing = EMPTY;
  private look: SketchLook = 'line';

  /** How far grown, 0–1. */
  private growth = 1;
  private yaw = 0.5;
  /** The framing, eased toward the one the drawing wants. */
  private fit = { k: 0, x: 0, y: 0 };
  private fitTarget = { k: 1, x: 0, y: 0 };

  private raf = 0;
  private last = 0;
  private dragging = false;
  private dragX = 0;
  /** Auto-turning waits after a drag, so the view you chose stays put a moment. */
  private turnAfter = 0;
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly resizer: ResizeObserver;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(canvas);
    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    this.resize();
  }

  /**
   * Build a grammar and draw it. `grow` draws it in from the root; otherwise
   * it simply becomes the new drawing, which is what you want while typing.
   */
  show(src: SketchSource, look: SketchLook, options: { grow: boolean; leafScale: number }): SketchInfo {
    const build = buildTree({
      axiom: src.axiom,
      rules: src.rules,
      iterations: src.iterations,
      angle: src.angle,
      step: src.step,
      shrink: src.shrink,
      tropism: src.tropism,
      seed: src.seed,
      trunkRadius: 1,
      pipeExponent: 2.4,
      leafScale: options.leafScale,
      autoLeaves: false,
      maxModules: MAX_MODULES,
      maxSegments: MAX_SEGMENTS,
      keepWord: true,
    });

    this.look = look;
    this.drawing = build.skeleton ? this.prepare(build.skeleton) : EMPTY;
    this.frame(true);
    if (options.grow && !this.reduced) this.growth = 0;
    this.wake();

    return {
      issues: build.issues,
      word: build.word ? wordText(build.word, WORD_PREVIEW) : '',
      modules: build.stats.modules,
      segments: this.drawing.segments,
      leaves: this.drawing.leaves,
      truncated: build.stats.truncated,
      solid: this.drawing.solid,
    };
  }

  /** Grow the current drawing in again. */
  replay(): void {
    if (this.reduced) return;
    this.growth = 0;
    this.wake();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizer.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
  }

  // ------------------------------------------------------------- building

  private prepare(skel: NonNullable<ReturnType<typeof buildTree>['skeleton']>): Drawing {
    const { pos, parent, radius, arc, count } = skel;
    let segments = 0;
    for (let i = 1; i < count; i++) if (parent[i] >= 0) segments++;

    const a = new Float32Array(segments * 3);
    const b = new Float32Array(segments * 3);
    const arcA = new Float32Array(segments);
    const arcB = new Float32Array(segments);
    const width = new Float32Array(segments);
    const maxRadius = Math.max(1e-6, skel.maxRadius);

    // The turtle sinks the root below the ground for the garden's sake; on
    // paper the tree stands on the line.
    const y = (i: number) => (i === 0 ? Math.max(0, pos[1]) : pos[i * 3 + 1]);

    let minX = 0, maxX = 0, minY = 0, maxY = 0, minZ = 0, maxZ = 0, reach = 0;
    // Depth is judged on the wood alone: leaves are set at a random twist, so
    // their tips leave the page even on a tree drawn flat.
    const extend = (px: number, py: number, pz: number, wood: boolean) => {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      if (wood && pz < minZ) minZ = pz;
      if (wood && pz > maxZ) maxZ = pz;
      const r = Math.hypot(px, pz);
      if (r > reach) reach = r;
    };

    let s = 0;
    let maxArc = 0;
    for (let i = 1; i < count; i++) {
      const p = parent[i];
      if (p < 0) continue;
      a[s * 3] = pos[p * 3];
      a[s * 3 + 1] = y(p);
      a[s * 3 + 2] = pos[p * 3 + 2];
      b[s * 3] = pos[i * 3];
      b[s * 3 + 1] = y(i);
      b[s * 3 + 2] = pos[i * 3 + 2];
      arcA[s] = arc[p];
      arcB[s] = arc[i];
      width[s] = Math.min(1, radius[i] / maxRadius);
      extend(b[s * 3], b[s * 3 + 1], b[s * 3 + 2], true);
      if (arc[i] > maxArc) maxArc = arc[i];
      s++;
    }

    const leaves = skel.leaves.length;
    const leafPos = new Float32Array(leaves * 3);
    const leafDir = new Float32Array(leaves * 3);
    const leafSize = new Float32Array(leaves);
    const leafArc = new Float32Array(leaves);
    const leafKind = new Uint8Array(leaves);
    skel.leaves.forEach((leaf, i) => {
      leafPos[i * 3] = leaf.pos.x;
      leafPos[i * 3 + 1] = leaf.pos.y;
      leafPos[i * 3 + 2] = leaf.pos.z;
      _dir.copy(UP).applyQuaternion(leaf.quat);
      leafDir[i * 3] = _dir.x;
      leafDir[i * 3 + 1] = _dir.y;
      leafDir[i * 3 + 2] = _dir.z;
      leafSize[i] = leaf.scale;
      leafArc[i] = leaf.arc;
      leafKind[i] = leaf.kind;
      extend(leaf.pos.x + _dir.x * leaf.scale, leaf.pos.y + _dir.y * leaf.scale, leaf.pos.z + _dir.z * leaf.scale, false);
      if (leaf.arc > maxArc) maxArc = leaf.arc;
    });

    const span = Math.max(maxX - minX, maxY - minY, 1e-6);
    return {
      a, b, arcA, arcB, width, segments,
      leafPos, leafDir, leafSize, leafArc, leafKind, leaves,
      maxArc: maxArc || 1,
      solid: maxZ - minZ > span * 0.02,
      reach: Math.max(reach, 1e-6),
      minX, maxX, minY, maxY,
      height: Math.max(maxY - minY, 1e-6),
    };
  }

  // ------------------------------------------------------------- framing

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.frame(this.fit.k === 0);
    this.paint();
  }

  /** Where the drawing should sit: filling the board, with a margin. */
  private frame(snap: boolean): void {
    const d = this.drawing;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const margin = 0.82;
    let k: number;
    let x: number;
    if (d.solid) {
      // Turning: frame the whole circle it sweeps, so nothing leaves the board.
      k = Math.min((W * margin) / (2 * d.reach), (H * margin) / d.height);
      x = 0;
    } else {
      k = Math.min((W * margin) / Math.max(d.maxX - d.minX, 1e-6), (H * margin) / d.height);
      x = (d.minX + d.maxX) / 2;
    }
    this.fitTarget = { k, x, y: (d.minY + d.maxY) / 2 };
    if (snap || this.fit.k === 0) this.fit = { ...this.fitTarget };
  }

  // ------------------------------------------------------------- the loop

  private wake(): void {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number): void => {
    this.raf = 0;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    let busy = false;

    if (this.growth < 1) {
      this.growth = Math.min(1, this.growth + dt / GROW_SECONDS);
      busy = true;
    }
    if (this.drawing.solid && !this.reduced) {
      // Kept running through the pause after a drag, so turning resumes by itself.
      busy = true;
      if (!this.dragging && now > this.turnAfter) this.yaw += dt * TURN_SPEED;
    }
    if (this.dragging) busy = true;

    // Ease the framing, so a new drawing slides into place rather than jumping.
    const f = this.fit;
    const t = this.fitTarget;
    const e = 1 - Math.exp(-dt / 0.22);
    f.k += (t.k - f.k) * e;
    f.x += (t.x - f.x) * e;
    f.y += (t.y - f.y) * e;
    if (Math.abs(t.k - f.k) > t.k * 1e-3 || Math.abs(t.x - f.x) * t.k > 0.3 || Math.abs(t.y - f.y) * t.k > 0.3) busy = true;

    this.paint();
    if (busy) this.raf = requestAnimationFrame(this.tick);
  };

  // ------------------------------------------------------------- drawing

  private paint(): void {
    const { ctx, canvas, drawing: d } = this;
    const W = canvas.width;
    const H = canvas.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.clearRect(0, 0, W, H);
    if (!d.segments && !d.leaves) return;

    const { k, x: fx, y: fy } = this.fit;
    const cos = Math.cos(d.solid ? this.yaw : 0);
    const sin = Math.sin(d.solid ? this.yaw : 0);
    const cx = W / 2;
    const cy = H / 2;
    const sx = (x: number, z: number) => cx + (x * cos + z * sin - fx) * k;
    const sy = (y: number) => cy - (y - fy) * k;
    // Depth, -1 far to 1 near, for drawing the far side fainter.
    const depthOf = (x: number, z: number) => (-x * sin + z * cos) / d.reach;

    // The growing front runs a little past the farthest tip, so the leaves out
    // there — which sit exactly at it — have room to swell in too.
    const swell = d.maxArc * 0.06;
    const front = this.growth * (d.maxArc + swell);
    const tree = this.look === 'tree';

    // The ground, under a tree: a soft shadow and a line drawn by hand.
    if (tree) {
      const gy = sy(0);
      const half = (d.solid ? d.reach : Math.max(Math.abs(d.minX), Math.abs(d.maxX))) * k * 0.9 + 12 * dpr;
      const gx = d.solid ? sx(0, 0) : cx - fx * k;
      ctx.fillStyle = 'rgba(78, 58, 34, 0.08)';
      ctx.beginPath();
      ctx.ellipse(gx, gy, half, Math.max(4, half * 0.08), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(78, 58, 34, 0.35)';
      ctx.lineWidth = 1.2 * dpr;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(gx - half * 1.15, gy + 1);
      ctx.quadraticCurveTo(gx, gy - 2 * dpr, gx + half * 1.15, gy + 1.5 * dpr);
      ctx.stroke();
    }

    // Branches, batched into a few strokes: by thickness, and by depth so the
    // far side of a solid tree is drawn first and fainter.
    const WIDTHS = tree ? 8 : 1;
    const DEPTHS = d.solid ? 3 : 1;
    const buckets: number[][] = Array.from({ length: WIDTHS * DEPTHS }, () => []);
    for (let i = 0; i < d.segments; i++) {
      if (d.arcA[i] >= front) continue;
      const w = tree ? Math.min(WIDTHS - 1, Math.floor(Math.pow(d.width[i], 0.6) * WIDTHS)) : 0;
      const mx = (d.a[i * 3] + d.b[i * 3]) / 2;
      const mz = (d.a[i * 3 + 2] + d.b[i * 3 + 2]) / 2;
      const z = d.solid ? Math.min(DEPTHS - 1, Math.max(0, Math.floor(((depthOf(mx, mz) + 1) / 2) * DEPTHS))) : 0;
      buckets[z * WIDTHS + w].push(i);
    }

    const thickest = Math.min(14, Math.max(2.6, d.height * k * 0.028 / dpr)) * dpr;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let z = 0; z < DEPTHS; z++) {
      ctx.globalAlpha = DEPTHS > 1 ? 0.4 + 0.6 * ((z + 1) / DEPTHS) : 1;
      for (let w = WIDTHS - 1; w >= 0; w--) {
        const list = buckets[z * WIDTHS + w];
        if (!list.length) continue;
        const t = WIDTHS > 1 ? (w + 0.5) / WIDTHS : 0;
        ctx.lineWidth = tree ? Math.max(1.1 * dpr, thickest * t) : 1.7 * dpr;
        ctx.strokeStyle = tree ? mixColour([122, 108, 66], [70, 50, 34], t) : '#3a2e22';
        ctx.beginPath();
        for (const i of list) {
          const span = d.arcB[i] - d.arcA[i];
          const u = span > 0 ? Math.min(1, (front - d.arcA[i]) / span) : 1;
          const ax = d.a[i * 3], ay = d.a[i * 3 + 1], az = d.a[i * 3 + 2];
          const bx = ax + (d.b[i * 3] - ax) * u;
          const by = ay + (d.b[i * 3 + 1] - ay) * u;
          const bz = az + (d.b[i * 3 + 2] - az) * u;
          ctx.moveTo(sx(ax, az), sy(ay));
          ctx.lineTo(sx(bx, bz), sy(by));
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // Leaves and blossom, each kind in one fill: a leaf an almond along its
    // blade, swelling in as the growth reaches it.
    if (d.leaves) {
      for (const kind of [0, 1] as const) {
        ctx.beginPath();
        let any = false;
        for (let i = 0; i < d.leaves; i++) {
          if (d.leafKind[i] !== kind) continue;
          const grown = Math.min(1, (front - d.leafArc[i]) / swell);
          if (grown <= 0) continue;
          any = true;
          const px = d.leafPos[i * 3], py = d.leafPos[i * 3 + 1], pz = d.leafPos[i * 3 + 2];
          const size = Math.max(2.2 * dpr, d.leafSize[i] * k) * grown;
          const x0 = sx(px, pz);
          const y0 = sy(py);
          if (kind === 1) {
            ctx.moveTo(x0 + size * 0.42, y0);
            ctx.arc(x0, y0, size * 0.42, 0, Math.PI * 2);
            continue;
          }
          // The blade's direction on the page; a leaf seen end-on points up.
          let ux = d.leafDir[i * 3] * cos + d.leafDir[i * 3 + 2] * sin;
          let uy = -d.leafDir[i * 3 + 1];
          const len = Math.hypot(ux, uy);
          if (len < 0.2) {
            ux = 0;
            uy = -1;
          } else {
            ux /= len;
            uy /= len;
          }
          const tipX = x0 + ux * size;
          const tipY = y0 + uy * size;
          const nx = -uy * size * 0.34;
          const ny = ux * size * 0.34;
          const midX = (x0 + tipX) / 2;
          const midY = (y0 + tipY) / 2;
          ctx.moveTo(x0, y0);
          ctx.quadraticCurveTo(midX + nx, midY + ny, tipX, tipY);
          ctx.quadraticCurveTo(midX - nx, midY - ny, x0, y0);
        }
        if (!any) continue;
        ctx.fillStyle = kind === 0 ? 'rgba(112, 156, 70, 0.88)' : 'rgba(243, 163, 186, 0.92)';
        ctx.fill();
        ctx.lineWidth = 0.8 * dpr;
        ctx.strokeStyle = kind === 0 ? 'rgba(46, 74, 28, 0.55)' : 'rgba(150, 70, 96, 0.5)';
        ctx.stroke();
      }
    }
  }

  // ------------------------------------------------------------- turning by hand

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.drawing.solid) return;
    this.dragging = true;
    this.dragX = e.clientX;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.wake();
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.yaw += (e.clientX - this.dragX) * 0.01;
    this.dragX = e.clientX;
  };

  private readonly onUp = (): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.turnAfter = performance.now() + 2500;
    this.wake();
  };
}

function mixColour(a: [number, number, number], b: [number, number, number], t: number): string {
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
