<script lang="ts">
  /**
   * How far the tree has grown, as a stem you pull up out of the ground.
   *
   * Dragging up grows the tree and dragging down takes it back towards the
   * seed, so the control moves the way the tree does. The stem itself grows
   * with it — leaves unfold along it as it passes them — so the slider shows
   * what it means without a word. Under it are the two ways to start over:
   * play the growth again, or plant a new seed.
   */
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

  // The stem runs up a 40 × 200 box, swaying a little as it goes.
  const BOTTOM = 192;
  const TOP = 12;
  const sway = (y: number) => 20 + 2.2 * Math.sin((BOTTOM - y) * 0.045) - 1.2 * Math.sin((BOTTOM - y) * 0.11);
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
  const LEAVES = [0.14, 0.27, 0.4, 0.52, 0.63, 0.73, 0.82, 0.9].map((t, i) => {
    const [x, y] = at(t);
    const side = i % 2 ? -1 : 1;
    return { t, x, y, side, size: 0.75 + 0.35 * Math.sin(t * Math.PI) };
  });

  const tip = $derived(at(value));
  const pct = $derived(Math.round(value * 100));

  let svg: SVGSVGElement;

  function place(e: PointerEvent) {
    const box = svg.getBoundingClientRect();
    const y = ((e.clientY - box.top) / box.height) * 200;
    onscrub(Math.min(1, Math.max(0, (BOTTOM - y) / (BOTTOM - TOP))));
  }

  function down(e: PointerEvent) {
    holding = true;
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
    e.preventDefault();
  }
</script>

<div class="stem">
  <span class="end top" aria-hidden="true"><Glyph name="grove" size={20} weight={1.8} /></span>

  <svg
    bind:this={svg}
    viewBox="0 0 40 200"
    class:holding
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
    <!-- the groove the stem grows up -->
    <path d={stem} class="groove" />
    <!-- the stem, drawn as far as the tree has grown -->
    <path d={stem} class="grown" pathLength="1" stroke-dasharray="{value} 1" />

    {#each LEAVES as l, i (i)}
      <path
        class="leaf"
        class:out={value >= l.t}
        d="M0 0c2.4-3.6 7.6-4.6 10.6-1.6-2.6 3.2-7.6 4-10.6 1.6z"
        style="--x: {l.x}px; --y: {l.y}px; --s: {l.size}; --side: {l.side}"
      />
    {/each}

    <!-- the bud at the tip, which is the handle -->
    <g transform="translate({tip[0]} {tip[1]})" class="bud">
      <circle r="11" class="halo" />
      <path d="M0 -6.5c3.2 1.8 4.4 5.4 2.4 8.6-1.2 1.4-3.6 1.4-4.8 0-2-3.2-.8-6.8 2.4-8.6z" class="bud-shape" />
    </g>
  </svg>

  <span class="end seed" aria-hidden="true"><Glyph name="seeds" size={16} weight={1.8} /></span>
  <span class="pct">{pct}<small>%</small></span>

  <div class="buttons">
    <button onclick={onreplay} title="Watch it grow again (space)" aria-label="Replay growth">
      <Glyph name="play" size={15} weight={1.8} />
    </button>
    <button onclick={onregrow} title="Plant a new seed (R)" aria-label="Grow again from seed">
      <Glyph name="sprout" size={18} weight={1.8} />
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
    gap: 0.15rem;
    width: 3.3rem;
    padding: 0.7rem 0 0.55rem;
    border-radius: 28px 24px 30px 22px / 22px 30px 24px 28px;
    color: var(--ink);
    background: var(--sheen), var(--glass);
    backdrop-filter: var(--frost);
    -webkit-backdrop-filter: var(--frost);
    box-shadow: var(--rim), 0 10px 26px rgba(20, 14, 6, 0.2);
    --glyph-wash: #fffaf0;
    --glyph-wash-opacity: 0.7;
  }

  .end {
    display: grid;
    place-items: center;
    color: #3d5a2b;
  }

  .end.seed {
    color: #6b4f2e;
  }

  svg {
    display: block;
    width: 2.3rem;
    height: 11.5rem;
    overflow: visible;
    cursor: grab;
    touch-action: none;
    outline: none;
  }

  svg.holding {
    cursor: grabbing;
  }

  svg:focus-visible .halo {
    stroke: var(--accent);
    stroke-opacity: 0.9;
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
    stroke-width: 3.2;
    stroke-linecap: round;
  }

  .leaf {
    fill: #7fa35a;
    stroke: #3d5a2b;
    stroke-width: 0.9;
    stroke-linejoin: round;
    transform: translate(var(--x), var(--y)) scale(calc(var(--side) * 0), 0);
    transition: transform 0.45s cubic-bezier(0.25, 0.8, 0.3, 1.5);
  }

  /* Each leaf unfolds outward and a little upward, on its own side. */
  .leaf.out {
    transform: translate(var(--x), var(--y)) rotate(calc(var(--side) * -28deg)) scale(calc(var(--side) * var(--s)), var(--s));
  }

  .halo {
    fill: rgba(255, 255, 255, 0.001);
    stroke: rgba(85, 122, 58, 0);
    stroke-width: 1.5;
    transition: stroke 0.2s;
  }

  svg:hover .halo,
  svg.holding .halo {
    stroke: rgba(85, 122, 58, 0.55);
  }

  .bud-shape {
    fill: #3d5a2b;
    stroke: rgba(255, 255, 255, 0.85);
    stroke-width: 1.6;
    filter: drop-shadow(0 1.5px 3px rgba(20, 14, 6, 0.35));
    transition: transform 0.25s cubic-bezier(0.25, 0.8, 0.3, 1.4);
  }

  svg:hover .bud-shape,
  svg.holding .bud-shape {
    transform: scale(1.18);
  }

  .pct {
    margin-top: 0.2rem;
    font-family: var(--serif);
    font-size: 0.92rem;
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
    width: 2.2rem;
    height: 2.1rem;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 52% 48% 55% 45% / 47% 55% 45% 53%;
    background: rgba(164, 187, 140, 0.5);
    color: #2f4a20;
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
    background: rgba(164, 187, 140, 0.8);
    transform: rotate(-6deg) scale(1.06);
  }

  @media (max-width: 640px) {
    .stem {
      right: 0.6rem;
      width: 2.9rem;
    }
    svg {
      height: 8.5rem;
    }
  }
</style>
