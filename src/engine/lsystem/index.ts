import { mulberry32 } from '../../lib/rng';
import { derive } from './derive';
import type { EvalEnv } from './expr';
import { parseAxiom, parseRules } from './grammar';
import { interpret, type Skeleton } from './turtle';

export type { Module, Production } from './grammar';
export type { Skeleton, LeafPlacement } from './turtle';
export * from './presets';

export interface TreeConfig {
  axiom: string;
  rules: string;
  iterations: number;
  angle: number;
  step: number;
  shrink: number;
  trunkRadius: number;
  tropism: number;
  pipeExponent: number;
  leafScale: number;
  seed: number;
  autoLeaves?: boolean;
  maxModules?: number;
  maxSegments?: number;
}

export interface GrammarIssue {
  line: number;
  text: string;
  message: string;
}

export interface TreeBuild {
  skeleton: Skeleton | null;
  issues: GrammarIssue[];
  stats: {
    modules: number;
    nodes: number;
    leaves: number;
    steps: number;
    truncated: boolean;
    /** Milliseconds spent deriving and interpreting. */
    ms: number;
  };
}

export function buildTree(cfg: TreeConfig): TreeBuild {
  const t0 = performance.now();
  const issues: GrammarIssue[] = [];

  const globals: EvalEnv = {
    ANG: cfg.angle,
    LEN: cfg.step,
    SHRINK: cfg.shrink,
    N: cfg.iterations,
    n: 0,
  };

  const parsed = parseRules(cfg.rules);
  issues.push(...parsed.errors);

  let axiom;
  try {
    axiom = parseAxiom(cfg.axiom, globals);
  } catch (err) {
    issues.push({ line: 0, text: cfg.axiom, message: err instanceof Error ? err.message : String(err) });
    return { skeleton: null, issues, stats: { modules: 0, nodes: 0, leaves: 0, steps: 0, truncated: false, ms: 0 } };
  }

  const rng = mulberry32(cfg.seed);
  const derived = derive(axiom, parsed.productions, {
    iterations: Math.max(0, Math.round(cfg.iterations)),
    globals,
    rng,
    maxModules: cfg.maxModules,
  });

  const skeleton = interpret(derived.word, {
    angle: cfg.angle,
    step: cfg.step,
    trunkRadius: cfg.trunkRadius,
    tropism: cfg.tropism,
    pipeModel: true,
    pipeExponent: cfg.pipeExponent,
    leafScale: cfg.leafScale,
    autoLeaves: cfg.autoLeaves ?? true,
    rng,
    maxSegments: cfg.maxSegments,
  });

  return {
    skeleton,
    issues,
    stats: {
      modules: derived.word.length,
      nodes: skeleton.count,
      leaves: skeleton.leaves.length,
      steps: derived.steps,
      truncated: derived.truncated || skeleton.truncated,
      ms: performance.now() - t0,
    },
  };
}
