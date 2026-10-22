<script lang="ts">
  /**
   * How far the tree has grown, as a stem you pull up out of the ground.
   *
   * Dragging up grows the tree and dragging down takes it back towards the
   * seed, so the control moves the way the tree does. The stem itself grows
   * with it — leaves unfold along it as it passes them — and the handle is a
   * big bud marked with arrows, so it reads as something to take hold of. The
   * first time, a note beside it says what it does, until it has been used
   * (or for twenty seconds of each visit, if it is not).
   * Under it are the two ways to start over: play the growth again, or plant
   * a new seed.
   */
  import { onMount } from 'svelte';
  import Glyph from './Glyph.svelte';

  interface Props {
    /** 0 is a seed, 1 the grown tree. */
    value: number;
    onscrub: (v: number) => void;
    /** Set while the stem is held, so the tree's own growth does not fight the hand. */
    holding?: boolean;
    onreplay: () => void;
    onregrow: () => void;
  }

  let { value, onscrub, holding = $bindable(false), onreplay, onregrow }: Props = $props();

  // The stem runs up a 44 × 200 box, swaying a little as it goes.
  const BOTTOM = 186;
  const TOP = 16;
  const MID = 22;
  const sway = (y: number) => MID + 2.2 * Math.sin((BOTTOM - y) * 0.045) - 1.2 * Math.sin((BOTTOM - y) * 0.11);
  const stem = (() => {
    let d = '';
    for (let y = BOTTOM; y >= TOP - 0.01; y -= 6) d += `${d ? 'L' : 'M'}${sway(y).toFixed(2)} ${y.toFixed(2)}`;
    return d;
  })();
  const at = (t: number) => {
    const y = BOTTOM - t * (BOTTOM - TOP);
    return [sway(y), y] as const;
  };

  // Leaves along the stem, alternating sides, each unfolding as the stem passes it.
  const LEAVES = [0.12, 0.25, 0.38, 0.5, 0.61, 0.71, 0.8].map((t, i) => {
    const [x, y] = at(t);
    const side = i % 2 ? -1 : 1;
    return { t, x, y, side, size: 0.85 + 0.35 * Math.sin(t * Math.PI) };
  });

  const tip = $derived(at(value));
  const pct = $derived(Math.round(value * 100));

  // The note for a first visit: shown until the stem is first taken hold of.
  const SEEN = 'arbor:growth-stem-used';
  let hint = $state(false);
  onMount(() => {
    try {
      hint = localStorage.getItem(SEEN) !== '1';
    } catch {
      hint = true;
    }
    // Not forever, though: after a while it is only in the way.
    const t = setTimeout(() => (hint = false), 20000);
    return () => clearTimeout(t);
  });
  function used() {
    if (!hint) return;
    hint = false;
    try {
      localStorage.setItem(SEEN, '1');
    } catch {
      // Storage can be unavailable; the note just comes back next time.
    }
  }

  let svg: SVGSVGElement;

  function place(e: PointerEvent) {
    const box = svg.getBoundingClientRect();
    const y = ((e.clientY - box.top) / box.height) * 200;
    onscrub(Math.min(1, Math.max(0, (BOTTOM - y) / (BOTTOM - TOP))));
  }

  function down(e: PointerEvent) {
    holding = true;
    used();
    svg.setPointerCapture(e.pointerId);
    place(e);
  }
  function move(e: PointerEvent) {
    if (holding) place(e);
  }
  function up(e: PointerEvent) {
    holding = false;
    if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
  }

  function key(e: KeyboardEvent) {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onscrub(Math.min(1, value + step));
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onscrub(Math.max(0, value - step));
    else if (e.key === 'Home') onscrub(0);
    else if (e.key === 'End') onscrub(1);
    else return;
    used();
    e.preventDefault();
  }
</script>

