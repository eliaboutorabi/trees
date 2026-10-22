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
  /* Set off by a hand-drawn rule rather than a box: it is part of the card. */
  .fold {
    position: relative;
    margin-top: 0.5rem;
    padding-top: 0.55rem;
  }

  .fold::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0.2rem;
    right: 0.2rem;
    height: 6px;
    background: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 6' preserveAspectRatio='none'><path d='M1 3.4 C 30 1.8, 55 4.4, 92 3 S 160 2, 199 3.6' fill='none' stroke='rgb(60,44,28)' stroke-opacity='0.22' stroke-width='1.2' stroke-linecap='round'/></svg>") center / 100% 100% no-repeat;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    width: 100%;
    padding: 0.2rem 0;
    background: none;
    border: none;
    font-family: var(--serif);
    font-size: 0.86rem;
    font-style: italic;
    font-weight: 450;
    font-variation-settings: 'SOFT' 100;
    color: var(--ink-faint);
    cursor: pointer;
  }

  .head:hover {
    color: var(--ink-dim);
  }

  .chev {
    display: inline-block;
    font-style: normal;
    font-size: 1rem;
    line-height: 1;
    transition: transform 0.25s cubic-bezier(0.25, 0.8, 0.3, 1.3);
  }

  .head.open .chev {
    transform: rotate(90deg);
  }

  .body {
    padding-top: 0.6rem;
  }
</style>
