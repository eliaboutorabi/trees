<script lang="ts">
  /**
   * A colour picked by tapping a dot: a handful of colours that suit the job,
   * and one more dot for anything else, which opens the system picker.
   */
  interface Props {
    label: string;
    value: string;
    choices: string[];
  }

  let { label, value = $bindable(), choices }: Props = $props();
  const custom = $derived(!choices.some((c) => c.toLowerCase() === value.toLowerCase()));
</script>

<div class="dots" role="radiogroup" aria-label={label}>
  <span class="caption">{label}</span>
  <div class="row">
    {#each choices as c (c)}
      <button
        class="dot"
        class:on={c.toLowerCase() === value.toLowerCase()}
        style:--c={c}
        role="radio"
        aria-checked={c.toLowerCase() === value.toLowerCase()}
        aria-label={c}
        onclick={() => (value = c)}
      ></button>
    {/each}
    <label class="dot any" class:on={custom} style:--c={custom ? value : 'transparent'} title="Any colour">
      <input type="color" bind:value aria-label="{label}: any colour" />
    </label>
  </div>
</div>

<style>
  .dots {
    margin-bottom: 0.85rem;
  }

  .caption {
    display: block;
    margin-bottom: 0.4rem;
    font-family: var(--serif);
    font-size: 0.9rem;
    font-weight: 500;
    font-variation-settings: 'SOFT' 100;
    color: var(--ink-dim);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .dot {
    position: relative;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 50% 46% 54% 48% / 48% 54% 46% 50%;
    border: 1.5px solid rgba(255, 255, 255, 0.55);
    background: var(--c);
    cursor: pointer;
    box-shadow: 0 2px 5px rgba(28, 20, 10, 0.18), inset 0 -3px 4px rgba(0, 0, 0, 0.12), inset 0 2px 3px rgba(255, 255, 255, 0.3);
    transition:
      transform 0.15s cubic-bezier(0.3, 0.7, 0.4, 1.5),
      border-color 0.15s;
  }

  .dot:hover {
    transform: scale(1.12);
  }

  .dot:nth-child(even) {
    border-radius: 46% 54% 49% 51% / 55% 46% 54% 45%;
  }

  .dot.on {
    transform: scale(1.12);
    box-shadow:
      0 0 0 2px rgba(255, 255, 255, 0.5),
      0 0 0 3.5px var(--tone-ink),
      inset 0 -3px 4px rgba(0, 0, 0, 0.12);
  }

  /* The "anything else" dot: a rainbow until a custom colour is chosen. */
  .any {
    background:
      linear-gradient(var(--c), var(--c)),
      conic-gradient(#ff5f5f, #ffd25f, #8bff5f, #5fe0ff, #6b5fff, #ff5fd7, #ff5f5f);
    overflow: hidden;
  }

  .any input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
</style>
