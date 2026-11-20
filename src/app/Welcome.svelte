<script lang="ts">
  /**
   * The welcome: a small card over the garden on a first visit, saying what
   * this is and who made it, with a sapling that draws itself — trunk first,
   * then branch by branch, the way the turtle grows a tree — and leafs out.
   *
   * Meant to grow into a tour of the app later; for now it is a hello.
   */
  import { onMount } from 'svelte';
  import { cut } from './components/paper';
  import Glyph from './components/Glyph.svelte';

  interface Props {
    onclose: () => void;
    /** Close, and start the tour. */
    ontour: () => void;
  }

  let { onclose, ontour }: Props = $props();

  let button = $state<HTMLButtonElement>();
  /** Where focus was before, to hand it back on the way out. */
  const returnFocus = document.activeElement as HTMLElement | null;

  function close() {
    onclose();
    returnFocus?.focus?.();
  }

  onMount(() => {
    button?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The sapling: each branch is drawn in after the one it grows from, so it
  // reads as growing rather than as being traced.
  const branches = [
    { d: 'M60 112 C60 100 59 90 60 78', at: 0.15 },
    { d: 'M60 92 C53 86 47 82 40 78', at: 0.55 },
    { d: 'M60 86 C67 80 73 77 81 73', at: 0.7 },
    { d: 'M60 78 C60 70 61 63 60 55', at: 0.8 },
    { d: 'M44 80 C40 74 38 69 37 64', at: 1.05 },
    { d: 'M76 75 C80 70 83 66 84 60', at: 1.15 },
    { d: 'M60 64 C54 60 50 56 47 51', at: 1.2 },
    { d: 'M60 60 C66 56 70 52 72 47', at: 1.3 },
  ];
  const leaves = [
    { x: 37, y: 62, r: 7, at: 1.45, c: '#8fb34f' },
    { x: 40, y: 75, r: 5.5, at: 1.5, c: '#a6c25e' },
    { x: 84, y: 58, r: 7, at: 1.55, c: '#7fa645' },
    { x: 81, y: 71, r: 5.5, at: 1.6, c: '#9bbb55' },
    { x: 47, y: 49, r: 7.5, at: 1.65, c: '#86ad4a' },
    { x: 72, y: 45, r: 7.5, at: 1.7, c: '#93b752' },
    { x: 60, y: 52, r: 8.5, at: 1.75, c: '#7ba243' },
    { x: 53, y: 41, r: 6.5, at: 1.85, c: '#a2c25b' },
    { x: 66, y: 39, r: 6, at: 1.9, c: '#8db34e' },
  ];
  const blossoms = [
    { x: 45, y: 58, at: 2.1 },
    { x: 77, y: 52, at: 2.2 },
    { x: 63, y: 44, at: 2.3 },
  ];
</script>

<div
  class="scrim"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) close();
  }}
