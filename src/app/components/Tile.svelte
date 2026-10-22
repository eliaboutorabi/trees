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
    border-radius: 18px;
    border: 3px solid #fffdf8;
    background: var(--paper-2);
    color: var(--ink-dim);
    box-shadow: 0 3px 8px rgba(70, 45, 25, 0.12);
    cursor: pointer;
    transition:
      transform 0.18s cubic-bezier(0.3, 0.7, 0.4, 1.4),
      border-color 0.18s,
      background 0.18s;
  }

  .tile:hover {
    transform: translateY(-3px) rotate(-1.5deg);
    color: var(--ink);
  }

  .tile.active {
    border-color: var(--tone-ink);
    background: var(--tone);
    color: var(--tone-ink);
  }

  .art {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 13px;
    overflow: hidden;
    display: grid;
    place-items: center;
    background: var(--backdrop, #fffaf2);
  }

  .name {
    font-size: 0.72rem;
    font-weight: 800;
    white-space: nowrap;
  }
</style>
