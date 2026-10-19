<script lang="ts">
  /**
   * A picker tile: a picture over a name. Used where the choice is easier to
   * recognise than to read — a species, a season, the weather.
   */
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    active?: boolean;
    title?: string;
    /** Behind the picture — a sky for weather, a season's colour. */
    backdrop?: string;
    onclick: () => void;
    children: Snippet;
  }

  let { label, active = false, title, backdrop, onclick, children }: Props = $props();
</script>

<button class="tile" class:active {title} {onclick} style:--backdrop={backdrop}>
  <span class="art">{@render children()}</span>
  <span class="name">{label}</span>
</button>

<style>
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.4rem 0.3rem 0.45rem;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.035);
    color: var(--ink-dim);
    cursor: pointer;
    transition:
      transform 0.18s cubic-bezier(0.3, 0.7, 0.4, 1.4),
      border-color 0.18s,
      background 0.18s;
  }

  .tile:hover {
    transform: translateY(-2px);
    background: rgba(255, 255, 255, 0.07);
    color: var(--ink);
  }

  .tile.active {
    border-color: var(--accent);
    background: rgba(240, 176, 100, 0.12);
    color: var(--ink);
  }

  .art {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 10px;
    overflow: hidden;
    display: grid;
    place-items: center;
    background: var(--backdrop, linear-gradient(to bottom, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.01)));
  }

  .name {
    font-size: 0.66rem;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
</style>