>
  <div class="wrap">
    <div class="card" role="dialog" aria-modal="true" aria-labelledby="welcome-title" use:cut={{ seed: 'welcome', inset: 6, radius: [20, 40], bulge: [-1, 4] }}>
      <svg class="sapling" viewBox="0 0 120 120" aria-hidden="true">
        <ellipse class="ground" cx="60" cy="113" rx="34" ry="5" />
        {#each branches as b, i (i)}
          <path d={b.d} pathLength="1" class="branch" class:trunk={i === 0} style="--at: {b.at}s" />
        {/each}
        {#each leaves as l, i (i)}
          <circle cx={l.x} cy={l.y} r={l.r} fill={l.c} class="leaf" style="--at: {l.at}s; transform-origin: {l.x}px {l.y}px" />
        {/each}
        {#each blossoms as f, i (i)}
          <circle cx={f.x} cy={f.y} r="2.3" class="blossom" style="--at: {f.at}s; transform-origin: {f.x}px {f.y}px" />
        {/each}
      </svg>

      <h2 id="welcome-title">Welcome to Arbor</h2>
      <p class="lede">A little garden where trees grow from sentences.</p>
      <p>
        Every tree here is an <a href="https://en.wikipedia.org/wiki/L-system" target="_blank" rel="noopener noreferrer"><b>L-system</b></a>: a few rewriting rules, applied over and over, that a turtle then walks
        into trunk, branches and leaves. Pick a species, turn the seasons, or rewrite its grammar and watch it grow
        again.
      </p>

      <div class="choices">
        <button bind:this={button} class="go" onclick={close} use:cut={{ seed: 'welcome-go', inset: 1.5, radius: [12, 20], bulge: [-0.4, 1.6] }}>
          Start growing
        </button>
        <button class="around" onclick={ontour} use:cut={{ seed: 'welcome-around', inset: 1.5, radius: [12, 20], bulge: [-0.4, 1.6] }}>
          <span class="map" aria-hidden="true"><Glyph name="map" size={20} weight={1.8} /></span>
          Show me around
        </button>
      </div>

      <p class="credit">
        Made with care by <a href="https://eliaboutorabi.github.io/" target="_blank" rel="noopener noreferrer"><b>Elham Aboutorabi</b></a>
      </p>
    </div>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 45;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: rgba(22, 16, 10, 0.32);
    animation: scrim-in 0.5s ease-out both;
  }

  @keyframes scrim-in {
    from {
      background: rgba(22, 16, 10, 0);
    }
  }

  .wrap {
    width: min(420px, calc(100vw - 2rem));
    filter: drop-shadow(0 24px 44px rgba(10, 6, 2, 0.34)) drop-shadow(0 3px 8px rgba(10, 6, 2, 0.18));
    animation: card-in 0.6s cubic-bezier(0.2, 0.9, 0.3, 1.15) 0.1s both;
  }

  @keyframes card-in {
    from {
      opacity: 0;
      transform: translateY(22px) scale(0.95) rotate(-0.8deg);
    }
  }

  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 1.6rem 2rem 1.5rem;
    color: var(--ink);
    background:
      var(--paper-grain),
      linear-gradient(172deg, #fcf8ef, #f4ebdb 70%, #efe4d0);
  }

  .sapling {
    width: 128px;
    height: 128px;
    margin-bottom: 0.2rem;
    overflow: visible;
  }

  .ground {
    fill: rgba(120, 140, 70, 0.22);
    animation: fade 0.6s ease-out 0.1s both;
  }

  .branch {
    fill: none;
    stroke: #6e5136;
    stroke-width: 2.6;
    stroke-linecap: round;
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    animation: draw 0.55s cubic-bezier(0.4, 0, 0.3, 1) var(--at) forwards;
  }

  .branch.trunk {
    stroke-width: 4.6;
  }

  .leaf {
    opacity: 0.95;
    transform: scale(0);
    animation: pop 0.5s cubic-bezier(0.3, 1.6, 0.5, 1) var(--at) forwards;
  }

  .blossom {
    fill: #f4b8c8;
    stroke: #fff4f6;
    stroke-width: 0.8;
    transform: scale(0);
    animation: pop 0.45s cubic-bezier(0.3, 1.8, 0.5, 1) var(--at) forwards;
  }

  @keyframes draw {
    to {
      stroke-dashoffset: 0;
    }
  }

  @keyframes pop {
    to {
      transform: scale(1);
    }
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  h2 {
    margin: 0.1rem 0 0.25rem;
    font-family: var(--serif);
    font-size: 1.7rem;
    font-weight: 600;
    font-variation-settings: 'SOFT' 100;
    letter-spacing: -0.01em;
  }

  p {
    margin: 0 0 0.85rem;
    font-size: 0.95rem;
    line-height: 1.5;
    color: var(--ink-dim);
  }

  .lede {
    font-family: var(--serif);
    font-style: italic;
    font-size: 1.05rem;
    color: var(--ink);
    margin-bottom: 0.7rem;
  }

  b {
    font-weight: 650;
    color: var(--ink);
  }

  .choices {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.6rem;
    margin: 0.3rem 0 1rem;
  }

  /*
   * The way into the tour: warm honey, the colour of the little "?" seeds
   * that open it from everywhere else, so the two read as one thing. An equal
   * partner to Start growing, not a pale afterthought beside it.
   */
  .around {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.7rem 1.35rem 0.7rem 1.1rem;
    font: inherit;
    font-weight: 650;
    font-size: 1rem;
    color: #fffaf0;
    background: linear-gradient(180deg, #e2ad55, #c4842a);
    border: 0;
    cursor: pointer;
    transition:
      transform 0.18s cubic-bezier(0.3, 1.6, 0.5, 1),
      filter 0.18s ease;
  }

  .around .map {
    display: grid;
    place-items: center;
    color: #fffaf0;
    --glyph-wash: #fff3d6;
    --glyph-wash-opacity: 0.45;
    transition: transform 0.35s cubic-bezier(0.3, 1.8, 0.5, 1);
  }

  .around:hover {
    transform: translateY(-1px) scale(1.03);
    filter: brightness(1.06);
  }

  .around:hover .map {
    transform: rotate(-10deg) scale(1.12);
  }

  .around:active,
  .go:active {
    transform: scale(0.98);
  }

  .around:focus-visible {
    outline: 2px solid #c4842a;
    outline-offset: 3px;
  }

  /* The two links: the ink's own colour, underlined softly in green. */
  a {
    color: inherit;
    text-decoration: underline;
    text-decoration-color: rgba(95, 139, 56, 0.45);
    text-decoration-thickness: 1.5px;
    text-underline-offset: 3px;
    transition:
      color 0.2s,
      text-decoration-color 0.2s;
  }

  a:hover {
    color: #4d7330;
    text-decoration-color: #5f8b38;
  }

  a:hover b {
    color: #4d7330;
  }

  a:focus-visible {
    outline: 2px solid #5f8b38;
    outline-offset: 2px;
    border-radius: 3px;
  }

  .go {
    padding: 0.7rem 1.6rem;
    font: inherit;
    font-weight: 650;
    font-size: 1rem;
    color: #fbf7ee;
    background: linear-gradient(180deg, #7aa54a, #5f8b38);
    border: 0;
    cursor: pointer;
    transition:
      transform 0.18s cubic-bezier(0.3, 1.6, 0.5, 1),
      filter 0.18s ease;
  }

  .go:hover {
    transform: translateY(-1px) scale(1.03);
    filter: brightness(1.06);
  }

  .go:active {
    transform: scale(0.98);
  }

  .go:focus-visible {
    outline: 2px solid #5f8b38;
    outline-offset: 3px;
  }

  .credit {
    margin: 0;
    font-size: 0.82rem;
    color: var(--ink-faint);
  }

  @media (prefers-reduced-motion: reduce) {
    .scrim,
    .wrap,
    .ground,
    .branch,
    .leaf,
    .blossom {
      animation-duration: 0.01s;
      animation-delay: 0s;
    }
  }
</style>
