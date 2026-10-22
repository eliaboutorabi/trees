<script lang="ts">
  interface Props {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    hint?: string;
    format?: (v: number) => string;
    /** Marks a control that only takes effect on the next redraw. */
    needsRedraw?: boolean;
  }

  let { label, value = $bindable(), min, max, step = 0.01, hint, format, needsRedraw = false }: Props = $props();

  const shown = $derived(format ? format(value) : value.toFixed(step >= 1 ? 0 : 2));
  const fill = $derived(((value - min) / (max - min)) * 100);
</script>

<label class="slider" title={hint ?? label}>
  <span class="slider__head">
    <span class="slider__label">
      {label}{#if needsRedraw}<span class="mark" title="Rebuilds the tree a moment after you stop">↻</span>{/if}
    </span>
    <span class="slider__value">{shown}</span>
  </span>
  <input
    type="range"
    {min}
    {max}
    {step}
    bind:value
    style="--fill: {fill}%"
    aria-label={label}
  />
</label>

<style>
  .slider {
    display: block;
    margin-bottom: 0.75rem;
  }

  .slider__head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
    margin-bottom: 0.3rem;
  }

  .slider__label {
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--ink-dim);
  }

  .mark {
    margin-left: 0.3em;
    font-size: 0.9em;
    opacity: 0.5;
  }

  .slider__value {
    font-family: var(--serif);
    font-size: 0.8rem;
    font-weight: 560;
    color: var(--tone-ink);
    font-variant-numeric: tabular-nums;
  }

  input[type='range'] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 5px;
    border-radius: 5px;
    background: linear-gradient(
      to right,
      var(--tone) 0%,
      var(--tone) var(--fill),
      rgba(60, 44, 28, 0.13) var(--fill),
      rgba(60, 44, 28, 0.13) 100%
    );
    box-shadow: inset 0 1px 2px rgba(28, 20, 10, 0.14);
    outline: none;
    cursor: pointer;
  }

  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 13px;
    height: 13px;
    border-radius: 50% 46% 54% 48%;
    background: var(--tone-ink);
    border: 2px solid rgba(255, 255, 255, 0.7);
    box-shadow: 0 1px 4px rgba(28, 20, 10, 0.3);
    transition: transform 0.2s cubic-bezier(0.25, 0.8, 0.3, 1.4);
  }

  input[type='range']:hover::-webkit-slider-thumb,
  input[type='range']:focus-visible::-webkit-slider-thumb {
    transform: scale(1.2);
  }

  input[type='range']::-moz-range-thumb {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--tone-ink);
    border: 2px solid rgba(255, 255, 255, 0.7);
  }
</style>
