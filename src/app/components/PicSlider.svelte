<script lang="ts">
  /**
   * A slider that says what it does with pictures rather than numbers.
   *
   * An icon at each end shows what that direction means — a sapling and a tall
   * tree, a bare twig and a full crown — so the control can be understood
   * without reading anything. The number is still there for anyone who wants
   * it, in a little bubble over the thumb while it is being touched, and the
   * exact numeric sliders live under each card's Fine-tune fold.
   */
  import type { IconSvgElement } from '@hugeicons/svelte';
  import Icon from './Icon.svelte';

  interface Props {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    /** What the low end and the high end look like. */
    from: IconSvgElement;
    to: IconSvgElement;
    /** Shown in the bubble while dragging. */
    format?: (v: number) => string;
    hint?: string;
  }

  let { label, value = $bindable(), min, max, step = 0.01, from, to, format, hint }: Props = $props();

  const fill = $derived(((value - min) / (max - min)) * 100);
  const shown = $derived(format ? format(value) : value.toFixed(step >= 1 ? 0 : 2));
  let active = $state(false);
</script>

<div class="pic" title={hint ?? label}>
  <span class="caption">{label}</span>
  <div class="row">
    <span class="end small"><Icon icon={from} size={14} strokeWidth={2} /></span>
    <span class="track" style="--fill: {fill}%">
      <input
        type="range"
        {min}
        {max}
        {step}
        bind:value
        aria-label={label}
        onpointerdown={() => (active = true)}
        onpointerup={() => (active = false)}
        onpointercancel={() => (active = false)}
        onchange={() => (active = false)}
        onblur={() => (active = false)}
      />
      <span class="bubble" class:show={active}>{shown}</span>
    </span>
    <span class="end"><Icon icon={to} size={18} strokeWidth={2} /></span>
  </div>
</div>

<style>
  .pic {
    margin-bottom: 0.9rem;
  }

  .caption {
    display: block;
    margin-bottom: 0.3rem;
    font-family: var(--serif);
    font-size: 0.9rem;
    font-weight: 500;
    font-variation-settings: 'SOFT' 100;
    color: var(--ink-dim);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  /* What each end means, on a little pebble of the card's colour. */
  .end {
    flex: none;
    width: 1.75rem;
    height: 1.65rem;
    display: grid;
    place-items: center;
    border-radius: 52% 48% 55% 45% / 47% 55% 45% 53%;
    color: color-mix(in srgb, var(--tone-ink) 85%, #000 15%);
    background: color-mix(in srgb, var(--tone) 62%, rgba(255, 255, 255, 0.25));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6), 0 1px 3px rgba(20, 14, 6, 0.1);
  }

  .end.small {
    width: 1.5rem;
    height: 1.42rem;
    border-radius: 46% 54% 49% 51% / 55% 46% 54% 45%;
    background: color-mix(in srgb, var(--tone) 38%, rgba(255, 255, 255, 0.25));
  }

  .track {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
  }

  /*
   * A groove pressed into the frost, filled with the card's colour up to a
   * small seed you push along it.
   */
  input[type='range'] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 7px;
    border-radius: 7px;
    background: linear-gradient(
      to right,
      color-mix(in srgb, var(--tone) 80%, var(--tone-ink) 20%) 0%,
      var(--tone) var(--fill),
      rgba(60, 44, 28, 0.13) var(--fill),
      rgba(60, 44, 28, 0.13) 100%
    );
    box-shadow:
      inset 0 1px 2px rgba(28, 20, 10, 0.16),
      0 1px 0 rgba(255, 255, 255, 0.35);
    outline: none;
    cursor: pointer;
  }

  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 17px;
    height: 17px;
    border-radius: 50% 46% 54% 48% / 48% 54% 46% 50%;
    background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--tone-ink) 70%, white 30%), var(--tone-ink));
    border: 2px solid rgba(255, 255, 255, 0.7);
    box-shadow: 0 2px 6px rgba(28, 20, 10, 0.3);
    transition: transform 0.25s cubic-bezier(0.25, 0.8, 0.3, 1.4);
  }

  input[type='range']:hover::-webkit-slider-thumb,
  input[type='range']:active::-webkit-slider-thumb,
  input[type='range']:focus-visible::-webkit-slider-thumb {
    transform: scale(1.18) rotate(-12deg);
  }

  input[type='range']::-moz-range-thumb {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: var(--tone-ink);
    border: 2px solid rgba(255, 255, 255, 0.7);
  }

  .bubble {
    position: absolute;
    left: var(--fill);
    bottom: calc(100% + 0.45rem);
    transform: translate(-50%, 4px);
    padding: 0.1rem 0.5rem;
    border-radius: 9px 11px 8px 10px;
    font-family: var(--serif);
    font-size: 0.78rem;
    font-weight: 560;
    font-variant-numeric: tabular-nums;
    color: var(--chalk);
    background: color-mix(in srgb, var(--tone-ink) 88%, transparent);
    box-shadow: 0 3px 8px rgba(28, 20, 10, 0.22);
    opacity: 0;
    pointer-events: none;
    white-space: nowrap;
    transition:
      opacity 0.15s,
      transform 0.2s cubic-bezier(0.25, 0.8, 0.3, 1.3);
  }

  .bubble.show {
    opacity: 1;
    transform: translate(-50%, 0);
  }
</style>
