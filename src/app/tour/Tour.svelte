<script lang="ts">
  /**
   * The tour, as it plays: the scene dimmed, a soft-edged spotlight on the
   * part being shown, and a small paper card beside it saying what it is.
   *
   * The spotlight is one box with an enormous shadow — the shadow is the dim —
   * so moving it from one part to the next is a single eased slide of its
   * position and size, and it glows gently round its edge to draw the eye.
   * Whatever is under the spotlight can still be used, so a reader can try
   * the switch they are reading about; everything else is held still until
   * the tour moves on.
   *
   * The target is measured every frame rather than once, because what is
   * shown often moves while it is being shown: a card rising into place, a
   * button that grows on hover.
   */
  import { onMount, tick } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import Glyph from '../components/Glyph.svelte';
  import { cut } from '../components/paper';
  import type { TourStop } from './chapters';

  interface Props {
    stops: TourStop[];
    /** Set the scene up for a step: open the card it is about, say. */
    onstage: (stop: TourStop) => void;
    onclose: () => void;
  }

  let { stops, onstage, onclose }: Props = $props();

  let index = $state(0);
  const stop = $derived(stops[Math.min(index, stops.length - 1)]);
  const last = $derived(index >= stops.length - 1);
  /** How far through the chapter, for its dots. */
  const chapterSteps = $derived(stop.chapter.steps.length);

  type Box = { x: number; y: number; w: number; h: number };
  let hole = $state<Box | null>(null);
  let card = $state<HTMLElement>();
  let next = $state<HTMLButtonElement>();
  let place = $state({ left: 0, top: 0, side: 'center' as 'center' | 'top' | 'bottom' | 'left' | 'right', arrow: 0 });

  const PAD = 9;
  const GAP = 18;
  const MARGIN = 14;

  function measure(): Box | null {
    const sel = stop.step.target;
    if (!sel) return null;
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    return { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
  }

  /** Beside the target, on the side asked for if there is room, else wherever there is most. */
  function layout(box: Box | null) {
    if (!card) return;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!box) {
      const left = (vw - cw) / 2;
      const top = Math.max(MARGIN, (vh - ch) / 2 - vh * 0.04);
      if (Math.abs(left - place.left) > 0.5 || Math.abs(top - place.top) > 0.5 || place.side !== 'center') place = { left, top, side: 'center', arrow: 0 };
      return;
    }
    const room = {
      top: box.y - GAP - MARGIN,
      bottom: vh - (box.y + box.h) - GAP - MARGIN,
      left: box.x - GAP - MARGIN,
      right: vw - (box.x + box.w) - GAP - MARGIN,
    };
    const fits = (s: keyof typeof room) => (s === 'top' || s === 'bottom' ? room[s] >= ch : room[s] >= cw);
    let side = stop.step.side && fits(stop.step.side) ? stop.step.side : (['top', 'bottom', 'right', 'left'] as const).find(fits);
    if (!side) side = (Object.keys(room) as (keyof typeof room)[]).sort((a, b) => room[b] - room[a])[0];
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const clampX = (x: number) => Math.min(Math.max(x, MARGIN), vw - cw - MARGIN);
    const clampY = (y: number) => Math.min(Math.max(y, MARGIN), vh - ch - MARGIN);
    let left: number;
    let top: number;
    if (side === 'top' || side === 'bottom') {
      left = clampX(cx - cw / 2);
      top = side === 'top' ? clampY(box.y - GAP - ch) : clampY(box.y + box.h + GAP);
    } else {
      top = clampY(cy - ch / 2);
      left = side === 'left' ? clampX(box.x - GAP - cw) : clampX(box.x + box.w + GAP);
    }
    // Where along the facing edge the little pointer sits: at the target.
    const arrow = side === 'top' || side === 'bottom' ? Math.min(Math.max(cx - left, 26), cw - 26) : Math.min(Math.max(cy - top, 26), ch - 26);
    if (Math.abs(left - place.left) > 0.5 || Math.abs(top - place.top) > 0.5 || side !== place.side || Math.abs(arrow - place.arrow) > 0.5) {
      place = { left, top, side, arrow };
    }
  }

  let frame = 0;
  function track() {
    const box = measure();
    if (
      (box === null) !== (hole === null) ||
      (box && hole && (Math.abs(box.x - hole.x) > 0.5 || Math.abs(box.y - hole.y) > 0.5 || Math.abs(box.w - hole.w) > 0.5 || Math.abs(box.h - hole.h) > 0.5))
    ) {
      hole = box;
    }
    layout(hole);
    frame = requestAnimationFrame(track);
  }

  async function go(to: number) {
    if (to < 0) return;
    if (to >= stops.length) {
      onclose();
      return;
    }
    index = to;
    onstage(stops[to]);
    await tick();
    next?.focus({ preventScroll: true });
  }

  onMount(() => {
    onstage(stops[0]);
    frame = requestAnimationFrame(track);
    requestAnimationFrame(() => next?.focus({ preventScroll: true }));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onclose();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        void go(index + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        void go(index - 1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey, true);
    };
  });

  /** The body's `*bold*` marks, as markup. The text is ours, not the user's. */
  function rich(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*([^*]+)\*/g, '<b>$1</b>');
  }

  /** The dim, with a window cut where the spotlight is, so what is under it can still be used. */
  const blocker = $derived(
    hole
      ? `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${hole.x}px ${hole.y}px, ${hole.x + hole.w}px ${hole.y}px, ${hole.x + hole.w}px ${hole.y + hole.h}px, ${hole.x}px ${hole.y + hole.h}px, ${hole.x}px ${hole.y}px)`
      : 'none',
  );
