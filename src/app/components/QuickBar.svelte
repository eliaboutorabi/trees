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
  import Hint from './Hint.svelte';

  interface Props {
    items: Quick[];
    /** Open the tour at one of these switches. */
    onhelp?: (id: string) => void;
  }

  let { items, onhelp }: Props = $props();

  const SHAPES = [
    ['52% 48% 55% 45% / 47% 55% 45% 53%', -2],
    ['46% 54% 49% 51% / 55% 46% 54% 45%', 2.5],
    ['55% 45% 51% 49% / 50% 56% 44% 50%', -1.5],
    ['49% 51% 45% 55% / 45% 50% 50% 55%', 2],
  ] as const;
</script>

<div class="quick" data-keep-clear data-tour="quick" role="toolbar" aria-label="Scene" aria-orientation="vertical">
  {#each items as q, i (q.id)}
    <Hint label={q.label} side="right" onhelp={onhelp ? () => onhelp(q.id) : undefined}>
    <button
      class="pebble"
      class:on={q.on}
      style="--tone: {q.tone}; --tone-ink: {q.toneInk}; --shape: {SHAPES[i % SHAPES.length][0]}; --tilt: {SHAPES[i % SHAPES.length][1]}deg"
      aria-pressed={q.on}
      aria-label={q.label}
      data-tour="quick-{q.id}"
      onclick={q.toggle}
    >
      <Glyph name={q.icon} size={23} weight={1.75} />
    </button>
    </Hint>
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
      color 0.25s,
      --tone 0.6s;
  }

  .pebble:hover {
    transform: translateX(2px) rotate(calc(var(--tilt) * -0.6)) scale(1.06);
    color: var(--ink);
  }

  /*
   * On: filled with its colour, the drawing inked deep and coloured in with
   * light. The fill is a layer that fades in, so switching glides.
   */
  .pebble {
    isolation: isolate;
  }

  .pebble::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    background:
      var(--sheen),
      radial-gradient(130% 120% at 30% 20%, color-mix(in srgb, var(--tone) 88%, white 12%), color-mix(in srgb, var(--tone) 70%, transparent));
    opacity: 0;
    transition: opacity 0.35s;
  }

  .pebble.on::before {
    opacity: 1;
  }

  .pebble.on {
    color: color-mix(in srgb, var(--tone-ink) 82%, #000 18%);
    --glyph-wash: #fffaf0;
    --glyph-wash-opacity: 0.72;
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
