<script lang="ts">
  interface Props {
    label: string;
    value: string;
    hint?: string;
  }

  let { label, value = $bindable(), hint }: Props = $props();
</script>

<label class="swatch" title={hint ?? label}>
  <span class="swatch__label">{label}</span>
  <span class="swatch__well" style="--swatch: {value}">
    <input type="color" bind:value aria-label={label} />
  </span>
  <span class="swatch__code">{value.toUpperCase()}</span>
</label>

<style>
  .swatch {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    margin-bottom: 0.7rem;
    cursor: pointer;
  }

  .swatch__label {
    flex: 1;
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--ink-dim);
  }

  .swatch__code {
    font-family: var(--mono);
    font-size: 0.66rem;
    color: var(--ink-dim);
    font-variant-numeric: tabular-nums;
    opacity: 0.7;
  }

  /* The native colour input is unstyleable across browsers, so it sits
     transparent on top of a well we draw ourselves. */
  .swatch__well {
    position: relative;
    width: 1.6rem;
    height: 1.5rem;
    border-radius: 50% 46% 54% 48% / 48% 54% 46% 50%;
    background: var(--swatch);
    box-shadow: 0 1px 3px rgba(28, 20, 10, 0.18);
    transition: transform 0.12s ease;
  }

  .swatch:hover .swatch__well {
    transform: scale(1.08);
  }

  .swatch__well input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    border: none;
    padding: 0;
    cursor: pointer;
  }
</style>
