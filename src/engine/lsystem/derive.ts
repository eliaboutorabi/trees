/** Parallel rewriting: apply productions to every module, `iterations` times. */
import type { Rng } from '../../lib/rng';
import type { EvalEnv } from './expr';
import type { Module, Production } from './grammar';

export interface DeriveResult {
  word: Module[];
  /** True when the module budget stopped derivation early. */
  truncated: boolean;
  /** Number of iterations actually completed. */
  steps: number;
  /** With `record`: how the word came to be. See `History`. */
  history?: History;
}

/**
 * Every word along the way, and where each module of each came from:
 * `origin[n][j]` is the module of `words[n]` that module `j` of `words[n + 1]`
 * was rewritten from (or copied from, when no rule applied), and `rule[n][j]`
 * the index of the production that did it, or -1 for a copy.
 */
export interface History {
  words: Module[][];
  origin: Int32Array[];
  rule: Int16Array[];
}

export interface DeriveOptions {
  iterations: number;
  globals: EvalEnv;
  rng: Rng;
  /** Hard ceiling on word length, so a runaway grammar can't hang the tab. */
  maxModules?: number;
  /** Keep every word, and where each module came from. Same rewriting, same random draws. */
  record?: boolean;
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
  const ruleIndex = new Map(productions.map((p, i) => [p, i]));
  const history: History | undefined = opts.record ? { words: [axiom], origin: [], rule: [] } : undefined;
  const from: number[] = [];
  const by: number[] = [];

  // Reused across modules to avoid allocating an env object per rewrite.
  const env: EvalEnv = Object.create(null);
  const matched: Production[] = [];
  const weights: number[] = [];

  for (let step = 0; step < iterations; step++) {
    const next: Module[] = [];
    from.length = 0;
    by.length = 0;
    for (let at = 0; at < word.length; at++) {
      const m = word[at];
      const candidates = bySymbol.get(m.s);
      if (!candidates) {
        next.push(m);
        if (history) {
          from.push(at);
          by.push(-1);
        }
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
        if (history) {
          from.push(at);
          by.push(-1);
        }
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

      const used = ruleIndex.get(chosen) ?? -1;
      for (const t of chosen.succ) {
        const p = new Array<number>(t.args.length);
        for (let i = 0; i < t.args.length; i++) p[i] = t.args[i](env, rng);
        next.push({ s: t.s, p });
        if (history) {
          from.push(at);
          by.push(used);
        }
      }

      if (next.length > maxModules) {
        truncated = true;
        break;
      }
    }

    word = next;
    steps = step + 1;
    if (history) {
      history.words.push(next);
      history.origin.push(Int32Array.from(from));
      history.rule.push(Int16Array.from(by));
    }
    if (truncated) break;
  }

  return { word, truncated, steps, history };
}
