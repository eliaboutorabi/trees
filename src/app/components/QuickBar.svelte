<script lang="ts" module>
  import type { Snippet } from 'svelte';
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
    /**
     * A panel that comes out beside it in place of the label: on hover or
     * focus with a mouse, on a tap with a finger (where the panel then carries
     * the switch). Told whether it is showing.
     */
    panel?: Snippet<[boolean]>;
    /** Laid aside: dimmed, saying why on its label, and not pressed. */
    disabled?: boolean;
    why?: string;
    /** The pointer has come to it, or the focus: a press may be coming, and whatever it needs can be got ready. */
    intent?: () => void;
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
    /** Any switch pressed, after it has done its work. */
    onpress?: (id: string) => void;
  }

  let { items, onhelp, onpress }: Props = $props();

  // The one panel that is out, if any. It comes out after the briefest pause
  // (so passing over the button on the way somewhere does not throw it open)
  // and goes after a longer one (so a pointer that strays off it for a moment
  // does not lose it).
  let panelOut = $state<string | null>(null);
  let timer = 0;
  let touched = false;
  function want(id: string | null, delay: number) {
    clearTimeout(timer);
    timer = window.setTimeout(() => (panelOut = id), delay);
  }

  const SHAPES = [
    ['52% 48% 55% 45% / 47% 55% 45% 53%', -2],
    ['46% 54% 49% 51% / 55% 46% 54% 45%', 2.5],
    ['55% 45% 51% 49% / 50% 56% 44% 50%', -1.5],
    ['49% 51% 45% 55% / 45% 50% 50% 55%', 2],
  ] as const;
</script>

<div class="quick" data-keep-clear data-tour="quick" role="toolbar" aria-label="Scene" aria-orientation="vertical">
  {#each items as q, i (q.id)}
    {#snippet pebble(expanded?: boolean)}
      <button
        class="pebble"
        class:on={q.on}
        class:off={q.disabled}
        aria-disabled={q.disabled}
        style="--tone: {q.tone}; --tone-ink: {q.toneInk}; --shape: {SHAPES[i % SHAPES.length][0]}; --tilt: {SHAPES[i % SHAPES.length][1]}deg"
        aria-pressed={q.on}
        aria-label={q.label}
        aria-expanded={expanded}
        data-tour="quick-{q.id}"
        onpointerdown={(e) => (touched = e.pointerType === 'touch')}
        onpointerenter={() => q.intent?.()}
        onfocus={() => q.intent?.()}
        onclick={() => {
          if (q.disabled) return;
          // A finger has no hover: its tap brings the panel out, and the
          // switch is in there.
          if (q.panel && touched) {
            panelOut = panelOut === q.id ? null : q.id;
            return;
          }
          q.toggle();
          onpress?.(q.id);
        }}
      >
        <Glyph name={q.icon} size={23} weight={1.75} />
      </button>
    {/snippet}
    {#if q.panel}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span
        class="popout"
        class:out={panelOut === q.id}
        onpointerenter={(e) => e.pointerType !== 'touch' && want(q.id, 90)}
        onpointerleave={(e) => e.pointerType !== 'touch' && want(null, 320)}
        onfocusin={() => want(q.id, 0)}
        onfocusout={(e) => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) want(null, 0);
        }}
        onkeydown={(e) => e.key === 'Escape' && want(null, 0)}
      >
        {@render pebble(panelOut === q.id)}
        <span class="panel" role="dialog" aria-label={q.label}>{@render q.panel(panelOut === q.id)}</span>
      </span>
    {:else}
      <Hint label={q.disabled && q.why ? `${q.label} · ${q.why}` : q.label} side="right" onhelp={onhelp && !q.disabled ? () => onhelp(q.id) : undefined}>
        {@render pebble()}
      </Hint>
    {/if}
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

  /*
   * A panel out beside its pebble, the way the labels come out, only larger:
   * frosted, tilted a hair, and sprung into place. An invisible bridge spans
   * the gap so the pointer can cross to it.
   */
  .popout {
    position: relative;
    display: inline-flex;
  }

  /* It grows upward from its pebble, which is the lowest, clear of the dock below. */
  .panel {
    position: absolute;
    left: calc(100% + 0.7rem);
    bottom: -0.5rem;
    z-index: 30;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translate(-8px, 0) rotate(0.8deg) scale(0.95);
    transform-origin: 0 90%;
    transition:
      opacity 0.2s,
      transform 0.28s cubic-bezier(0.3, 1.35, 0.5, 1),
      visibility 0s linear 0.28s;
  }

  .panel::before {
    content: '';
    position: absolute;
    inset: 0 100% 0 -0.9rem;
  }

  .popout.out .panel {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transform: translate(0, 0) rotate(0.8deg);
    transition:
      opacity 0.2s,
      transform 0.28s cubic-bezier(0.3, 1.35, 0.5, 1),
      visibility 0s;
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

  .pebble.off {
    opacity: 0.38;
    filter: saturate(0.3);
    cursor: default;
  }

  .pebble:not(.off):hover {
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
