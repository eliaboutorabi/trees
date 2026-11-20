<script lang="ts">
  /**
   * The map: every part of the tour laid out on one sheet, to open any one of
   * on its own, or to set off on the whole walk from the start.
   *
   * Each part is a little plot, washed in the colour of the button it is
   * about, so the map reads as a garden plan rather than a table of contents.
   */
  import { onMount } from 'svelte';
  import Glyph from '../components/Glyph.svelte';
  import { cut } from '../components/paper';
  import { PARTS } from './chapters';

  interface Props {
    /** Play these chapters, or all of them if none are named. */
    onplay: (chapters?: string[]) => void;
    onclose: () => void;
  }

  let { onplay, onclose }: Props = $props();

  /** Each part's colour: the tone of the button it is about. */
  const TONES: Record<string, string> = {
    top: '#dbb66f',
    scene: '#bba8d0',
    grow: '#a4bb8c',
    species: '#93c3a0',
    season: '#d9c47e',
    weather: '#9fcbc3',
    wildlife: '#e6bf94',
    shape: '#a4bb8c',
    foliage: '#c4cc8f',
    bloom: '#d99ca6',
    light: '#dbb66f',
    wind: '#a9c4d8',
    look: '#bba8d0',
    grammar: '#d6c9b1',
    touch: '#e6bf94',
  };

  let whole = $state<HTMLButtonElement>();
  const returnFocus = document.activeElement as HTMLElement | null;

  function close() {
    onclose();
    returnFocus?.focus?.();
  }

  onMount(() => {
    whole?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<div
  class="scrim"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) close();
  }}
