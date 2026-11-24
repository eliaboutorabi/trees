<script lang="ts">
  /**
   * The L-system view's notes, down the left. What colour is saying on the
   * tree, and its key; then three pages: the grammar, typeset, each
   * production lighting what it drew when pointed at; the rewriting, step by
   * step, each with a small drawing of the tree as it stood; and, once a
   * branch is picked, the branch: the symbols it is written in, what it
   * measures, and how it came to be, rewrite by rewrite, back to the axiom.
   */
  import { fly } from 'svelte/transition';
  import { cubicIn } from 'svelte/easing';
  import type { LineageStep, StepSummary } from '../../engine';
  import type { Lens } from '../../render/xray';
  import type { XrayController } from './controller.svelte';
  import Word from './Word.svelte';
  import { LEGEND, parseRule, prettyArgs, type Piece } from './symbols';

  interface Props {
    x: XrayController;
    axiom: string;
    species: string;
    constants: { name: string; value: string }[];
    night: boolean;
    lens: Lens;
    /** The lens's colours: the ramp's four, or one per production (the axiom's first). */
    colours: string[];
    onlens: (lens: Lens) => void;
    onstep: (n: number) => void;
    /** Light what a production drew (its index; -1 the axiom's), or let it go with null. */
    onrule: (rule: number | null) => void;
    /** Pick the branch the picked one grows from. */
    onwider: () => void;
  }

  let { x, axiom, species, constants, night, lens, colours, onlens, onstep, onrule, onwider }: Props = $props();

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
  const ruleColour = (i: number) => colours[(((i + 1) % colours.length) + colours.length) % colours.length];
  const maxModules = $derived(Math.max(1, ...steps.map((s) => s.modules)));

  // A production pointed at lights what it drew; clicked, it stays lit until clicked again.
  let pointed = $state<number | null>(null);
  let pinned = $state<number | null>(null);
  $effect(() => onrule(pointed ?? pinned));
  // A new tree, a new step or a branch picked: what was lit no longer means anything.
  $effect(() => {
    void x.skeleton;
    void x.picked;
    pinned = null;
    pointed = null;
  });

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

  /** The picked segment, measured: its length, its depth, how far up the tree, the angle it leaves its parent at, its age and maker. */
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
    return { length: len(seg), depth: sk.order[node], theta, up, age: sk.age[node], rule: sk.rule[node] };
  });

  const ruleOf = (src: string | null) => (src ? parseRule(src) : null);

  /** A step's word, cut to what a row has room for, with an ellipsis where it was cut. */
  const excerpt = <T extends { s: string }>(items: T[], room = 26): (T | { s: string })[] => (items.length > room ? [...items.slice(0, room), { s: '…' }] : items);

  // Each page opens at its top (the rewriting then finds its step, below).
  let body = $state<HTMLElement>();
  $effect(() => {
    void tab;
    if (body) body.scrollTop = 0;
  });

  // The step on show stays in sight in the list, as it plays or is picked on the stem.
  let list = $state<HTMLElement>();
  $effect(() => {
    const n = x.step;
    if (tab !== 'rewriting' || !list) return;
    list.querySelectorAll('.step')[n]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });

  const LENSES: { id: Lens; label: string; hint: string }[] = [
    { id: 'depth', label: 'Depth', hint: 'How many brackets deep each segment was drawn' },
    { id: 'age', label: 'Age', hint: 'How many rewrites ago its wood first appeared' },
    { id: 'rule', label: 'Rule', hint: 'Which production drew it' },
  ];
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

