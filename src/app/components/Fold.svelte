<script lang="ts">
  /**
   * The exact controls, folded away under the graphical ones. Closed by
   * default: most changes are made with the pictures, and the numbers are for
   * the occasional precise one.
   */
  import type { Snippet } from 'svelte';
  import { slide } from 'svelte/transition';

  interface Props {
    label?: string;
    children: Snippet;
  }

  let { label = 'Fine-tune', children }: Props = $props();
  let open = $state(false);
</script>

<div class="fold">
  <button class="head" class:open onclick={() => (open = !open)} aria-expanded={open}>
    <span class="chev">›</span>
    {label}
  </button>
  {#if open}
    <div class="body" transition:slide={{ duration: 180 }}>
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .fold {
    margin-top: 0.4rem;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
    padding-top: 0.5rem;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    width: 100%;
    padding: 0.2rem 0;
    background: none;
    border: none;
    font-size: 0.66rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-faint);
    cursor: pointer;
  }

  .head:hover {
    color: var(--ink-dim);
  }

  .chev {
    display: inline-block;
    font-size: 0.95rem;
    line-height: 1;
    transition: transform 0.18s;
  }

  .head.open .chev {
    transform: rotate(90deg);
  }

  .body {
    padding-top: 0.6rem;
  }
</style>
