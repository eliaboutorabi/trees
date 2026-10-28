<script lang="ts">
  /**
   * Learn: how to write a tree, as a short course beside a drawing board.
   *
   * The lessons scroll down the left, each a few sentences and a grammar you
   * can edit; the board on the right draws whichever lesson you are reading,
   * and grows it in as you arrive. Change the code and the drawing follows as
   * you type. It starts with a turtle drawing a square and ends on the oak
   * from the garden, which by then uses nothing you have not met.
   */
  import { onDestroy, onMount } from 'svelte';
  import CodeEditor, { highlight } from '../components/CodeEditor.svelte';
  import Glyph from '../components/Glyph.svelte';
  import Slider from '../components/Slider.svelte';
  import { cut } from '../components/paper';
  import { LEAF_SCALE, LESSONS, PLANT_LEAF_RATIO, prose, type Knob, type Planting } from './lessons';
  import { Sketch, type SketchInfo, type SketchSource } from './sketch';

  interface Props {
    onclose: () => void;
    /** Grow a lesson's grammar in the garden. */
    onplant?: (planting: Planting) => void;
  }

  let { onclose, onplant }: Props = $props();

  const drafts = $state(LESSONS.map((l) => ({ ...l.source })));
  let active = $state(0);
  let info = $state<SketchInfo | null>(null);

  const lesson = $derived(LESSONS[active]);
  const draft = $derived(drafts[active]);

  let canvas = $state<HTMLCanvasElement>();
  let sheet = $state<HTMLElement>();
  /** Where focus was before, to hand it back on the way out. */
  const returnFocus = document.activeElement as HTMLElement | null;
  let scroller = $state<HTMLElement>();
  const sections: HTMLElement[] = [];
  let sketch = $state.raw<Sketch | null>(null);

  const KNOBS: Record<Exclude<Knob, 'seed'>, { label: string; min: number; max: number; step: number; format: (v: number) => string }> = {
    angle: { label: 'Angle · ANG', min: 5, max: 120, step: 0.5, format: (v) => `${v.toFixed(v % 1 ? 1 : 0)}°` },
    step: { label: 'Step · LEN', min: 0.3, max: 3, step: 0.05, format: (v) => v.toFixed(2) },
    shrink: { label: 'Shrink · SHRINK', min: 0.5, max: 0.97, step: 0.01, format: (v) => v.toFixed(2) },
    tropism: { label: 'Tropism', min: -0.6, max: 0.6, step: 0.01, format: (v) => v.toFixed(2) },
  };

  /*
   * Redrawing. Arriving at a lesson grows its tree in; editing it does not —
   * while you type, the drawing simply becomes the new one, a moment after
   * you pause, so a half-typed rule is not rebuilt on every key.
   */
  let shown = -1;
  let typing: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    const i = active;
    const src: SketchSource = { ...drafts[i] };
    const board = sketch;
    if (!board) return;
    clearTimeout(typing);
    const draw = () => {
      info = board.show(src, LESSONS[i].look, { grow: i !== shown, leafScale: LESSONS[i].leafScale ?? LEAF_SCALE });
      shown = i;
    };
    if (i !== shown) draw();
    else typing = setTimeout(draw, 150);
  });

  function modified(i: number): boolean {
    const a = drafts[i];
    const b = LESSONS[i].source;
    return (Object.keys(b) as (keyof SketchSource)[]).some((k) => a[k] !== b[k]);
  }

  function restore(i: number) {
    drafts[i] = { ...LESSONS[i].source };
  }

  function goTo(i: number) {
    active = i;
    sections[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function generations(delta: number) {
    const max = lesson.maxIterations ?? 0;
    draft.iterations = Math.max(0, Math.min(max, draft.iterations + delta));
  }

  function roll() {
    draft.seed = Math.floor(Math.random() * 1_000_000);
  }

  function plant() {
    onplant?.({ ...draft, leafScale: lesson.plantLeafScale ?? (lesson.leafScale ?? LEAF_SCALE) * PLANT_LEAF_RATIO });
  }

  /** Rows enough for the rules as they wrap in the editor, and one to spare. */
  function lines(text: string) {
    const perRow = 46;
    const rows = text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / perRow)), 0);
    return Math.max(2, rows + 1);
  }

  const code = (src: string) => highlight(src);

  onMount(() => {
    if (canvas) sketch = new Sketch(canvas);
    sheet?.focus({ preventScroll: true });
    // The lesson being read is the one crossing a line a third of the way down.
    const watcher = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) active = Number((e.target as HTMLElement).dataset.index);
      },
      { root: scroller, rootMargin: '-28% 0px -62% 0px' },
    );
    for (const s of sections) watcher.observe(s);
    return () => watcher.disconnect();
  });

  onDestroy(() => {
    clearTimeout(typing);
    sketch?.dispose();
    returnFocus?.focus?.({ preventScroll: true });
  });

  function onkey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }
