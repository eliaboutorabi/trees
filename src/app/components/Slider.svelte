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
    margin-bottom: 0.7rem;
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
    font-weight: 700;
    color: var(--ink-dim);
  }

  .mark {
    margin-left: 0.3em;
    font-size: 0.9em;
    opacity: 0.5;
  }

  .slider__value {
    font-family: var(--mono);
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--tone-ink);
    font-variant-numeric: tabular-nums;
  }

  input[type='range'] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 6px;
    border-radius: 6px;
    background: linear-gradient(
      to right,
      var(--tone) 0%,
      var(--tone) var(--fill),
      var(--paper-3) var(--fill),
      var(--paper-3) 100%
    );
    outline: none;
    cursor: pointer;
  }

  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: #fff;
    border: 3px solid var(--tone-ink);
    box-shadow: 0 1px 4px rgba(70, 45, 25, 0.3);
    transition: transform 0.12s ease;
  }

  input[type='range']:hover::-webkit-slider-thumb,
  input[type='range']:focus-visible::-webkit-slider-thumb {
    transform: scale(1.22);
  }

  input[type='range']::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #fff;
    border: 3px solid var(--tone-ink);
  }
</style>