<div class="stem">
  <span class="label">Grow</span>
  <span class="end illustrated" aria-hidden="true"><Glyph name="trunk-stout" size={30} weight={1.5} /></span>

  <div class="track">
    <svg
      bind:this={svg}
      viewBox="0 0 44 200"
      class:holding
      class:beckon={hint && !holding}
      role="slider"
      tabindex="0"
      aria-label="Growth"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext="{pct}% grown"
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
      onkeydown={key}
    >
      <title>Drag up to grow the tree, down to take it back to a seed</title>
      <!-- the groove the stem grows up -->
      <path d={stem} class="groove" />
      <!-- the stem, drawn as far as the tree has grown -->
      <path d={stem} class="grown" pathLength="1" stroke-dasharray="{value} 1" />

      {#each LEAVES as l, i (i)}
        <path
          class="leaf"
          class:out={value >= l.t + 0.04}
          d="M0 0c2.4-3.6 7.6-4.6 10.6-1.6-2.6 3.2-7.6 4-10.6 1.6z"
          style="--x: {l.x}px; --y: {l.y}px; --s: {l.size}; --side: {l.side}"
        />
      {/each}

      <!-- the handle: a bud with arrows saying which ways it goes -->
      <g transform="translate({tip[0]} {tip[1]})">
        <g class="bud">
          <circle r="13" class="bud-body" />
          <path d="M-3.6 -3.4L0 -7l3.6 3.6M-3.6 3.4L0 7l3.6-3.6" class="bud-arrows" />
        </g>
      </g>
    </svg>

    {#if hint}
      <p class="hint" style="top: {(tip[1] / 200) * 100}%">
        <b>Drag me</b>
        up to grow, down to shrink
      </p>
    {/if}
  </div>

  <span class="end illustrated" aria-hidden="true"><Glyph name="seeds" size={26} weight={1.5} /></span>
  <span class="pct">{pct}<small>%</small></span>

  <div class="buttons">
    <button onclick={onreplay} title="Watch it grow again (space)" aria-label="Replay growth">
      <Glyph name="play" size={16} weight={1.8} />
    </button>
    <button onclick={onregrow} title="Plant a new seed (R)" aria-label="Grow again from seed">
      <Glyph name="sprout" size={19} weight={1.8} />
    </button>
  </div>
</div>

<style>
  .stem {
    position: absolute;
    right: 1.1rem;
    top: 50%;
    transform: translateY(-50%);
    z-index: 5;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    width: 3.9rem;
    padding: 0.6rem 0 0.55rem;
    border-radius: 30px 26px 32px 24px / 24px 32px 26px 30px;
    color: var(--ink);
    background: var(--sheen), var(--glass);
    backdrop-filter: var(--frost);
    -webkit-backdrop-filter: var(--frost);
    box-shadow: var(--rim), 0 10px 26px rgba(20, 14, 6, 0.2);
  }

  .label {
    font-family: var(--serif);
    font-size: 0.86rem;
    font-weight: 600;
    font-variation-settings: 'SOFT' 100;
    color: var(--ink);
  }

  .end {
    display: grid;
    place-items: center;
    --glyph-wash: #b98a5c;
    filter: drop-shadow(0 1px 0 rgba(255, 255, 255, 0.6));
  }

  .track {
    position: relative;
  }

  svg {
    display: block;
    width: 2.75rem;
    height: 12.5rem;
    overflow: visible;
    cursor: grab;
    touch-action: none;
    outline: none;
  }

  svg.holding {
    cursor: grabbing;
  }

  .groove {
    fill: none;
    stroke: rgba(60, 44, 28, 0.16);
    stroke-width: 4;
    stroke-linecap: round;
  }

  .grown {
    fill: none;
    stroke: #557a3a;
    stroke-width: 3.4;
    stroke-linecap: round;
  }

  .leaf {
    fill: #93b865;
    stroke: #33291f;
    stroke-width: 0.9;
    stroke-linejoin: round;
    transform: translate(var(--x), var(--y)) scale(calc(var(--side) * 0), 0);
    transition: transform 0.45s cubic-bezier(0.25, 0.8, 0.3, 1.5);
  }

  /* Each leaf unfolds outward and a little upward, on its own side. */
  .leaf.out {
    transform: translate(var(--x), var(--y)) rotate(calc(var(--side) * -28deg)) scale(calc(var(--side) * var(--s)), var(--s));
  }

  .bud {
    filter: drop-shadow(0 2px 4px rgba(20, 14, 6, 0.38));
    transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.3, 1.4);
  }

  .bud-body {
    fill: #46682f;
    stroke: rgba(255, 252, 246, 0.95);
    stroke-width: 2.6;
  }

  .bud-arrows {
    fill: none;
    stroke: #fffaf0;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  svg:hover .bud,
  svg.holding .bud {
    transform: scale(1.12);
  }

  svg:focus-visible .bud-body {
    stroke: var(--accent);
  }

  /* Until it has been used, the bud bobs gently to say it can be moved. */
  svg.beckon .bud {
    animation: beckon 2.4s ease-in-out infinite;
  }

  @keyframes beckon {
    0%, 100% { transform: translateY(0); }
    25% { transform: translateY(-4px); }
    50% { transform: translateY(0); }
    75% { transform: translateY(4px); }
  }

  .hint {
    position: absolute;
    right: calc(100% + 0.9rem);
    transform: translateY(-50%);
    width: 8.6rem;
    padding: 0.45rem 0.7rem 0.5rem;
    border-radius: 16px 12px 15px 13px;
    font-size: 0.74rem;
    line-height: 1.35;
    color: var(--ink-dim);
    background: var(--sheen), var(--glass);
    backdrop-filter: var(--frost);
    -webkit-backdrop-filter: var(--frost);
    box-shadow: var(--rim), 0 6px 16px rgba(20, 14, 6, 0.18);
    pointer-events: none;
    animation: hint-in 0.5s 0.6s cubic-bezier(0.25, 0.8, 0.3, 1.2) both;
    transition: top 0.2s;
  }

  .hint b {
    display: block;
    font-family: var(--serif);
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--ink);
  }

  /* A little tail pointing at the bud. */
  .hint::after {
    content: '';
    position: absolute;
    top: 50%;
    right: -0.42rem;
    width: 0.8rem;
    height: 0.8rem;
    transform: translateY(-50%) rotate(45deg);
    background: rgba(250, 245, 236, 0.5);
    box-shadow: 1px -1px 0 rgba(255, 255, 255, 0.5);
    clip-path: polygon(0 0, 100% 0, 100% 100%);
  }

  @keyframes hint-in {
    from {
      opacity: 0;
      transform: translate(8px, -50%);
    }
  }

  .pct {
    margin-top: 0.15rem;
    font-family: var(--serif);
    font-size: 0.95rem;
    font-weight: 560;
    font-variant-numeric: tabular-nums;
    font-variation-settings: 'SOFT' 100;
    color: var(--ink);
  }

  .pct small {
    font-size: 0.7em;
    font-weight: 500;
    color: var(--ink-dim);
  }

  .buttons {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.35rem;
    padding-top: 0.4rem;
    border-top: 1px solid rgba(60, 44, 28, 0.12);
  }

  .buttons button {
    width: 2.35rem;
    height: 2.25rem;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 52% 48% 55% 45% / 47% 55% 45% 53%;
    background: rgba(164, 187, 140, 0.55);
    color: #2a4419;
    --glyph-wash: #fffaf0;
    --glyph-wash-opacity: 0.75;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
    cursor: pointer;
    transition:
      transform 0.3s cubic-bezier(0.25, 0.8, 0.3, 1.4),
      background 0.2s;
  }

  .buttons button + button {
    border-radius: 46% 54% 49% 51% / 55% 46% 54% 45%;
  }

  .buttons button:hover {
    background: rgba(164, 187, 140, 0.85);
    transform: rotate(-6deg) scale(1.06);
  }

  @media (max-width: 640px) {
    .stem {
      right: 0.6rem;
      width: 3.4rem;
    }
    svg {
      height: 9rem;
    }
  }
</style>
