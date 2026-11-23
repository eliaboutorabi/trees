/**
 * The L-system view's state: which tree's history is loaded, which step of
 * it is on show, which branch is picked and what is known about it.
 *
 * It asks the anatomy worker and tells the studio; the panel, the stem and
 * the annotations only read it. Every request is numbered, so a slow answer
 * for something no longer wanted (a step already left, a tree replaced) is
 * dropped rather than shown.
 */
import { AnatomyClient, type AnatomyOverview, type BranchDetail, type SkeletonData, type TreeStructure } from '../../engine';

export interface XrayHost {
  showSkeleton(data: SkeletonData, seconds: number): void;
  selectBranch(node: number): void;
}

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
  /** The skeleton on show, for the annotations. */
  skeleton = $state.raw<SkeletonData | null>(null);

  private readonly client = new AnatomyClient();
  private key = '';
  private ticket = 0;
  private timer = 0;

  constructor(private readonly host: XrayHost) {}

  get steps(): number {
    return this.overview?.steps ?? 0;
  }

  /**
   * The tree to study. Loading the same structure again does nothing; a new
   * one replaces the old and shows its last step, grown in.
   */
  async load(params: TreeStructure, grow = 1.4): Promise<void> {
    const key = JSON.stringify(params);
    if (key === this.key && this.overview) return;
    this.key = key;
    const ticket = ++this.ticket;
    this.loading = true;
    this.stop();
    try {
      const overview = await this.client.load(params);
      if (ticket !== this.ticket) return;
      this.overview = overview;
      this.clear();
      await this.show(overview.steps, grow, ticket);
    } finally {
      if (ticket === this.ticket) this.loading = false;
    }
  }

  /** Show the tree after `n` rewrites. */
  async show(n: number, grow = 0.7, ticket = ++this.ticket): Promise<void> {
    const steps = this.steps;
    const step = Math.max(0, Math.min(steps, Math.round(n)));
    this.step = step;
    this.clear();
    const data = await this.client.skeleton(step);
    if (ticket !== this.ticket) return;
    this.skeleton = data;
    this.host.showSkeleton(data, grow);
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

  /** Play the derivation from the axiom to the last step, a rewrite at a time. */
  play(onStep?: (n: number) => void): void {
    this.stop();
    const steps = this.steps;
    if (steps === 0) return;
    this.playing = true;
    // A long derivation goes quicker, so the whole of it is a few seconds.
    const each = Math.max(380, Math.min(1000, 9000 / steps));
    let n = 0;
    const next = () => {
      if (!this.playing) return;
      void this.show(n, Math.min(0.9, (each / 1000) * 0.85));
      onStep?.(n);
      n++;
      if (n > steps) {
        this.playing = false;
        return;
      }
      this.timer = window.setTimeout(next, each);
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