>
  <div class="wrap">
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="map-title" use:cut={{ seed: 'tour-map', inset: 6, radius: [22, 44], bulge: [-1, 5] }}>
      <header>
        <span class="mark illustrated"><Glyph name="map" size={34} weight={1.5} /></span>
        <div class="heading">
          <h2 id="map-title">The map</h2>
          <p>Every part of Arbor, to explore on its own, or the whole walk from the start.</p>
        </div>
        <button class="close" onclick={close} aria-label="Close the map">
          <Glyph name="close" size={20} />
        </button>
      </header>

      <button bind:this={whole} class="whole" onclick={() => onplay()} use:cut={{ seed: 'tour-whole', inset: 1.5, radius: [14, 24], bulge: [-0.4, 1.8] }}>
        <Glyph name="play" size={18} weight={1.9} />
        <span>
          <b>Take the whole tour</b>
          <small>Every part, one after another, about three minutes</small>
        </span>
      </button>

      <ol class="plots">
        {#each PARTS as part, i (part.id)}
          <li style="--tone: {TONES[part.id] ?? '#c9cf98'}; --i: {i}">
            <button class="plot" onclick={() => onplay([part.id])}>
              <span class="badge illustrated"><Glyph name={part.icon} size={24} weight={1.7} /></span>
              <span class="words">
                <b>{part.title}</b>
                <small>{part.blurb}</small>
              </span>
              <span class="steps" aria-label="{part.steps.length} steps">{part.steps.length}</span>
            </button>
          </li>
        {/each}
      </ol>
    </div>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: rgba(22, 16, 10, 0.4);
    animation: scrim-in 0.3s ease-out both;
  }

  @keyframes scrim-in {
    from {
      background: rgba(22, 16, 10, 0);
    }
  }

  .wrap {
    width: min(760px, calc(100vw - 2rem));
    max-height: calc(100dvh - 2rem);
    display: flex;
    filter: drop-shadow(0 26px 50px rgba(10, 6, 2, 0.38)) drop-shadow(0 3px 8px rgba(10, 6, 2, 0.2));
    animation: sheet-in 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.15) both;
  }

  @keyframes sheet-in {
    from {
      opacity: 0;
      transform: translateY(18px) scale(0.97) rotate(0.5deg);
    }
  }

  .sheet {
    width: 100%;
    overflow: auto;
    padding: 1.3rem 1.6rem 1.6rem;
    color: var(--ink);
    background:
      var(--paper-grain),
      linear-gradient(172deg, #fcf8ef, #f4ebdb 70%, #efe4d0);
    scrollbar-width: thin;
  }

  header {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    margin-bottom: 1rem;
  }

  .mark {
    display: grid;
    place-items: center;
    color: #3f5b66;
    --glyph-wash: #b8d3dc;
    --glyph-wash-opacity: 0.65;
  }

  .heading {
    flex: 1;
    min-width: 0;
  }

  h2 {
    margin: 0;
    font-family: var(--serif);
    font-size: 1.55rem;
    font-weight: 600;
    font-variation-settings: 'SOFT' 100;
  }

  header p {
    margin: 0.15rem 0 0;
    font-size: 0.92rem;
    color: var(--ink-dim);
  }

  .close {
    display: grid;
    place-items: center;
    width: 2.3rem;
    height: 2.3rem;
    border: none;
    border-radius: 50%;
    color: var(--ink-dim);
    background: rgba(36, 29, 22, 0.06);
    cursor: pointer;
    transition: background 0.2s;
  }
  .close:hover {
    background: rgba(36, 29, 22, 0.11);
  }

  .whole {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    width: 100%;
    margin-bottom: 1.1rem;
    padding: 0.85rem 1.2rem;
    border: none;
    text-align: left;
    font: inherit;
    color: #fbf7ee;
    background: linear-gradient(180deg, #7aa54a, #5f8b38);
    cursor: pointer;
    transition:
      transform 0.2s cubic-bezier(0.3, 1.6, 0.5, 1),
      filter 0.2s;
  }
  .whole:hover {
    transform: translateY(-1px) scale(1.01);
    filter: brightness(1.05);
  }
  .whole span {
    display: flex;
    flex-direction: column;
  }
  .whole b {
    font-family: var(--serif);
    font-size: 1.12rem;
    font-weight: 600;
  }
  .whole small {
    font-size: 0.8rem;
    opacity: 0.85;
  }

  /* The plots, settling in one after another as the sheet opens. */
  .plots {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 0.7rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .plots li {
    animation: plot-in 0.4s cubic-bezier(0.3, 1.3, 0.5, 1) both;
    animation-delay: calc(0.12s + var(--i) * 0.03s);
  }

  @keyframes plot-in {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.97);
    }
  }

  .plot {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.7rem;
    width: 100%;
    height: 100%;
    padding: 0.65rem 0.75rem;
    border: none;
    border-radius: 18px 14px 20px 13px / 14px 20px 13px 18px;
    text-align: left;
    font: inherit;
    color: var(--ink);
    background:
      radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--tone) 34%, transparent), transparent 70%),
      rgba(255, 252, 244, 0.7);
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--tone) 45%, transparent) inset,
      0 4px 12px rgba(40, 28, 12, 0.06);
    cursor: pointer;
    transition:
      transform 0.25s cubic-bezier(0.3, 1.5, 0.5, 1),
      box-shadow 0.2s;
  }
  .plot:hover {
    transform: translateY(-2px) rotate(-0.4deg);
    box-shadow:
      0 0 0 1.5px color-mix(in srgb, var(--tone) 80%, transparent) inset,
      0 8px 18px rgba(40, 28, 12, 0.1);
  }
  .plot:focus-visible,
  .whole:focus-visible,
  .close:focus-visible {
    outline: 2px solid #5f8b38;
    outline-offset: 2px;
  }

  .badge {
    flex: none;
    display: grid;
    place-items: center;
    width: 2.6rem;
    height: 2.5rem;
    border-radius: 52% 48% 55% 45% / 47% 55% 45% 53%;
    color: color-mix(in srgb, var(--tone) 40%, #2a2016);
    background: color-mix(in srgb, var(--tone) 70%, white 30%);
    --glyph-wash: #fffaf0;
    --glyph-wash-opacity: 0.7;
  }

  .words {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .words b {
    font-family: var(--serif);
    font-size: 1rem;
    font-weight: 600;
  }
  .words small {
    font-size: 0.8rem;
    line-height: 1.35;
    color: var(--ink-dim);
  }

  .steps {
    margin-left: auto;
    align-self: flex-start;
    font-size: 0.7rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: color-mix(in srgb, var(--tone) 50%, #2a2016);
    opacity: 0.7;
  }

  @media (prefers-reduced-motion: reduce) {
    .scrim,
    .wrap,
    .plots li {
      animation: none;
    }
  }
</style>