{#snippet mark(i: number)}
  <span class="mark" class:coloured={lens === 'rule'} style="--c: {ruleColour(i)}">{i < 0 ? 'ω' : i + 1}</span>
{/snippet}

<aside class="xray-panel xray-theme" class:night aria-label="The L-system" out:fly|global={{ x: -18, duration: 260, easing: cubicIn }}>
  <header>
    <h2>L-system</h2>
    <p class="sub">
      {species}
      {#if overview}· {overview.steps} rewrites · {fmt(steps[steps.length - 1]?.modules ?? 0)} modules{/if}
    </p>

    <div class="lens">
      <!-- (A "segmented" control, so the page's sonification gives it a note per choice.) -->
      <div class="segmented" role="radiogroup" aria-label="Colour by">
        {#each LENSES as l (l.id)}
          <button role="radio" aria-checked={lens === l.id} class:on={lens === l.id} title={l.hint} onclick={() => onlens(l.id)}>{l.label}</button>
        {/each}
      </div>
      <div class="key" aria-hidden="true">
        {#if lens === 'rule'}
          <span class="swatches">
            <span class="sw" style="--c: {ruleColour(-1)}"><i>ω</i></span>
            {#each rules as _, i (i)}
              <span class="sw" style="--c: {ruleColour(i)}">{i + 1}</span>
            {/each}
          </span>
        {:else}
          <span class="end">{lens === 'depth' ? 'trunk' : 'oldest'}</span>
          <span class="bar" style="--a: {colours[0]}; --b: {colours[1]}; --c: {colours[2]}; --d: {colours[3]}"></span>
          <span class="end">{lens === 'depth' ? 'tips' : 'newest'}</span>
        {/if}
      </div>
    </div>

    <div class="tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'grammar'} class:on={tab === 'grammar'} onclick={() => (tab = 'grammar')}>Grammar</button>
      <button role="tab" aria-selected={tab === 'rewriting'} class:on={tab === 'rewriting'} onclick={() => (tab = 'rewriting')}>Rewriting</button>
      <button role="tab" aria-selected={tab === 'branch'} class:on={tab === 'branch'} disabled={x.picked < 0} onclick={() => (tab = 'branch')}>Branch</button>
    </div>
  </header>

  <div class="body" bind:this={body}>
    {#if !overview}
      <p class="quiet">Reading the grammar…</p>
    {:else if tab === 'grammar'}
      <section>
        <h3>Axiom</h3>
        <div class="axiom">
          {@render mark(-1)}
          <Word items={axiomPieces} params="all" size="large" />
        </div>
      </section>
      <section>
        <h3>Productions</h3>
        <p class="quiet hint">Point at one to see what it drew; click to keep it lit.</p>
        <ol class="rules">
          {#each rules as r, i (i)}
            {#if r.rule}
              <li>
                <button
                  class="production"
                  class:used={usedRules.has(r.src)}
                  class:held={pinned === i}
                  onpointerenter={() => (pointed = i)}
                  onpointerleave={() => (pointed = null)}
                  onfocus={() => (pointed = i)}
                  onblur={() => (pointed = null)}
                  onclick={() => (pinned = pinned === i ? null : i)}
                  aria-pressed={pinned === i}
                >
                  {@render mark(i)}
                  <span class="text">
                    {@render ruleLine(r.rule)}
                    {#if r.rule.cond || r.rule.prob}
                      <span class="when">
                        {#if r.rule.cond}when {prettyArgs(r.rule.cond)}{/if}
                        {#if r.rule.prob}{r.rule.cond ? ' · ' : ''}with p = {prettyArgs(r.rule.prob)}{/if}
                      </span>
                    {/if}
                  </span>
                </button>
              </li>
            {/if}
          {/each}
        </ol>
      </section>
      <section>
        <h3>Constants</h3>
        <div class="constants">
          {#each constants as k (k.name)}
            <span><i>{k.name}</i> {k.value}</span>
          {/each}
        </div>
      </section>
      <section>
        <h3>Reading the word</h3>
        <dl class="legend">
          {#each legend as row (row.meaning + row.symbols.join(''))}
            <dt><Word items={row.symbols.map((s) => ({ s }))} /></dt>
            <dd>{row.meaning}</dd>
          {/each}
          {#if nonterminals.length}
            <dt><Word items={nonterminals.map((s) => ({ s }))} /></dt>
            <dd>rewritten each step; drawn as nothing</dd>
          {/if}
        </dl>
      </section>
    {:else if tab === 'rewriting'}
      <ol class="steps" bind:this={list}>
        {#each steps as s, n (n)}
          {@const anc = x.detail && n <= x.detail.step ? x.detail.lineage[n] : null}
          <li>
            <button class="step" class:on={n === x.step} onclick={() => onstep(n)} aria-label="Show the tree after {n} rewrites">
              <span class="n"><i>n</i> = {n}</span>
              {@render thumb(s)}
              <span class="text">
                {#if anc}
                  <Word items={excerpt(anc.from > 0 ? [{ s: '…' }, ...anc.window] : anc.window, 22)} at={anc.at + (anc.from > 0 ? 1 : 0)} line size="small" />
                {:else}
                  <Word items={excerpt(s.head)} line size="small" />
                {/if}
                <span class="count">{fmt(s.modules)} modules · {fmt(s.segments)} segments</span>
                <!-- How long the word is, on a log scale: the rewriting is exponential, and this shows it. -->
                <span class="growth"><span style="width: {(Math.log(1 + s.modules) / Math.log(1 + maxModules)) * 100}%"></span></span>
              </span>
            </button>
          </li>
        {/each}
      </ol>
      {#if steps[x.step]}
        {@const s = steps[x.step]}
        <p class="facts-line quiet">
          After {x.step} rewrite{x.step === 1 ? '' : 's'}: {fmt(s.segments)} segments, {fmt(s.forks)} forks, {fmt(s.tips)} tips, {s.depth} bracket{s.depth === 1 ? '' : 's'} deep.
        </p>
      {/if}
    {:else if tab === 'branch'}
      {#if x.detail}
        {@const d = x.detail}
        <section>
          <div class="branch-head">
            <h3>Branch</h3>
            <span class="actions">
              {#if facts && facts.depth > 0}
                <button class="small-button" onclick={onwider} title="The branch this one grows from">Step out ↑</button>
              {/if}
              <button class="small-button" onclick={() => void x.pick(-1)} aria-label="Let go of the branch">Let go</button>
            </span>
          </div>
          <div class="group"><Word items={d.group} at={d.at} params="at" size="large" /></div>
          <p class="quiet">
            The bracketed group it is written in, in <i>w</i><sub>{d.step}</sub>. The lit
            <Word items={[{ s: d.symbol }]} size="small" /> drew the segment you picked.
          </p>
          {#if facts}
            <dl class="facts">
              <dt>depth</dt>
              <dd>{facts.depth} bracket{facts.depth === 1 ? '' : 's'}</dd>
              <dt>first drawn</dt>
              <dd>{facts.age === 0 ? 'in the axiom' : `at rewrite ${facts.age}`}</dd>
              <dt>drawn by</dt>
              <dd class="maker">
                {@render mark(facts.rule)}
                {facts.rule < 0 ? 'the axiom' : `production ${facts.rule + 1}`}
              </dd>
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
          <h3>How it grew</h3>
          <ol class="lineage">
            {#each ancestry as a (a.step.step)}
              {@const l = a.step}
              <li>
                <span class="n">{a.until > l.step ? `${l.step}–${a.until}` : l.step}</span>
                <span class="text">
                  <Word items={excerpt(l.from > 0 ? [{ s: '…' }, ...l.window] : l.window, 22)} at={l.at + (l.from > 0 ? 1 : 0)} params="at" line size="small" />
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
    width: 23rem;
    display: flex;
    flex-direction: column;
    border-radius: 20px 17px 21px 16px;
    background: var(--x-glass);
    backdrop-filter: var(--frost);
    -webkit-backdrop-filter: var(--frost);
    box-shadow: var(--x-rim), 0 18px 40px rgba(10, 8, 6, 0.2);
    color: var(--x-ink);
    overflow: hidden;
    animation: arrive 0.55s cubic-bezier(0.25, 0.9, 0.3, 1.05) both;
  }

  @keyframes arrive {
    from {
      opacity: 0;
      transform: translateX(-22px);
    }
  }

  header {
    padding: 1rem 1.2rem 0;
  }

  h2 {
    margin: 0;
    font-family: var(--serif);
    font-size: 1.7rem;
    font-weight: 560;
    font-variation-settings: 'SOFT' 100, 'opsz' 48;
    letter-spacing: -0.01em;
  }

  .sub {
    margin: 0.05rem 0 0.75rem;
    font-size: 0.82rem;
    color: var(--x-dim);
  }

  /* What colour says: three choices in one piece, and its key under it. */
  .lens {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    margin-bottom: 0.8rem;
  }
  .segmented {
    display: flex;
    padding: 3px;
    border-radius: 999px;
    background: var(--x-chip);
  }
  .segmented button {
    flex: 1;
    border: none;
    background: transparent;
    padding: 0.28rem 0.5rem;
    border-radius: 999px;
    font-family: var(--serif);
    font-size: 0.86rem;
    font-weight: 500;
    color: var(--x-dim);
    cursor: pointer;
    transition:
      background-color 0.25s,
      color 0.25s;
  }
  .segmented button:hover {
    color: var(--x-ink);
  }
  .segmented button.on {
    color: var(--x-ink);
    background: var(--x-tab-solid, var(--x-tab));
  }
  .key {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 1.15rem;
    padding: 0 0.3rem;
    font-family: var(--serif);
    font-size: 0.74rem;
    font-style: italic;
    color: var(--x-faint);
  }
  .bar {
    flex: 1;
    height: 6px;
    border-radius: 999px;
    background: linear-gradient(to right, var(--a), var(--b) 34%, var(--c) 67%, var(--d));
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .sw {
    min-width: 1.15rem;
    height: 1.15rem;
    padding: 0 0.3rem;
    display: grid;
    place-items: center;
    border-radius: 999px;
    background: var(--c);
    color: var(--x-on-colour, #fff);
    font-style: normal;
    font-size: 0.7rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .tabs {
    display: flex;
    gap: 1.1rem;
    padding: 0 0.15rem;
    border-bottom: 1px solid var(--x-line);
  }
  .tabs button {
    position: relative;
    border: none;
    background: transparent;
    font-family: var(--serif);
    font-size: 0.98rem;
    font-weight: 500;
    color: var(--x-dim);
    padding: 0.2rem 0 0.55rem;
    cursor: pointer;
    transition: color 0.2s;
  }
  .tabs button:hover:not(:disabled) {
    color: var(--x-ink);
  }
  .tabs button.on {
    color: var(--x-ink);
  }
  .tabs button.on::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 2px;
    border-radius: 2px;
    background: var(--x-ink);
  }
  .tabs button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .body {
    flex: 1;
    overflow-y: auto;
    padding: 0.9rem 1.2rem 1.2rem;
    scrollbar-width: thin;
    scrollbar-color: var(--x-line) transparent;
  }

  section + section {
    margin-top: 1.15rem;
  }

  h3 {
    margin: 0 0 0.45rem;
    font-family: var(--serif);
    font-size: 1.02rem;
    font-weight: 600;
    font-variation-settings: 'SOFT' 100;
  }

  /* A production's number, filled with its colour when colour names productions. */
  .mark {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 1.35rem;
    height: 1.35rem;
    border-radius: 50%;
    font-family: var(--serif);
    font-size: 0.74rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--x-dim);
    box-shadow: inset 0 0 0 1.25px var(--x-line);
    transition:
      background-color 0.3s,
      color 0.3s,
      box-shadow 0.3s;
  }
  .mark.coloured {
    background: var(--c);
    color: var(--x-on-colour, #fff);
    box-shadow: none;
  }

  .axiom {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .hint {
    margin: -0.2rem 0 0.5rem;
  }
  .rules {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .production {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    width: 100%;
    margin: 0;
    padding: 0.4rem 0.5rem;
    border: none;
    border-radius: 12px;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.2s;
  }
  .production .mark {
    margin-top: 0.15rem;
  }
  .production:hover,
  .production:focus-visible {
    background: var(--x-hover);
    outline: none;
  }
  .production.used {
    background: var(--x-lit-wash);
  }
  .production.held {
    background: var(--x-tab);
  }
  .text {
    min-width: 0;
    display: flex;
    flex-direction: column;
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
    font-size: 0.76rem;
    font-style: italic;
    color: var(--x-dim);
    font-family: var(--serif);
  }

  .constants {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 1rem;
    font-family: var(--serif);
    font-size: 0.92rem;
    color: var(--x-ink);
  }
  .constants i {
    color: var(--x-grows);
    font-style: normal;
    font-size: 0.74rem;
    letter-spacing: 0.05em;
    margin-right: 0.2rem;
  }

  .legend {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.2rem 0.9rem;
    margin: 0;
    align-items: baseline;
  }
  .legend dt {
    margin: 0;
    min-width: 2.4rem;
    text-align: center;
  }
  .legend dd {
    margin: 0;
    font-size: 0.86rem;
    color: var(--x-dim);
  }

  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .step {
    display: grid;
    grid-template-columns: 2.55rem 3.5rem 1fr;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    padding: 0.35rem 0.5rem;
    border: none;
    border-radius: 14px;
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
  .count {
    font-size: 0.72rem;
    color: var(--x-faint);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .growth {
    display: block;
    height: 2px;
    margin-top: 0.3rem;
    border-radius: 2px;
    background: var(--x-line);
    overflow: hidden;
  }
  .growth span {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--x-dim);
    opacity: 0.55;
  }
  .step.on .growth span {
    opacity: 0.9;
  }

  .thumb {
    width: 3.5rem;
    height: 2.65rem;
    overflow: visible;
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

  .facts-line {
    margin: 0.9rem 0.5rem 0;
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
  .branch-head h3 {
    margin: 0;
  }
  .actions {
    display: flex;
    gap: 0.3rem;
  }
  .small-button {
    border: none;
    background: var(--x-chip);
    color: var(--x-dim);
    font-family: var(--serif);
    font-size: 0.78rem;
    padding: 0.18rem 0.7rem;
    border-radius: 999px;
    cursor: pointer;
    transition: color 0.2s;
  }
  .small-button:hover {
    color: var(--x-ink);
  }
  .group {
    margin: 0.5rem 0 0.4rem;
  }

  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.25rem 1rem;
    margin: 0.7rem 0 0;
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
  .facts .maker {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .facts .maker .mark {
    width: 1.15rem;
    height: 1.15rem;
    font-size: 0.66rem;
  }

  .lineage {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .lineage li {
    display: grid;
    grid-template-columns: 2.3rem 1fr;
    gap: 0.5rem;
    padding: 0.35rem 0;
  }
  .lineage li + li {
    border-top: 1px solid var(--x-line);
  }
  .lineage .n {
    font-size: 0.8rem;
    color: var(--x-faint);
    font-variant-numeric: tabular-nums;
    padding-top: 0.1rem;
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
  /* On a phone the notes take the bottom of the screen, and their head is kept short so the pages have room. */
  @media (max-width: 640px) {
    .xray-panel {
      left: 0.6rem;
      right: 0.6rem;
      width: auto;
      top: auto;
      bottom: 6.2rem;
      height: 38vh;
    }
    header {
      padding: 0.7rem 1rem 0;
    }
    h2 {
      display: inline;
      font-size: 1.25rem;
      margin-right: 0.5rem;
    }
    .sub {
      display: inline;
    }
    .lens {
      margin: 0.55rem 0 0.5rem;
    }
    .key {
      display: none;
    }
    .body {
      padding: 0.6rem 0.9rem 0.9rem;
    }
    .step {
      grid-template-columns: 2.5rem 3.1rem 1fr;
      gap: 0.45rem;
    }
    .thumb {
      width: 3.1rem;
      height: 2.35rem;
    }
  }
</style>
