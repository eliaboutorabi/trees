/**
 * A tree's anatomy: not the tree, but how it came to be.
 *
 * The same derivation `buildTree` runs, with the same seed and the same
 * random draws, kept step by step: every word from the axiom to the last,
 * and for every module where it came from and which production made it. So
 * any branch on the finished tree can be followed back through each rewrite
 * to the axiom, and the tree can be drawn as it stood after any number of
 * steps — what the L-system view shows.
 */
import { mulberry32 } from '../../lib/rng';
import { derive, type History } from './derive';
import type { EvalEnv } from './expr';
import { parseAxiom, parseRules, type Module, type Production } from './grammar';
import type { GrammarIssue, TreeConfig } from './index';
import { interpret, type Skeleton } from './turtle';

/** A module as the view shows it: its symbol, and its parameters rounded for reading. */
export interface Token {
  s: string;
  p: number[];
}

/** One step of the derivation, summed up. */
export interface StepSummary {
  modules: number;
  /** Drawn segments, tips and forks of the tree as it stood after this step. */
  segments: number;
  tips: number;
  forks: number;
  /** The deepest branch nesting. */
  depth: number;
  /** The word's first few dozen modules. */
  head: Token[];
  /** A small drawing of the tree at this step, front on, to the scale of the last: an SVG path for the trunk and one for the rest. */
  thumb: { trunk: string; rest: string };
}

/** One rewrite in a module's ancestry. */
export interface LineageStep {
  step: number;
  /** The ancestor's place in that step's word. */
  index: number;
  symbol: string;
  params: number[];
  /** The production that made it from its own ancestor (the source line), or null: the axiom, or copied unchanged. */
  rule: string | null;
  /** The word around it, and where it sits in that window. */
  window: Token[];
  at: number;
  /** Where the window starts in the word (for an ellipsis), and the word's length (for the other). */
  from: number;
  length: number;
}

export interface BranchDetail {
  step: number;
  node: number;
  /** The module that drew the picked segment. */
  module: number;
  symbol: string;
  params: number[];
  /** The bracketed group the branch is written in, as tokens; a long one is shortened, with a `…` token where it was. */
  group: Token[];
  /** Where the picked module sits within `group`. */
  at: number;
  lineage: LineageStep[];
}

/** Where each segment of a tree came from: when its wood was first drawn, and by which production. */
export interface Provenance {
  /** The rewrite after which the segment's wood was first drawn (0: it is in the axiom). */
  age: Uint8Array;
  /** The production that first drew it (an index into the productions), or -1 for the axiom. */
  rule: Int16Array;
}

const draws = (s: string | undefined) => s === 'F' || s === 'G';

const round = (v: number) => Math.round(v * 100) / 100;
const tokenOf = (m: Module): Token => ({ s: m.s, p: m.p.map(round) });

/** The tree view's front-on drawing box. */
const THUMB_W = 96;
const THUMB_H = 72;

export class Anatomy {
  readonly history: History;
  readonly productions: Production[];
  readonly issues: GrammarIssue[];
  readonly truncated: boolean;
  private readonly skeletons = new Map<number, Skeleton>();
  private readonly provenances = new Map<number, Provenance>();

  constructor(private readonly cfg: TreeConfig) {
    this.issues = [];
    const globals: EvalEnv = { ANG: cfg.angle, LEN: cfg.step, SHRINK: cfg.shrink, N: cfg.iterations, n: 0 };
    const parsed = parseRules(cfg.rules);
    this.issues.push(...parsed.errors);
    this.productions = parsed.productions;
    let axiom: Module[] = [];
    try {
      axiom = parseAxiom(cfg.axiom, globals);
    } catch (err) {
      this.issues.push({ line: 0, text: cfg.axiom, message: err instanceof Error ? err.message : String(err) });
    }
    const derived = derive(axiom, parsed.productions, {
      iterations: Math.max(0, Math.round(cfg.iterations)),
      globals,
      rng: mulberry32(cfg.seed),
      maxModules: cfg.maxModules,
      record: true,
    });
    this.history = derived.history!;
    this.truncated = derived.truncated;
  }

  /** How many rewrites there were: the words run from step 0 (the axiom) to this. */
  get steps(): number {
    return this.history.words.length - 1;
  }

