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

  /* A drop of colour, nothing round it; the chosen one is a little larger, with a single ring of light. */
  .dot {
    position: relative;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 50% 46% 54% 48% / 48% 54% 46% 50%;
    border: none;
    background: var(--c);
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(28, 20, 10, 0.18);
    transition:
      transform 0.25s cubic-bezier(0.25, 0.8, 0.3, 1.4),
      box-shadow 0.2s;
  }

  .dot:nth-child(even) {
    border-radius: 46% 54% 49% 51% / 55% 46% 54% 45%;
  }

  .dot:hover {
    transform: scale(1.1);
  }

  .dot.on {
    transform: scale(1.18);
    box-shadow: 0 0 0 2.5px rgba(255, 252, 246, 0.9), 0 2px 6px rgba(28, 20, 10, 0.2);
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
