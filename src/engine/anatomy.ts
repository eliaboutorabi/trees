/**
 * Asking about a tree's anatomy: how its grammar grew it, step by step.
 *
 * The anatomy itself lives on a worker (`anatomy.worker.ts`); this is the
 * page's side, a few promises. Load a tree's structure once, then ask for
 * the skeleton after any number of rewrites, or everything about one branch.
 */
import type { TreeStructure } from './build';
import type { GrammarIssue } from './lsystem';
import type { BranchDetail, StepSummary } from './lsystem/anatomy';
import type { AnatomyRequest } from './anatomy.worker';

export type { BranchDetail, LineageStep, StepSummary, Token } from './lsystem/anatomy';

/** A tree's history, summed up: what the page shows before anything is picked. */
export interface AnatomyOverview {
  steps: number;
  truncated: boolean;
  issues: GrammarIssue[];
  productions: { pred: string; src: string }[];
  summary: StepSummary[];
  /** Every symbol that appears, for the legend. */
  symbols: string[];
}

/** The tree after some number of rewrites, as plain arrays. */
export interface SkeletonData {
  step: number;
  count: number;
  pos: Float32Array;
  parent: Int32Array;
  radius: Float32Array;
  /** How many brackets deep each node was drawn. */
  order: Uint8Array;
  /** Which module of the word drew each node. */
  module: Int32Array;
  height: number;
  radiusXZ: number;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type Ask = AnatomyRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

export class AnatomyClient {
  private worker: Worker | null = null;
  private next = 1;
  private readonly pending = new Map<number, Pending>();

  private ask<T>(req: Ask): Promise<T> {
    if (!this.worker) {
      this.worker = new Worker(new URL('./anatomy.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        if (e.data.error) p.reject(new Error(e.data.error));
        else p.resolve(e.data.result);
      };
    }
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker!.postMessage({ ...req, id });
    });
  }

  /** Derive a tree's whole history, and sum it up. */
  load(params: TreeStructure, maxModules = 250_000): Promise<AnatomyOverview> {
    return this.ask({ kind: 'load', params: { ...params }, maxModules });
  }

  /** The tree after `n` rewrites. */
  skeleton(n: number): Promise<SkeletonData> {
    return this.ask({ kind: 'skeleton', n });
  }

  /** Everything about the segment `node` of the tree after `n` rewrites: its symbols, and how it came to be. */
  branch(n: number, node: number): Promise<BranchDetail | null> {
    return this.ask({ kind: 'branch', n, node });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(new Error('disposed'));
    this.pending.clear();
  }
}
