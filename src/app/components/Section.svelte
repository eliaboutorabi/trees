<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { IconSvgElement } from '@hugeicons/svelte';
  import Icon from './Icon.svelte';
  import { ArrowDown01Icon } from '@hugeicons/core-free-icons';

  interface Props {
    title: string;
    icon?: IconSvgElement;
    open?: boolean;
    children: Snippet;
  }

  let { title, icon, open = false, children }: Props = $props();
</script>

<details {open}>
  <summary>
    <span class="title">
      {#if icon}<Icon {icon} size={15} strokeWidth={1.8} />{/if}
      {title}
    </span>
    <span class="chevron"><Icon icon={ArrowDown01Icon} size={14} strokeWidth={2} /></span>
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

  .title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .chevron {
    display: flex;
    opacity: 0.55;
    transition: transform 0.18s ease;
  }

  details[open] .chevron {
    transform: rotate(180deg);
  }

  .body {
    padding-bottom: 0.85rem;
  }
</style>
