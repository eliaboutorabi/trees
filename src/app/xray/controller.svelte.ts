/**
 * The L-system view's state: which tree's history is loaded, which step of
 * it is on show, which branch is picked and what is known about it.
 *
 * It asks the anatomy worker and tells the studio; the panel, the stem and
 * the tag only read it. Every request is numbered, so a slow answer for
 * something no longer wanted (a step already left, a tree replaced) is
 * dropped rather than shown.
 */
import { AnatomyClient, type AnatomyOverview, type BranchDetail, type SkeletonData, type TreeStructure } from '../../engine';

export interface XrayHost {
  /** Show a tree, turned into from the one on show over `seconds` (0: at once). */
  showSkeleton(data: SkeletonData, seconds: number): void;
  selectBranch(node: number): void;
}

/** How long one step takes to turn into the next; a jump of several, a little longer. */
const STEP_SECONDS = 0.55;

export class XrayController {
  overview = $state.raw<AnatomyOverview | null>(null);
  /** The step on show: the tree after this many rewrites. */
  step = $state(0);
  /** The picked branch (the node at the end of the picked segment), or -1. */
  picked = $state(-1);
  detail = $state.raw<BranchDetail | null>(null);
  loading = $state(false);
  /** The derivation playing itself, step by step. */
  playing = $state(false);
  /** The skeleton on show. */
  skeleton = $state.raw<SkeletonData | null>(null);

  private readonly client = new AnatomyClient();
  private key = '';
  private ticket = 0;
  private timer = 0;
  /** The step whose tree the studio has, so the next can be turned from it. */
  private onShow = -1;
  private pending: Promise<void> | null = null;

  constructor(private readonly host: XrayHost) {}

  get steps(): number {
    return this.overview?.steps ?? 0;
  }

  /**
   * The tree to study. Loading the same structure again does nothing (and
   * waits for a load of it already under way); a new one replaces the old
   * and shows its last step, faded in over `seconds` (0: at once).
   */
  load(params: TreeStructure, seconds = 0.4): Promise<void> {
    const key = JSON.stringify(params);
    if (key === this.key && (this.overview || this.pending)) return this.pending ?? Promise.resolve();
    this.key = key;
    const ticket = ++this.ticket;
    this.loading = true;
    this.stop();
    const run = (async () => {
      try {
        const overview = await this.client.load(params);
        if (ticket !== this.ticket) return;
        this.overview = overview;
        this.onShow = -1;
        this.clear();
        await this.show(overview.steps, seconds, ticket);
      } finally {
        if (ticket === this.ticket) {
          this.loading = false;
          this.pending = null;
        }
      }
    })();
    this.pending = run;
    return run;
  }

  /**
   * Show the tree after `n` rewrites, turned into from the step on show:
   * forward it grows out of it, back it draws in. Resolves once it is handed
   * over (the turning itself takes `seconds` more).
   */
  async show(n: number, seconds?: number, ticket = ++this.ticket): Promise<void> {
    const steps = this.steps;
    const step = Math.max(0, Math.min(steps, Math.round(n)));
    this.step = step;
    this.clear();
    const from = this.onShow;
    const data = await this.client.skeleton(step, from >= 0 && from !== step ? from : undefined);
    if (ticket !== this.ticket) return;
    const span = from >= 0 ? Math.abs(step - from) : 0;
    const time = seconds ?? (span === 0 ? 0 : STEP_SECONDS + Math.min(0.35, (span - 1) * 0.06));
    this.skeleton = data;
    this.onShow = step;
    this.host.showSkeleton(data, time);
  }

  /** Pick a branch by the node at the end of one of its segments, or nothing with -1. */
  async pick(node: number): Promise<void> {
    this.picked = node;
    this.host.selectBranch(node);
    if (node < 0) {
      this.detail = null;
      return;
    }
    const ticket = this.ticket;
    const step = this.step;
    const detail = await this.client.branch(step, node);
    if (ticket !== this.ticket || this.picked !== node) return;
    this.detail = detail;
  }

  clear(): void {
    this.picked = -1;
    this.detail = null;
    this.host.selectBranch(-1);
  }

  /** Play the derivation from the axiom to the last step, one rewrite turning into the next. */
  play(onStep?: (n: number) => void): void {
    this.stop();
    const steps = this.steps;
    if (steps === 0) return;
    this.playing = true;
    // A long derivation goes quicker, so the whole of it is a handful of seconds.
    const each = Math.max(560, Math.min(1100, 11000 / steps));
    let n = 0;
    const next = () => {
      if (!this.playing) return;
      // The axiom first, at once; then each rewrite grows out of the one before.
      void this.show(n, n === 0 ? 0.25 : Math.min(0.75, (each / 1000) * 0.72));
      onStep?.(n);
      n++;
      if (n > steps) {
        this.playing = false;
        return;
      }
      this.timer = window.setTimeout(next, n === 1 ? 500 : each);
    };
    next();
  }

  stop(): void {
    this.playing = false;
    clearTimeout(this.timer);
  }

  dispose(): void {
    this.stop();
    this.client.dispose();
  }
}