  /** The tree as it stood after `n` rewrites: walked exactly as the garden's tree is. */
  skeleton(n: number): Skeleton {
    const step = Math.max(0, Math.min(this.steps, n));
    let s = this.skeletons.get(step);
    if (!s) {
      const cfg = this.cfg;
      s = interpret(this.history.words[step], {
        angle: cfg.angle,
        step: cfg.step,
        trunkRadius: cfg.trunkRadius,
        tropism: cfg.tropism,
        pipeModel: true,
        pipeExponent: cfg.pipeExponent,
        leafScale: cfg.leafScale,
        autoLeaves: false,
        ground: cfg.ground ?? false,
        taper: cfg.taper ?? 0,
        rng: mulberry32(cfg.seed + 1),
        maxSegments: cfg.maxSegments,
        recordAt: true,
      });
      this.skeletons.set(step, s);
    }
    return s;
  }

  /**
   * For every segment of the tree after `n` rewrites, when its wood first
   * appeared and which production put it there. A segment is followed back
   * through its module's ancestors for as long as they were themselves drawn
   * (an `F` carried over, or rewritten into another `F`, is the same wood
   * growing on); the first ancestor that drew nothing (an apex) is where it
   * began, and the production that rewrote that apex is what made it.
   */
  provenance(n: number): Provenance {
    const step = Math.max(0, Math.min(this.steps, n));
    let p = this.provenances.get(step);
    if (p) return p;
    const sk = this.skeleton(step);
    const { words, origin, rule: made } = this.history;
    const age = new Uint8Array(sk.count);
    const rule = new Int16Array(sk.count).fill(-1);
    for (let i = 0; i < sk.count; i++) {
      let a = sk.module[i];
      if (a < 0) continue;
      let k = step;
      while (k > 0) {
        const prev = origin[k - 1][a];
        if (draws(words[k - 1][prev]?.s)) {
          a = prev;
          k--;
          continue;
        }
        rule[i] = made[k - 1][a];
        break;
      }
      age[i] = Math.min(255, k);
    }
    p = { age, rule };
    this.provenances.set(step, p);
    return p;
  }

  /**
   * Where each node of the tree after `n` rewrites stood after `m` (fewer):
   * the node of that earlier tree the turtle was on when it read the module
   * this one descends from. A rewritten apex sprouts from where the apex
   * was; an `F` that became two starts as the one it was. This is what lets
   * one step of the derivation turn into the next in front of you.
   */
  ancestors(n: number, m: number): Int32Array {
    const big = this.skeleton(n);
    const small = this.skeleton(m);
    const { origin } = this.history;
    const at = small.at;
    const out = new Int32Array(big.count);
    for (let i = 0; i < big.count; i++) {
      let a = big.module[i];
      if (a < 0) continue;
      for (let k = n; k > m && a >= 0; k--) a = origin[k - 1][a];
      const node = at && a >= 0 ? at[a] : -1;
      out[i] = node >= 0 ? node : 0;
    }
    return out;
  }

  /** Every step summed up, with its small drawing, all to the scale of the finished tree. */
  summary(): StepSummary[] {
    const last = this.skeleton(this.steps);
    let minX = Infinity, maxX = -Infinity, maxY = 0;
    for (let i = 0; i < last.count; i++) {
      const x = last.pos[i * 3];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (last.pos[i * 3 + 1] > maxY) maxY = last.pos[i * 3 + 1];
    }
    const span = Math.max(maxX - minX, maxY / (THUMB_H / THUMB_W), 1e-3);
    const scale = (THUMB_W - 8) / span;
    const cx = (minX + maxX) / 2;
    const px = (x: number) => (THUMB_W / 2 + (x - cx) * scale).toFixed(1);
    const py = (y: number) => (THUMB_H - 3 - Math.max(0, y) * scale).toFixed(1);

    return this.history.words.map((word, n) => {
      const sk = this.skeleton(n);
      const children = new Uint16Array(sk.count);
      for (let i = 1; i < sk.count; i++) if (sk.parent[i] >= 0) children[sk.parent[i]]++;
      let segments = 0, tips = 0, forks = 0, depth = 0;
      // A long tree is drawn from a sample of its finest twigs, so the drawing stays small.
      const keep = Math.max(1, Math.ceil(sk.count / 700));
      let trunk = '';
      let rest = '';
      for (let i = 1; i < sk.count; i++) {
        const p = sk.parent[i];
        if (p < 0) continue;
        segments++;
        if (children[i] === 0) tips++;
        if (children[i] > 1) forks++;
        if (sk.order[i] > depth) depth = sk.order[i];
        if (sk.order[i] > 1 && i % keep) continue;
        const seg = `M${px(sk.pos[p * 3])} ${py(sk.pos[p * 3 + 1])}L${px(sk.pos[i * 3])} ${py(sk.pos[i * 3 + 1])}`;
        if (sk.order[i] === 0) trunk += seg;
        else rest += seg;
      }
      return {
        modules: word.length,
        segments,
        tips,
        forks,
        depth,
        head: word.slice(0, 48).map(tokenOf),
        thumb: { trunk, rest },
      };
    });
  }