</script>

<svelte:window onkeydown={onkey} />

<div
  class="scrim"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
>
  <div class="wrap">
    <div class="sheet" bind:this={sheet} tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="learn-title" use:cut={{ seed: 'learn', inset: 6, radius: [22, 44], bulge: [-1, 5] }}>
      <header>
        <span class="mark illustrated"><Glyph name="learn" size={30} weight={1.5} /></span>
        <div class="heading">
          <h2 id="learn-title">Learn to write a tree</h2>
          <p>An L-system, one idea at a time. Read on the left, play on the right.</p>
        </div>
        <nav class="progress" aria-label="Lessons">
          {#each LESSONS as l, i (l.id)}
            <button class:on={i === active} class:done={i < active} onclick={() => goTo(i)} aria-label="{i + 1}. {l.title}" title={l.title}></button>
          {/each}
        </nav>
        <button class="close" onclick={onclose} aria-label="Close">
          <Glyph name="close" size={20} />
        </button>
      </header>

      <div class="body">
        <div class="lessons" bind:this={scroller}>
          {#each LESSONS as l, i (l.id)}
            <section
              class="lesson"
              role="group"
              aria-label={l.title}
              class:active={i === active}
              data-index={i}
              bind:this={sections[i]}
              onfocusin={() => (active = i)}
              onpointerdown={() => (active = i)}
            >
              <p class="kicker">Lesson {i + 1} of {LESSONS.length}</p>
              <h3>{l.title}</h3>
              {#each l.body as para, p (p)}
                <p class="prose">{@html prose(para, code)}</p>
              {/each}

              <div class="field">
                <span>Start with</span>
                <CodeEditor bind:value={drafts[i].axiom} rows={1} label="{l.title}: start" />
              </div>
              <div class="field">
                <span>Rules</span>
                <CodeEditor
                  bind:value={drafts[i].rules}
                  rows={lines(l.source.rules)}
                  label="{l.title}: rules"
                  errorLines={i === active && info ? info.issues.map((x) => x.line) : []}
                />
              </div>
              {#if i === active && info?.issues.length}
                <ul class="issues">
                  {#each info.issues as issue (issue.line + issue.text)}
                    <li><b>{issue.line ? `line ${issue.line}` : 'start'}</b> {issue.message}</li>
                  {/each}
                </ul>
              {/if}

              {#if l.tries?.length}
                <div class="tries">
                  <b>Try</b>
                  <ul>
                    {#each l.tries as t, k (k)}
                      <li>{@html prose(t, code)}</li>
                    {/each}
                  </ul>
                </div>
              {/if}
              {#if modified(i)}
                <button class="restore" onclick={() => restore(i)}>
                  <Glyph name="reset" size={15} /> Put it back as it was
                </button>
              {/if}
            </section>
          {/each}
          <p class="end">That is the course. Everything in the garden is written this way — open the Grammar card and read any of them.</p>
        </div>

        <aside class="stage">
          <div class="board" class:solid={info?.solid} use:cut={{ seed: 'learn-board', inset: 3, radius: [16, 30], bulge: [-0.6, 2.4] }}>
            <canvas bind:this={canvas} aria-label="Drawing of the lesson's grammar"></canvas>
            <p class="caption">
              <b>{active + 1}</b>
              {lesson.title}
              {#if info?.solid}<span class="hint">· drag to turn</span>{/if}
            </p>
            <button class="replay" onclick={() => sketch?.replay()} title="Grow it again" aria-label="Grow it again">
              <Glyph name="play" size={16} />
            </button>
          </div>

          <div class="controls">
            {#if lesson.maxIterations}
              <div class="generations">
                <span class="label">Generations</span>
                <button onclick={() => generations(-1)} disabled={draft.iterations <= 0} aria-label="One generation fewer">−</button>
                <output>{draft.iterations}</output>
                <button onclick={() => generations(1)} disabled={draft.iterations >= lesson.maxIterations} aria-label="One generation more">+</button>
              </div>
            {/if}
            {#each lesson.knobs ?? [] as knob (knob)}
              {#if knob !== 'seed'}
                <Slider
                  label={KNOBS[knob].label}
                  bind:value={drafts[active][knob]}
                  min={KNOBS[knob].min}
                  max={KNOBS[knob].max}
                  step={KNOBS[knob].step}
                  format={KNOBS[knob].format}
                />
              {/if}
            {/each}
            <div class="actions">
              {#if lesson.knobs?.includes('seed')}
                <button class="pill" onclick={roll}><Glyph name="seeds" size={17} /> Another one</button>
              {/if}
              {#if lesson.plant && onplant}
                <button class="pill plant" onclick={plant}><Glyph name="sprout" size={17} /> Plant it in the garden</button>
              {/if}
            </div>
          </div>

          {#if lesson.showWord && info?.word}
            <div class="word">
              <span class="label">The word after {draft.iterations} generation{draft.iterations === 1 ? '' : 's'}</span>
              <code>{@html highlight(info.word)}</code>
            </div>
          {/if}
          {#if info}
            <p class="stats">
              {info.modules.toLocaleString()} symbols · {info.segments.toLocaleString()} lines{info.leaves ? ` · ${info.leaves.toLocaleString()} leaves` : ''}
              {#if info.truncated}<span class="warn">— stopped early, it grows past what the board will draw</span>{/if}
            </p>
          {/if}
        </aside>
      </div>
    </div>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: rgba(22, 16, 10, 0.5);
    animation: scrim-in 0.3s ease-out both;
  }

  @keyframes scrim-in {
    from {
      background: rgba(22, 16, 10, 0);
    }
  }

  /* Sized from the window, not the scrim: a percentage of a grid row sized by
     its own content would grow to the full length of every lesson. */
  .wrap {
    width: min(1180px, calc(100vw - 2rem));
    height: min(820px, calc(100dvh - 2rem));
    filter: drop-shadow(0 26px 50px rgba(10, 6, 2, 0.38)) drop-shadow(0 3px 8px rgba(10, 6, 2, 0.2));
    animation: sheet-in 0.42s cubic-bezier(0.2, 0.9, 0.3, 1.15) both;
  }

  @keyframes sheet-in {
    from {
      opacity: 0;
      transform: translateY(18px) scale(0.97) rotate(-0.4deg);
    }
  }

  .sheet {
    outline: none;
    width: 100%;
    height: 100%;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    color: var(--ink);
    background:
      var(--paper-grain),
      linear-gradient(172deg, #fcf8ef, #f4ebdb 70%, #efe4d0);
  }

  /* ---------------------------------------------------------------- header */

  header {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    padding: 1.35rem 1.9rem 0.9rem;
  }

  .mark {
    --tone: #c9cf98;
    display: grid;
    place-items: center;
  }

  .heading {
    flex: 1;
    min-width: 0;
  }

  h2 {
    font-family: var(--serif);
    font-size: 1.45rem;
    font-weight: 600;
    font-variation-settings: 'SOFT' 100;
    line-height: 1.15;
  }

  .heading p {
    font-size: 0.82rem;
    color: var(--ink-faint);
  }

  .progress {
    display: flex;
    gap: 0.35rem;
  }

  .progress button {
    width: 0.62rem;
    height: 0.62rem;
    border: none;
    border-radius: 50% 45% 55% 48%;
    background: rgba(60, 44, 28, 0.16);
    cursor: pointer;
    transition:
      background 0.3s,
      transform 0.3s;
  }

  .progress button.done {
    background: rgba(90, 120, 60, 0.45);
  }

  .progress button.on {
    background: #6f9a46;
    transform: scale(1.35);
  }

  .close {
    width: 2.3rem;
    height: 2.3rem;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 50% 46% 52% 48%;
    background: rgba(60, 44, 28, 0.07);
    color: var(--ink-dim);
    cursor: pointer;
    transition: background 0.2s;
  }

  .close:hover {
    background: rgba(60, 44, 28, 0.14);
    color: var(--ink);
  }

  /* ---------------------------------------------------------------- layout */

  .body {
    display: grid;
    grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
    min-height: 0;
  }

  .lessons {
    overflow-y: auto;
    padding: 0.2rem 1.6rem 0 1.9rem;
    scrollbar-width: thin;
  }

  /* Room after the last lesson, so it too can reach the reading line. */
  .lessons::after {
    content: '';
    display: block;
    height: 55%;
  }

  .stage {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    min-height: 0;
    padding: 0.2rem 1.9rem 1.5rem 0.8rem;
  }

  /* ---------------------------------------------------------------- lessons */

  .lesson {
    padding: 1.3rem 0 2rem;
    border-bottom: 1px dashed rgba(60, 44, 28, 0.18);
    opacity: 0.42;
    transition: opacity 0.4s;
  }

  .lesson.active {
    opacity: 1;
  }

  .kicker {
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: #6f9a46;
  }

  h3 {
    margin: 0.15rem 0 0.55rem;
    font-family: var(--serif);
    font-size: 1.32rem;
    font-weight: 600;
    font-variation-settings: 'SOFT' 100;
  }

  .prose {
    margin-bottom: 0.65rem;
    font-size: 0.9rem;
    line-height: 1.62;
    color: var(--ink-dim);
  }

  .prose :global(em) {
    font-family: var(--serif);
    font-style: italic;
    color: var(--ink);
  }

  /* Inline code: a chip of the editor's dark slate, in the editor's colours. */
  .lesson :global(code),
  .word code {
    font-family: var(--mono);
    font-size: 0.8em;
    color: #e9dccb;
    background: rgba(38, 31, 25, 0.86);
    border-radius: 5px 6px 5px 6px;
    padding: 0.08em 0.38em;
    white-space: pre-wrap;
  }

  .field {
    margin: 0.8rem 0 0.2rem;
  }

  .field > span {
    display: block;
    margin-bottom: 0.3rem;
    font-family: var(--serif);
    font-size: 0.86rem;
    font-weight: 500;
    color: var(--ink-dim);
  }

  .issues {
    margin: 0.5rem 0 0;
    padding: 0;
    list-style: none;
    font-size: 0.78rem;
    color: #a6402f;
  }

  .tries {
    margin-top: 0.9rem;
    padding: 0.7rem 0.9rem 0.75rem;
    border-radius: 14px 11px 15px 12px;
    background: rgba(201, 207, 152, 0.28);
    font-size: 0.82rem;
    line-height: 1.55;
    color: var(--ink-dim);
  }

  .tries b {
    font-family: var(--serif);
    font-size: 0.86rem;
    color: #4b6a2c;
  }

  .tries ul {
    margin: 0.2rem 0 0;
    padding-left: 1.1rem;
  }

  .restore {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.7rem;
    padding: 0.3rem 0.7rem;
    border: none;
    border-radius: 999px;
    background: rgba(60, 44, 28, 0.07);
    font-size: 0.76rem;
    color: var(--ink-dim);
    cursor: pointer;
  }

  .restore:hover {
    background: rgba(60, 44, 28, 0.13);
  }

  .end {
    padding: 1.6rem 0 0;
    font-family: var(--serif);
    font-size: 0.95rem;
    font-style: italic;
    color: var(--ink-faint);
  }

  /* ---------------------------------------------------------------- board */

  .board {
    position: relative;
    flex: 1;
    min-height: 12rem;
    background:
      radial-gradient(ellipse 80% 70% at 50% 45%, rgba(255, 252, 244, 0.95), rgba(240, 230, 212, 0.9)),
      var(--paper-grain);
  }

  .board canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    touch-action: pan-y;
  }

  .board.solid canvas {
    cursor: grab;
  }

  .board.solid canvas:active {
    cursor: grabbing;
  }

  .caption {
    position: absolute;
    left: 1.1rem;
    top: 0.9rem;
    font-family: var(--serif);
    font-size: 0.86rem;
    color: var(--ink-faint);
    pointer-events: none;
  }

  .caption b {
    margin-right: 0.25rem;
    color: #6f9a46;
  }

  .hint {
    font-family: var(--sans);
    font-size: 0.74rem;
  }

  .replay {
    position: absolute;
    right: 0.9rem;
    top: 0.75rem;
    width: 2.1rem;
    height: 2.1rem;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 48% 52% 46% 54%;
    background: rgba(60, 44, 28, 0.07);
    color: var(--ink-dim);
    cursor: pointer;
  }

  .replay:hover {
    background: rgba(60, 44, 28, 0.14);
  }

  /* ---------------------------------------------------------------- controls */

  .controls {
    display: grid;
    gap: 0.25rem;
  }

  .generations {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 2rem;
  }

  .label {
    width: 6.9rem;
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--ink-dim);
  }

  .generations button {
    width: 1.9rem;
    height: 1.9rem;
    border: none;
    border-radius: 46% 54% 50% 50%;
    background: rgba(111, 154, 70, 0.18);
    color: #3f5a2a;
    font-size: 1.05rem;
    font-weight: 700;
    cursor: pointer;
  }

  .generations button:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .generations output {
    min-width: 1.6rem;
    text-align: center;
    font-family: var(--serif);
    font-size: 1.1rem;
    font-weight: 600;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.3rem;
  }

  .actions:empty {
    display: none;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.45rem 0.95rem 0.45rem 0.75rem;
    border: none;
    border-radius: 999px 880px 999px 900px;
    background: rgba(60, 44, 28, 0.08);
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--ink-dim);
    cursor: pointer;
    transition:
      background 0.2s,
      transform 0.25s cubic-bezier(0.25, 0.8, 0.3, 1.4);
  }

  .pill:hover {
    background: rgba(60, 44, 28, 0.14);
    transform: translateY(-1px);
  }

  .pill.plant {
    background: #8fb465;
    color: #1f3311;
  }

  .pill.plant:hover {
    background: #9cc070;
  }

  .word {
    max-height: 6.2rem;
    overflow-y: auto;
    font-size: 0.78rem;
    line-height: 1.7;
  }

  .word .label {
    display: block;
    width: auto;
    margin-bottom: 0.15rem;
  }

  .word code {
    display: block;
    padding: 0.45rem 0.65rem;
    border-radius: 10px 13px 9px 12px;
    word-break: break-all;
  }

  .stats {
    font-size: 0.74rem;
    color: var(--ink-faint);
  }

  .warn {
    color: #a6602f;
  }

  /*
   * A phone: the board on top, a little over a third of the screen, and the
   * lessons scrolling under it — so the drawing is always in view of the
   * lesson it belongs to.
   */
  @media (max-width: 760px) {
    .scrim {
      padding: 0.4rem;
    }
    .wrap {
      width: calc(100vw - 0.8rem);
      height: calc(100dvh - 0.8rem);
    }
    header {
      padding: 0.9rem 1rem 0.5rem;
      gap: 0.6rem;
    }
    h2 {
      font-size: 1.15rem;
    }
    .heading p,
    .progress {
      display: none;
    }
    .body {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr);
    }
    .stage {
      order: -1;
      gap: 0.4rem;
      padding: 0 1rem 0.5rem;
    }
    .board {
      flex: none;
      height: 34dvh;
      min-height: 0;
    }
    .word {
      max-height: 3.4rem;
    }
    .lessons {
      padding: 0 1rem;
      border-top: 1px dashed rgba(60, 44, 28, 0.18);
    }
  }

  /* The editor's token colours, for code set into the prose and the word. */
  .lesson :global(code .t-arrow),
  .word :global(.t-arrow) {
    color: var(--accent);
    font-weight: 600;
  }
  .lesson :global(code .t-draw),
  .word :global(.t-draw) {
    color: #9fd36b;
    font-weight: 600;
  }
  .lesson :global(code .t-module),
  .word :global(.t-module) {
    color: #f0d27a;
  }
  .lesson :global(code .t-turn),
  .word :global(.t-turn) {
    color: #79b8ff;
  }
  .lesson :global(code .t-branch),
  .word :global(.t-branch) {
    color: #e9a7ff;
    font-weight: 600;
  }
  .lesson :global(code .t-num),
  .word :global(.t-num) {
    color: #ff9e64;
  }
  .lesson :global(code .t-global),
  .word :global(.t-global) {
    color: #7fdbca;
  }
  .lesson :global(code .t-fn),
  .word :global(.t-fn) {
    color: #82aaff;
    font-style: italic;
  }
  .lesson :global(code .t-op),
  .word :global(.t-op) {
    color: #c3a6ff;
  }
</style>
