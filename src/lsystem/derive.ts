/** Parallel rewriting: apply productions to every module, `iterations` times. */
import type { Rng } from '../lib/rng';
import type { EvalEnv } from './expr';
import type { Module, Production } from './grammar';

export interface DeriveResult {
  word: Module[];
  /** True when the module budget stopped derivation early. */
  truncated: boolean;
  /** Number of iterations actually completed. */
  steps: number;
}

export interface DeriveOptions {
  iterations: number;
  globals: EvalEnv;
  rng: Rng;
  /** Hard ceiling on word length, so a runaway grammar can't hang the tab. */
  maxModules?: number;
}

export function derive(axiom: Module[], productions: Production[], opts: DeriveOptions): DeriveResult {
  const { iterations, globals, rng } = opts;
  const maxModules = opts.maxModules ?? 250_000;

  const bySymbol = new Map<string, Production[]>();
  for (const p of productions) {
    const list = bySymbol.get(p.pred);
    if (list) list.push(p);
    else bySymbol.set(p.pred, [p]);
  }

  let word = axiom;
  let truncated = false;
  let steps = 0;

  // Reused across modules to avoid allocating an env object per rewrite.
  const env: EvalEnv = Object.create(null);
  const matched: Production[] = [];
  const weights: number[] = [];

  for (let step = 0; step < iterations; step++) {
    const next: Module[] = [];
    for (const m of word) {
      const candidates = bySymbol.get(m.s);
      if (!candidates) {
        next.push(m);
        continue;
      }

      for (const key in env) delete env[key];
      Object.assign(env, globals);
      env.n = step;

      matched.length = 0;
      weights.length = 0;
      for (const rule of candidates) {
        if (rule.params.length !== m.p.length) continue;
        for (let i = 0; i < rule.params.length; i++) env[rule.params[i]] = m.p[i];
        if (rule.cond && rule.cond(env, rng) === 0) continue;
        matched.push(rule);
        weights.push(rule.prob ? Math.max(0, rule.prob(env, rng)) : 0);
      }

      if (matched.length === 0) {
        next.push(m);
        continue;
      }

      // Rules are tried in declaration order, so the first match wins. The
      // exception is stochastic variants: when the first match carries an
      // explicit `@probability`, every matching rule that declares one is
      // pooled and drawn from by weight.
      let chosen = matched[0];
      if (matched.length > 1 && matched[0].prob) {
        let total = 0;
        for (let i = 0; i < matched.length; i++) if (matched[i].prob) total += weights[i];
        if (total > 0) {
          let r = rng() * total;
          for (let i = 0; i < matched.length; i++) {
            if (!matched[i].prob) continue;
            r -= weights[i];
            if (r <= 0) {
              chosen = matched[i];
              break;
            }
          }
        }
      }

      // Rebind the chosen rule's parameters — earlier candidates may have
      // left different names in the shared env.
      for (let i = 0; i < chosen.params.length; i++) env[chosen.params[i]] = m.p[i];

      for (const t of chosen.succ) {
        const p = new Array<number>(t.args.length);
        for (let i = 0; i < t.args.length; i++) p[i] = t.args[i](env, rng);
        next.push({ s: t.s, p });
      }

      if (next.length > maxModules) {
        truncated = true;
        break;
      }
    }

    word = next;
    steps = step + 1;
    if (truncated) break;
  }

  return { word, truncated, steps };
}