</script>

<div class="tour" data-tour-ui transition:fade={{ duration: 260 }}>
  <!-- Holds the scene still, except through the spotlight. -->
  <div class="block" style="clip-path: {blocker}" role="presentation"></div>

  <div
    class="spot"
    class:none={!hole}
    style={hole
      ? `left: ${hole.x}px; top: ${hole.y}px; width: ${hole.w}px; height: ${hole.h}px`
      : `left: 50%; top: 46%; width: 0px; height: 0px`}
  ></div>

  <div class="place {place.side}" style="left: {place.left}px; top: {place.top}px; --arrow: {place.arrow}px">
    {#if place.side !== 'center'}<span class="pointer" aria-hidden="true"></span>{/if}
    <div class="card" bind:this={card} role="dialog" aria-modal="true" aria-labelledby="tour-title" use:cut={{ seed: 'tour', inset: 4, radius: [16, 30], bulge: [-0.8, 3] }}>
      <div class="progress" aria-hidden="true"><span style="width: {((index + 1) / stops.length) * 100}%"></span></div>
      <div class="kicker">
        <span class="mark illustrated"><Glyph name={stop.chapter.icon} size={17} weight={1.7} /></span>
        <span class="chapter">{stop.chapter.title}</span>
        {#if chapterSteps > 1}
          <span class="dots" aria-label="Step {stop.n + 1} of {chapterSteps}">
            {#each stop.chapter.steps as _, i (i)}<i class:on={i === stop.n} class:done={i < stop.n}></i>{/each}
          </span>
        {/if}
        <button class="x" onclick={onclose} aria-label="Leave the tour" title="Leave the tour (Esc)"><Glyph name="close" size={15} weight={1.9} /></button>
      </div>
      {#key index}
        <div class="words" in:fly={{ y: 6, duration: 260, delay: 60 }}>
          <h3 id="tour-title">{stop.step.title}</h3>
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          <p>{@html rich(stop.step.body)}</p>
        </div>
      {/key}
      <div class="foot">
        <span class="count">{index + 1} / {stops.length}</span>
        {#if index > 0}
          <button class="back" onclick={() => go(index - 1)}>Back</button>
        {/if}
        <button class="next" bind:this={next} onclick={() => go(index + 1)}>
          {last ? 'Done' : 'Next'}
          {#if !last}<span class="arrow" aria-hidden="true">→</span>{/if}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .tour {
    position: fixed;
    inset: 0;
    z-index: 60;
    pointer-events: none;
  }

  .block {
    position: absolute;
    inset: 0;
    pointer-events: auto;
  }

  /*
   * The spotlight. Its shadow is the dim over everything else; its own ring
   * breathes, slowly, so the eye finds it.
   */
  .spot {
    position: absolute;
    border-radius: 18px;
    box-shadow:
      0 0 0 200vmax rgba(24, 17, 9, 0.46),
      0 0 0 2px rgba(255, 236, 196, 0.9),
      0 0 22px 6px rgba(255, 214, 140, 0.45);
    transition:
      left 0.55s cubic-bezier(0.3, 1.15, 0.4, 1),
      top 0.55s cubic-bezier(0.3, 1.15, 0.4, 1),
      width 0.55s cubic-bezier(0.3, 1.15, 0.4, 1),
      height 0.55s cubic-bezier(0.3, 1.15, 0.4, 1),
      box-shadow 0.4s;
    animation: breathe 2.4s ease-in-out infinite;
  }

  .spot.none {
    box-shadow:
      0 0 0 200vmax rgba(24, 17, 9, 0.4),
      0 0 0 0 rgba(255, 236, 196, 0),
      0 0 0 0 rgba(255, 214, 140, 0);
    animation: none;
  }

  @keyframes breathe {
    50% {
      box-shadow:
        0 0 0 200vmax rgba(24, 17, 9, 0.46),
        0 0 0 3px rgba(255, 236, 196, 0.95),
        0 0 34px 10px rgba(255, 214, 140, 0.55);
    }
  }

  /* The card and its little pointer, placed together. */
  .place {
    position: absolute;
    width: min(340px, calc(100vw - 28px));
    pointer-events: auto;
    filter: drop-shadow(0 18px 36px rgba(10, 6, 2, 0.32)) drop-shadow(0 2px 6px rgba(10, 6, 2, 0.18));
    transition:
      left 0.5s cubic-bezier(0.3, 1.1, 0.4, 1),
      top 0.5s cubic-bezier(0.3, 1.1, 0.4, 1);
  }

  .pointer {
    position: absolute;
    width: 16px;
    height: 16px;
    background: #f8f1e3;
    transform: rotate(45deg);
    border-radius: 3px;
  }
  .top .pointer {
    top: calc(100% - 9px);
    left: calc(var(--arrow) - 8px);
  }
  .bottom .pointer {
    bottom: calc(100% - 9px);
    left: calc(var(--arrow) - 8px);
  }
  .left .pointer {
    left: calc(100% - 9px);
    top: calc(var(--arrow) - 8px);
  }
  .right .pointer {
    right: calc(100% - 9px);
    top: calc(var(--arrow) - 8px);
  }

  .card {
    position: relative;
    padding: 0.95rem 1.15rem 0.9rem;
    color: var(--ink);
    background:
      var(--paper-grain),
      linear-gradient(172deg, #fcf8ef, #f6eedf 70%, #f1e7d4);
  }

  .progress {
    position: absolute;
    left: 14px;
    right: 14px;
    top: 7px;
    height: 3px;
    border-radius: 2px;
    background: rgba(95, 139, 56, 0.14);
    overflow: hidden;
  }
  .progress span {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: linear-gradient(90deg, #8fb34f, #5f8b38);
    transition: width 0.45s cubic-bezier(0.3, 1, 0.4, 1);
  }

  .kicker {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin: 0.35rem 0 0.4rem;
    font-size: 0.74rem;
    font-weight: 650;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #5f8b38;
  }

  .mark {
    display: grid;
    place-items: center;
    color: #4d7330;
    --glyph-wash: #b9d08a;
    --glyph-wash-opacity: 0.6;
  }

  .chapter {
    flex: none;
  }

  .dots {
    display: inline-flex;
    gap: 4px;
    margin-left: 0.15rem;
  }
  .dots i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(95, 139, 56, 0.2);
    transition:
      background 0.3s,
      transform 0.3s;
  }
  .dots i.done {
    background: rgba(95, 139, 56, 0.5);
  }
  .dots i.on {
    background: #5f8b38;
    transform: scale(1.3);
  }

  .x {
    margin-left: auto;
    display: grid;
    place-items: center;
    width: 1.6rem;
    height: 1.6rem;
    padding: 0;
    border: none;
    border-radius: 50%;
    color: var(--ink-faint);
    background: transparent;
    cursor: pointer;
    transition:
      background 0.2s,
      color 0.2s;
  }
  .x:hover {
    color: var(--ink);
    background: rgba(36, 29, 22, 0.07);
  }

  h3 {
    margin: 0 0 0.3rem;
    font-family: var(--serif);
    font-size: 1.28rem;
    font-weight: 600;
    font-variation-settings: 'SOFT' 100;
    letter-spacing: -0.01em;
  }

  p {
    margin: 0;
    font-size: 0.92rem;
    line-height: 1.5;
    color: var(--ink-dim);
  }

  p :global(b) {
    font-weight: 650;
    color: var(--ink);
  }

  .foot {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.9rem;
  }

  .count {
    margin-right: auto;
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    color: var(--ink-faint);
  }

  .back,
  .next {
    font: inherit;
    font-size: 0.9rem;
    font-weight: 650;
    border: none;
    cursor: pointer;
    border-radius: 13px 11px 14px 10px;
    transition:
      transform 0.18s cubic-bezier(0.3, 1.6, 0.5, 1),
      filter 0.18s,
      background 0.2s;
  }

  .back {
    padding: 0.45rem 0.8rem;
    color: var(--ink-dim);
    background: rgba(36, 29, 22, 0.06);
  }
  .back:hover {
    background: rgba(36, 29, 22, 0.1);
  }

  .next {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.48rem 1.05rem;
    color: #fbf7ee;
    background: linear-gradient(180deg, #7aa54a, #5f8b38);
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.25) inset, 0 3px 8px rgba(60, 90, 30, 0.25);
  }
  .next:hover {
    transform: translateY(-1px) scale(1.03);
    filter: brightness(1.06);
  }
  .next .arrow {
    transition: transform 0.2s;
  }
  .next:hover .arrow {
    transform: translateX(2px);
  }

  .next:focus-visible,
  .back:focus-visible,
  .x:focus-visible {
    outline: 2px solid #5f8b38;
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .spot,
    .place,
    .progress span {
      transition: none;
      animation: none;
    }
  }
</style>
