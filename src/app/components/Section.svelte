<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    open?: boolean;
    children: Snippet;
  }

  let { title, open = false, children }: Props = $props();
</script>

<details {open}>
  <summary>
    <span>{title}</span>
    <svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>
  </summary>
  <div class="body">
    {@render children()}
  </div>
</details>

<style>
  details {
    border-top: 1px solid var(--hairline);
  }

  summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.72rem 0;
    cursor: pointer;
    list-style: none;
    font-size: 0.7rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink);
    user-select: none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  summary:hover {
    color: var(--accent);
  }

  summary svg {
    width: 10px;
    height: 6px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform 0.18s ease;
    opacity: 0.6;
  }

  details[open] summary svg {
    transform: rotate(180deg);
  }

  .body {
    padding-bottom: 0.85rem;
  }
</style>
