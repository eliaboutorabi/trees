<script lang="ts" module>
  import type { GlyphName } from './glyphs';

  export interface Quick {
    id: string;
    label: string;
    icon: GlyphName;
    on: boolean;
    /** The pebble's colour when on, and the ink drawn on it. */
    tone: string;
    toneInk: string;
    toggle: () => void;
  }
</script>

<script lang="ts">
  /**
   * The switches that belong to the whole scene rather than to any one card —
   * whether the camera circles, whether the background is soft, night or day.
   * They sit in a short column down the left edge, mirroring the growth stem
   * on the right: one tap each, always in reach, no card to open first.
   */
  import Glyph from './Glyph.svelte';

  interface Props {
    items: Quick[];
  }

  let { items }: Props = $props();

  const SHAPES = [
    ['52% 48% 55% 45% / 47% 55% 45% 53%', -2],
    ['46% 54% 49% 51% / 55% 46% 54% 45%', 2.5],
    ['55% 45% 51% 49% / 50% 56% 44% 50%', -1.5],
    ['49% 51% 45% 55% / 45% 50% 50% 55%', 2],
  ] as const;
</script>

<div class="quick" data-keep-clear role="toolbar" aria-label="Scene" aria-orientation="vertical">
  {#each items as q, i (q.id)}
    <button
      class="pebble"
      class:on={q.on}
      style="--tone: {q.tone}; --tone-ink: {q.toneInk}; --shape: {SHAPES[i % SHAPES.length][0]}; --tilt: {SHAPES[i % SHAPES.length][1]}deg"
      aria-pressed={q.on}
      aria-label={q.label}
      onclick={q.toggle}
    >
      <Glyph name={q.icon} size={23} weight={1.75} />
      <span class="tip">{q.label}</span>
    </button>
  {/each}
</div>

<style>
  .quick {
    position: absolute;
    left: 1.1rem;
    top: 50%;
    transform: translateY(-50%);
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }

  .pebble {
    position: relative;
    width: 2.9rem;
    height: 2.75rem;
    display: grid;
    place-items: center;
    border: none;
    border-radius: var(--shape);
    transform: rotate(var(--tilt));
    background: var(--sheen), var(--glass);
    backdrop-filter: var(--frost);
    -webkit-backdrop-filter: var(--frost);
    box-shadow: var(--rim), 0 8px 18px rgba(20, 14, 6, 0.2);
    color: var(--ink-dim);
    --glyph-wash: var(--tone);
    --glyph-wash-opacity: 0.55;
    cursor: pointer;
    transition:
      transform 0.35s cubic-bezier(0.25, 0.8, 0.3, 1.3),
      background-color 0.3s,
      color 0.25s;
  }

  .pebble:hover {
    transform: translateX(2px) rotate(calc(var(--tilt) * -0.6)) scale(1.06);
    color: var(--ink);
  }

  /* On: filled with its colour, the drawing inked deep and coloured in with light. */
  .pebble.on {
    background:
      var(--sheen),
      radial-gradient(130% 120% at 30% 20%, color-mix(in srgb, var(--tone) 88%, white 12%), color-mix(in srgb, var(--tone) 70%, transparent));
    color: color-mix(in srgb, var(--tone-ink) 82%, #000 18%);
    --glyph-wash: #fffaf0;
    --glyph-wash-opacity: 0.72;
  }

  .tip {
    position: absolute;
    left: calc(100% + 0.6rem);
    top: 50%;
    transform: translate(-4px, -50%) rotate(calc(var(--tilt) * -1));
    padding: 0.22rem 0.6rem 0.28rem;
    border-radius: 11px 9px 12px 8px;
    font-family: var(--serif);
    font-size: 0.82rem;
    font-weight: 500;
    font-variation-settings: 'SOFT' 100;
    white-space: nowrap;
    color: var(--ink);
    background: var(--sheen), var(--glass);
    backdrop-filter: var(--frost);
    -webkit-backdrop-filter: var(--frost);
    box-shadow: var(--rim), 0 6px 14px rgba(20, 14, 6, 0.16);
    opacity: 0;
    pointer-events: none;
    transition:
      opacity 0.18s,
      transform 0.18s;
  }

  @media (hover: hover) {
    .pebble:hover .tip {
      opacity: 1;
      transform: translate(0, -50%) rotate(calc(var(--tilt) * -1));
    }
  }

  @media (max-width: 640px) {
    .quick {
      left: 0.6rem;
      transition: opacity 0.25s;
    }
    .pebble {
      width: 2.6rem;
      height: 2.5rem;
    }
    /* A phone has no room for both: while a card is open, these step aside. */
    :global(body:has(.card)) .quick {
      opacity: 0;
      pointer-events: none;
    }
  }
</style>
