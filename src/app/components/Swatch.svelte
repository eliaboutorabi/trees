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
    font-size: 0.72rem;
    letter-spacing: 0.04em;
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
    width: 30px;
    height: 18px;
    border-radius: 5px;
    background: var(--swatch);
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.22),
      0 1px 5px rgba(0, 0, 0, 0.45);
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
