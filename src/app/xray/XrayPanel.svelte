<script lang="ts">
  /**
   * The L-system view's page of notes, down the left: the grammar, typeset;
   * the rewriting, step by step, each with a small drawing of the tree as it
   * stood; and, once a branch is picked, the branch: the symbols it is
   * written in, and how it came to be, rewrite by rewrite, back to the axiom.
   */
  import type { LineageStep, StepSummary } from '../../engine';
  import type { XrayController } from './controller.svelte';
  import Word from './Word.svelte';
  import { LEGEND, parseRule, prettyArgs, type Piece } from './symbols';

  interface Props {
    x: XrayController;
    axiom: string;
    species: string;
    constants: { name: string; value: string }[];
    night: boolean;
    onstep: (n: number) => void;
    /** Pick the branch the picked one grows from. */
    onwider: () => void;
  }

  let { x, axiom, species, constants, night, onstep, onwider }: Props = $props();

  type Tab = 'grammar' | 'rewriting' | 'branch';
  let tab = $state<Tab>('rewriting');
  let lastPicked = -1;
  // A branch picked opens its page; let go, back to the rewriting.
  $effect(() => {
    const picked = x.picked;
    if (picked >= 0 && picked !== lastPicked) tab = 'branch';
    if (picked < 0 && tab === 'branch') tab = 'rewriting';
    lastPicked = picked;
  });

  const overview = $derived(x.overview);
  const steps = $derived(overview?.summary ?? []);
  const rules = $derived((overview?.productions ?? []).map((p) => ({ src: p.src, rule: parseRule(p.src) })));
  const axiomPieces = $derived(parseRule(`ω -> ${axiom}`)?.succ ?? []);
  const nonterminals = $derived((overview?.symbols ?? []).filter((s) => /[A-Za-z]/.test(s) && !'FGfLKT'.includes(s)));
  const legend = $derived(LEGEND.filter((row) => row.symbols.some((s) => overview?.symbols.includes(s))));
  /** The rules a picked branch was made by, to mark in the grammar. */
  const usedRules = $derived(new Set((x.detail?.lineage ?? []).map((l) => l.rule).filter((r): r is string => !!r)));
  const fmt = (n: number) => n.toLocaleString('en');

  /**
   * The ancestry, with each run of plain copies (a module carried over
   * unchanged, step after step) folded into one line.
   */
  const ancestry = $derived.by(() => {
    const lineage = x.detail?.lineage ?? [];
    const out: { step: LineageStep; until: number }[] = [];
    for (const l of lineage) {
      const prev = out[out.length - 1];
      if (prev && !l.rule && prev.step.symbol === l.symbol && l.step > 0) {
        prev.until = l.step;
        continue;
      }
      out.push({ step: l, until: l.step });
    }
    return out;
  });

  /** The picked segment, measured: its length, its depth, how far up the tree, the angle it leaves its parent at. */
  const facts = $derived.by(() => {
    const sk = x.skeleton;
    const node = x.picked;
    if (!sk || node < 1 || node >= sk.count) return null;
    const p = sk.parent[node];
    if (p < 0) return null;
    const v = (i: number) => [sk.pos[i * 3], sk.pos[i * 3 + 1], sk.pos[i * 3 + 2]];
    const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const len = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
    const seg = sub(v(node), v(p));
    // The branch's first segment, and the one it left at the fork.
    let start = node;
    while (sk.parent[start] >= 0 && sk.order[sk.parent[start]] === sk.order[node]) start = sk.parent[start];
    const fork = sk.parent[start];
    let theta: number | null = null;
    if (fork >= 0 && sk.parent[fork] >= 0) {
      const a = sub(v(start), v(fork));
      const b = sub(v(fork), v(sk.parent[fork]));
      const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b) || 1);
      theta = (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
    }
    let up = 0;
    for (let i = node; sk.parent[i] >= 0; i = sk.parent[i]) up += len(sub(v(i), v(sk.parent[i])));
    return { length: len(seg), depth: sk.order[node], theta, up };
  });

  const ruleOf = (src: string | null) => (src ? parseRule(src) : null);

  // The step on show stays in sight in the list, as it plays or is picked on the stem.
  let list = $state<HTMLElement>();
  $effect(() => {
    const n = x.step;
    if (tab !== 'rewriting' || !list) return;
    list.querySelectorAll('.step')[n]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
</script>

{#snippet ruleLine(rule: ReturnType<typeof parseRule>, small?: boolean)}
  {#if rule}
    <span class="rule" class:small>
      <Word items={[rule.pred]} params="all" size={small ? 'small' : 'normal'} />
      <span class="arrow">→</span>
      <Word items={rule.succ as Piece[]} size={small ? 'small' : 'normal'} />
    </span>
  {/if}
{/snippet}

<aside class="xray-panel xray-theme" class:night aria-label="The L-system">
  <header>
    <h2>L-system</h2>
    <p class="sub">
      {species}
      {#if overview}· {overview.steps} rewrites · {fmt(steps[steps.length - 1]?.modules ?? 0)} modules{/if}
    </p>
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'grammar'} class:on={tab === 'grammar'} onclick={() => (tab = 'grammar')}>Grammar</button>
      <button role="tab" aria-selected={tab === 'rewriting'} class:on={tab === 'rewriting'} onclick={() => (tab = 'rewriting')}>Rewriting</button>
      <button role="tab" aria-selected={tab === 'branch'} class:on={tab === 'branch'} disabled={x.picked < 0} onclick={() => (tab = 'branch')}>Branch</button>
    </div>
  </header>

  <div class="body">
    {#if !overview}
      <p class="quiet">Reading the grammar…</p>
    {:else if tab === 'grammar'}
      <section>
        <span class="chip">Axiom</span>
        <div class="axiom"><span class="omega">ω</span><span class="eq">=</span><Word items={axiomPieces} params="all" size="large" /></div>
      </section>
      <section>
        <span class="chip">Productions</span>
        <ol class="rules">
          {#each rules as r, i (i)}
            {#if r.rule}
              <li class:used={usedRules.has(r.src)}>
                {@render ruleLine(r.rule)}
                {#if r.rule.cond || r.rule.prob}
                  <span class="when">
                    {#if r.rule.cond}when {prettyArgs(r.rule.cond)}{/if}
                    {#if r.rule.prob}{r.rule.cond ? ' · ' : ''}with p = {prettyArgs(r.rule.prob)}{/if}
                  </span>
                {/if}
              </li>
            {/if}
          {/each}
        </ol>
      </section>
      <section>
        <span class="chip">Constants</span>
        <div class="constants">
          {#each constants as k (k.name)}
            <span><i>{k.name}</i> = {k.value}</span>
          {/each}
        </div>
      </section>
      <section>
        <h3>Reading the tree</h3>
        <dl class="legend">
          {#each legend as row (row.meaning + row.symbols.join(''))}
            <dt><Word items={row.symbols.map((s) => ({ s }))} /></dt>
            <dd>{row.meaning}</dd>
          {/each}
          {#if nonterminals.length}
            <dt><Word items={nonterminals.map((s) => ({ s }))} /></dt>
            <dd>rewritten each step; the turtle passes over them</dd>
          {/if}
        </dl>
      </section>
    {:else if tab === 'rewriting'}
      <p class="formula"><i>w</i><sub>0</sub> = <i>ω</i>, &nbsp; <i>w</i><sub><i>n</i>+1</sub> = <i>P</i>(<i>w</i><sub><i>n</i></sub>)</p>
      <ol class="steps" bind:this={list}>
        {#each steps as s, n (n)}
          {@const anc = x.detail && n <= x.detail.step ? x.detail.lineage[n] : null}
          <li>
            <button class="step" class:on={n === x.step} onclick={() => onstep(n)} aria-label="Show the tree after {n} rewrites">
              <span class="n"><i>n</i> = {n}</span>
              {@render thumb(s)}
              <span class="text">
                {#if anc}
                  <Word items={anc.from > 0 ? [{ s: '…' }, ...anc.window] : anc.window} at={anc.at + (anc.from > 0 ? 1 : 0)} line size="small" />
                {:else}
                  <Word items={s.head} line size="small" />
                {/if}
                <span class="count">{fmt(s.modules)} modules · {fmt(s.segments)} segments</span>
              </span>
            </button>
          </li>
        {/each}
      </ol>
      {#if steps[x.step]}
        {@const s = steps[x.step]}
        <p class="graph">
          <span class="formula"><i>T</i>(<i>w</i><sub>{x.step}</sub>) = <i>G</i><sub>{x.step}</sub> = (<i>V</i>, <i>E</i>)</span>
          <span class="quiet">|<i>V</i>| = {fmt(s.segments + 1)}, |<i>E</i>| = {fmt(s.segments)}: {fmt(s.forks)} forks, {fmt(s.tips)} tips, {s.depth} brackets deep</span>
        </p>
      {/if}
    {:else if tab === 'branch'}
      {#if x.detail}
        {@const d = x.detail}
        <section>
          <div class="branch-head">
            <span class="chip lit">Selected branch</span>
            <span class="actions">
              {#if facts && facts.depth > 0}
                <button class="clear" onclick={onwider} title="The branch this one grows from">Step out ↑</button>
              {/if}
              <button class="clear" onclick={() => void x.pick(-1)} aria-label="Let go of the branch">Let go</button>
            </span>
          </div>
          <div class="group"><Word items={d.group} at={d.at} params="at" size="large" /></div>
          <p class="quiet">
            The bracketed group it is written in, in <i>w</i><sub>{d.step}</sub>; the lit
            <Word items={[{ s: d.symbol }]} size="small" /> drew the segment you picked.
          </p>
          {#if facts}
            <dl class="facts">
              <dt>depth</dt>
              <dd>{facts.depth} bracket{facts.depth === 1 ? '' : 's'}</dd>
              <dt>segment</dt>
              <dd>{facts.length.toFixed(2)} long</dd>
              {#if facts.theta !== null}
                <dt>angle</dt>
                <dd><i>θ</i> = {facts.theta.toFixed(0)}° from its parent</dd>
              {/if}
              <dt>from the root</dt>
              <dd>{facts.up.toFixed(1)} along the path</dd>
            </dl>
          {/if}
        </section>
        <section>
          <h3>How this branch grew</h3>
          <ol class="lineage">
            {#each ancestry as a (a.step.step)}
              {@const l = a.step}
              <li>
                <span class="n">{a.until > l.step ? `${l.step}–${a.until}` : l.step}</span>
                <span class="text">
                  <Word items={l.from > 0 ? [{ s: '…' }, ...l.window] : l.window} at={l.at + (l.from > 0 ? 1 : 0)} params="at" line size="small" />
                  {#if l.rule}
                    <span class="by">by {@render ruleLine(ruleOf(l.rule), true)}</span>
                  {:else if l.step === 0}
                    <span class="by">the axiom</span>
                  {:else}
                    <span class="by">carried over unchanged</span>
                  {/if}
                </span>
              </li>
            {/each}
          </ol>
        </section>
      {:else}
        <p class="quiet">Pick a branch on the tree to see how it grew.</p>
      {/if}
    {/if}
  </div>
</aside>

{#snippet thumb(s: StepSummary)}
  <svg class="thumb" viewBox="0 0 96 72" aria-hidden="true">
    <ellipse cx="48" cy="69.5" rx="26" ry="2.2" class="ground" />
    <path d={s.thumb.rest} class="rest" />
    <path d={s.thumb.trunk} class="trunk" />
  </svg>
{/snippet}

<style>
  .xray-panel {
    position: absolute;
    left: 5.1rem;
    top: 5.2rem;
    bottom: 6.6rem;
    z-index: 6;
    width: 24rem;
    display: flex;
    flex-direction: column;
    border-radius: 20px 17px 21px 16px;
    background: var(--x-glass);
    backdrop-filter: var(--frost);
    -webkit-backdrop-filter: var(--frost);
    box-shadow: var(--x-rim), 0 18px 40px rgba(10, 8, 6, 0.22);
    color: var(--x-ink);
    overflow: hidden;
    animation: arrive 0.5s cubic-bezier(0.25, 0.9, 0.3, 1.1) both;
  }

  @keyframes arrive {
    from {
      opacity: 0;
      transform: translateX(-18px) rotate(-0.6deg);
    }
  }

  header {
    padding: 1rem 1.2rem 0;
  }

  h2 {
    margin: 0;
    font-family: var(--serif);
    font-size: 1.75rem;
    font-weight: 560;
    font-variation-settings: 'SOFT' 100, 'opsz' 48;
    letter-spacing: -0.01em;
  }

  .sub {
    margin: 0.1rem 0 0.7rem;
    font-size: 0.82rem;
    color: var(--x-dim);
  }

  .tabs {
    display: flex;
    gap: 0.3rem;
    padding-bottom: 0.55rem;
    border-bottom: 1px solid var(--x-line);
  }
  .tabs button {
    border: none;
    background: transparent;
    font-family: var(--serif);
    font-size: 0.95rem;
    font-weight: 500;
    color: var(--x-dim);
    padding: 0.3rem 0.75rem 0.35rem;
    border-radius: 11px 9px 12px 8px;
    cursor: pointer;
    transition:
      background-color 0.2s,
      color 0.2s;
  }
  .tabs button:hover:not(:disabled) {
    color: var(--x-ink);
  }
  .tabs button.on {
    color: var(--x-ink);
    background: var(--x-tab);
    box-shadow: inset 0 -2px 0 var(--x-accent);
  }
  .tabs button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .body {
    flex: 1;
    overflow-y: auto;
    padding: 0.8rem 1.2rem 1.2rem;
    scrollbar-width: thin;
    scrollbar-color: var(--x-line) transparent;
  }

  section + section {
    margin-top: 1.1rem;
    padding-top: 0.9rem;
    border-top: 1px solid var(--x-line);
  }

  h3 {
    margin: 0 0 0.5rem;
    font-family: var(--serif);
    font-size: 1.12rem;
    font-weight: 560;
    font-variation-settings: 'SOFT' 100;
  }

  .chip {
    display: inline-block;
    margin-bottom: 0.4rem;
    padding: 0.12rem 0.6rem;
    border-radius: 999px;
    font-family: var(--serif);
    font-size: 0.8rem;
    font-weight: 560;
    color: var(--x-ink);
    background: var(--x-chip);
  }
  .chip.lit {
    background: var(--x-lit-wash);
    box-shadow: 0 0 0 1px var(--x-lit-line);
    color: var(--x-lit-ink);
  }

  .axiom {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin: 0.1rem 0 0.2rem;
  }
  .omega,
  .eq {
    font-family: var(--serif);
    font-size: 1.5rem;
    font-style: italic;
    color: var(--x-dim);
  }
  .eq {
    font-style: normal;
  }

  .rules {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .rules li {
    padding: 0.3rem 0.5rem;
    margin: 0 -0.5rem;
    border-radius: 10px;
    transition: background-color 0.3s;
  }
  .rules li.used {
    background: var(--x-lit-wash);
  }
  .rule {
    display: inline;
  }
  .arrow {
    margin: 0 0.35rem;
    font-family: var(--serif);
    color: var(--x-dim);
  }
  .rule.small .arrow {
    margin: 0 0.2rem;
    font-size: 0.85rem;
  }
  .when {
    display: block;
    font-size: 0.76rem;
    font-style: italic;
    color: var(--x-dim);
    font-family: var(--serif);
  }

  .constants {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.9rem;
    font-family: var(--serif);
    font-size: 0.92rem;
    color: var(--x-ink);
  }
  .constants i {
    color: var(--x-grows);
    font-style: normal;
    font-size: 0.78rem;
    letter-spacing: 0.04em;
  }

  .legend {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.25rem 0.9rem;
    margin: 0;
    align-items: baseline;
  }
  .legend dt {
    margin: 0;
    padding: 0.05rem 0.45rem;
    border-radius: 8px;
    background: var(--x-chip);
    text-align: center;
    min-width: 2.2rem;
  }
  .legend dd {
    margin: 0;
    font-size: 0.88rem;
    color: var(--x-dim);
  }

  .formula {
    margin: 0 0 0.7rem;
    font-family: var(--serif);
    font-size: 1.12rem;
    color: var(--x-ink);
  }
  .formula sub {
    font-size: 0.65em;
  }

  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .step {
    display: grid;
    grid-template-columns: 3.1rem 4.2rem 1fr;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.3rem 0.45rem;
    border: none;
    border-radius: 12px 10px 13px 9px;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.2s;
  }
  .step:hover {
    background: var(--x-hover);
  }
  .step.on {
    background: var(--x-tab);
    box-shadow: inset 3px 0 0 var(--x-accent);
  }
  .n {
    font-family: var(--serif);
    font-size: 0.9rem;
    color: var(--x-dim);
    white-space: nowrap;
  }
  .step.on .n {
    color: var(--x-ink);
    font-weight: 600;
  }
  .text {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .count {
    font-size: 0.72rem;
    color: var(--x-faint);
    font-variant-numeric: tabular-nums;
  }

  .thumb {
    width: 4.2rem;
    height: 3.15rem;
    overflow: visible;
  }
  .thumb .ground {
    fill: var(--x-line);
  }
  .thumb .rest {
    fill: none;
    stroke: var(--x-thumb);
    stroke-width: 0.55;
    stroke-linecap: round;
  }
  .thumb .trunk {
    fill: none;
    stroke: var(--x-thumb-trunk);
    stroke-width: 1.6;
    stroke-linecap: round;
  }

  .graph {
    margin: 0.9rem 0 0;
    padding-top: 0.8rem;
    border-top: 1px solid var(--x-line);
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .graph .formula {
    margin: 0;
  }

  .quiet {
    font-size: 0.82rem;
    color: var(--x-dim);
    line-height: 1.45;
  }

  .branch-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .actions {
    display: flex;
    gap: 0.3rem;
  }
  .clear {
    border: none;
    background: var(--x-chip);
    color: var(--x-dim);
    font-family: var(--serif);
    font-size: 0.78rem;
    padding: 0.15rem 0.65rem;
    border-radius: 999px;
    cursor: pointer;
  }
  .clear:hover {
    color: var(--x-ink);
  }
  .group {
    margin: 0.2rem 0 0.4rem;
  }

  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.2rem 0.9rem;
    margin: 0.6rem 0 0;
    font-size: 0.86rem;
  }
  .facts dt {
    color: var(--x-faint);
    font-family: var(--serif);
    font-style: italic;
  }
  .facts dd {
    margin: 0;
    color: var(--x-ink);
    font-family: var(--serif);
  }

  .lineage {
    list-style: none;
    margin: 0;
    padding: 0 0 0 0.2rem;
    position: relative;
  }
  /* A stem down the left, from the axiom to the branch. */
  .lineage::before {
    content: '';
    position: absolute;
    left: 0.95rem;
    top: 0.7rem;
    bottom: 0.9rem;
    width: 1.5px;
    background: var(--x-line);
  }
  .lineage li {
    position: relative;
    display: grid;
    grid-template-columns: 2.1rem 1fr;
    gap: 0.5rem;
    padding: 0.3rem 0;
  }
  .lineage .n {
    position: relative;
    z-index: 1;
    align-self: start;
    justify-self: center;
    min-width: 1.5rem;
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    background: var(--x-chip-solid);
    text-align: center;
    font-size: 0.76rem;
  }
  .by {
    display: block;
    font-size: 0.74rem;
    color: var(--x-faint);
    font-style: italic;
    font-family: var(--serif);
  }

  @media (max-width: 900px) {
    .xray-panel {
      width: 19rem;
    }
  }
  @media (max-width: 640px) {
    .xray-panel {
      left: 0.6rem;
      right: 0.6rem;
      width: auto;
      top: auto;
      bottom: 6.2rem;
      height: 40vh;
    }
  }
</style>
