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
    <span class="end small"><Icon icon={from} size={15} strokeWidth={1.7} /></span>
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
    <span class="end"><Icon icon={to} size={19} strokeWidth={1.7} /></span>
  </div>
</div>

<style>
  .pic {
    margin-bottom: 0.85rem;
  }

  .caption {
    display: block;
    margin-bottom: 0.3rem;
    font-size: 0.64rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .end {
    flex: none;
    width: 1.3rem;
    display: grid;
    place-items: center;
    color: var(--ink-dim);
  }

  .end.small {
    opacity: 0.7;
  }

  .track {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
  }

  input[type='range'] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 6px;
    border-radius: 6px;
    background: linear-gradient(
      to right,
      rgba(240, 176, 100, 0.55) 0%,
      var(--accent) var(--fill),
      rgba(255, 255, 255, 0.1) var(--fill),
      rgba(255, 255, 255, 0.1) 100%
    );
    outline: none;
    cursor: pointer;
  }

  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff8ef;
    border: 3px solid var(--accent);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    transition: transform 0.14s cubic-bezier(0.3, 0.7, 0.4, 1.5);
  }

  input[type='range']:hover::-webkit-slider-thumb,
  input[type='range']:active::-webkit-slider-thumb,
  input[type='range']:focus-visible::-webkit-slider-thumb {
    transform: scale(1.18);
  }

  input[type='range']::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff8ef;
    border: 3px solid var(--accent);
  }

  .bubble {
    position: absolute;
    left: var(--fill);
    bottom: calc(100% + 0.45rem);
    transform: translate(-50%, 4px);
    padding: 0.12rem 0.42rem;
    border-radius: 6px;
    font-family: var(--mono);
    font-size: 0.62rem;
    color: #21160c;
    background: var(--accent);
    opacity: 0;
    pointer-events: none;
    white-space: nowrap;
    transition:
      opacity 0.12s,
      transform 0.12s;
  }

  .bubble.show {
    opacity: 1;
    transform: translate(-50%, 0);
  }
</style>
