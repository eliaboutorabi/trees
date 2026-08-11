<script lang="ts">
  interface Props {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    hint?: string;
    format?: (v: number) => string;
  }

  let { label, value = $bindable(), min, max, step = 0.01, hint, format }: Props = $props();

  const shown = $derived(format ? format(value) : value.toFixed(step >= 1 ? 0 : 2));
  const fill = $derived(((value - min) / (max - min)) * 100);
</script>

<label class="slider" title={hint ?? label}>
  <span class="slider__head">
    <span class="slider__label">{label}</span>
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
    font-size: 0.72rem;
    letter-spacing: 0.04em;
    color: var(--ink-dim);
  }

  .slider__value {
    font-family: var(--mono);
    font-size: 0.7rem;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }

  input[type='range'] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 3px;
    border-radius: 3px;
    background: linear-gradient(
      to right,
      var(--accent) 0%,
      var(--accent) var(--fill),
      rgba(255, 255, 255, 0.13) var(--fill),
      rgba(255, 255, 255, 0.13) 100%
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
    background: var(--panel-solid);
    border: 2px solid var(--accent);
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.55);
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
    background: var(--panel-solid);
    border: 2px solid var(--accent);
  }
</style>