  /** `count` modules of step `n`'s word, from `from`. */
  window(n: number, from: number, count: number): Token[] {
    return this.history.words[n].slice(Math.max(0, from), Math.max(0, from) + count).map(tokenOf);
  }

  /** Where module `index` of step `n` came from, at every step back to the axiom. */
  lineage(n: number, index: number, around = 14): LineageStep[] {
    const out: LineageStep[] = [];
    let at = index;
    for (let k = n; k >= 0; k--) {
      const word = this.history.words[k];
      const m = word[at];
      const rule = k > 0 ? this.history.rule[k - 1][at] : -1;
      const from = Math.max(0, at - around);
      out.unshift({
        step: k,
        index: at,
        symbol: m?.s ?? '?',
        params: (m?.p ?? []).map(round),
        rule: rule >= 0 ? this.productions[rule].src : null,
        window: word.slice(from, at + around + 1).map(tokenOf),
        at: at - from,
        from,
        length: word.length,
      });
      if (k > 0) at = this.history.origin[k - 1][at];
    }
    return out;
  }

  /** The bracketed group that module `index` of step `n` is written in: [start, end), brackets included. */
  group(n: number, index: number): [number, number] {
    const word = this.history.words[n];
    let start = 0;
    for (let i = index - 1, depth = 0; i >= 0; i--) {
      const s = word[i].s;
      if (s === ']') depth++;
      else if (s === '[') {
        if (depth === 0) {
          start = i;
          break;
        }
        depth--;
      }
    }
    let end = word.length;
    if (start > 0 || word[0]?.s === '[') {
      for (let i = start + 1, depth = 0; i < word.length; i++) {
        const s = word[i].s;
        if (s === '[') depth++;
        else if (s === ']') {
          if (depth === 0) {
            end = i + 1;
            break;
          }
          depth--;
        }
      }
    }
    return [start, end];
  }

  /** Everything the view says about the segment `node` of the tree at step `n`. */
  branch(n: number, node: number): BranchDetail | null {
    const sk = this.skeleton(n);
    const module = sk.module[node];
    if (module === undefined || module < 0) return null;
    const word = this.history.words[n];
    const [start, end] = this.group(n, module);
    // A long group keeps its head, the picked module's neighbourhood, and its close.
    const long = end - start > 64;
    let group: Token[];
    let at: number;
    if (!long) {
      group = word.slice(start, end).map(tokenOf);
      at = module - start;
    } else {
      const ELLIPSIS: Token = { s: '…', p: [] };
      const nearFrom = Math.max(start + 10, module - 12);
      const nearTo = Math.min(end, module + 13);
      const head = word.slice(start, Math.min(start + 10, nearFrom)).map(tokenOf);
      const near = word.slice(nearFrom, nearTo).map(tokenOf);
      const tail = nearTo < end - 4 ? word.slice(end - 4, end).map(tokenOf) : word.slice(nearTo, end).map(tokenOf);
      const gapBefore = nearFrom > start + head.length;
      const gapAfter = nearTo < end - 4;
      group = [...head, ...(gapBefore ? [ELLIPSIS] : []), ...near, ...(gapAfter ? [ELLIPSIS] : []), ...tail];
      at = head.length + (gapBefore ? 1 : 0) + (module - nearFrom);
    }
    return {
      step: n,
      node,
      module,
      symbol: word[module].s,
      params: word[module].p.map(round),
      group,
      at,
      lineage: this.lineage(n, module),
    };
  }
}
