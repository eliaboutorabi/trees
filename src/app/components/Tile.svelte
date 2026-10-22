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
  /*
   * A picture over a name, on the glass, with one edge and no more: the tile
   * is a soft patch of light, its picture sits straight on it (a season's or
   * the weather's colour, where it has one, washes the whole tile rather than
   * boxing the picture), and the chosen one is told apart by colour alone.
   * Every ring and inset that used to mark these added an outline inside an
   * outline inside the card's own.
   */
  .tile {
    --cut: 18px 22px 17px 21px / 21px 17px 22px 18px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.35rem 0.3rem 0.45rem;
    border: none;
    border-radius: var(--cut);
    background: var(--backdrop, rgba(255, 255, 255, 0.16));
    color: var(--ink-dim);
    cursor: pointer;
    transition:
      transform 0.32s cubic-bezier(0.25, 0.8, 0.3, 1.3),
      background-color 0.25s,
      color 0.2s,
      filter 0.25s;
  }

  .tile:nth-child(3n + 2) {
    --cut: 21px 17px 22px 18px / 18px 22px 17px 21px;
  }

  .tile:nth-child(3n) {
    --cut: 17px 21px 19px 23px / 22px 19px 21px 17px;
  }

  .tile:hover {
    transform: translateY(-2px) rotate(-1deg);
    color: var(--ink);
    filter: brightness(1.06);
  }

  .tile:nth-child(even):hover {
    transform: translateY(-2px) rotate(0.8deg);
  }

  /*
   * Chosen: filled with the card's colour, over its own backdrop if it has
   * one. The fill is a layer of its own that fades in and out, because a
   * background made of gradients switches rather than transitions.
   */
  .tile {
    position: relative;
    isolation: isolate;
  }

  .tile::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    background: color-mix(in srgb, var(--tone) 62%, transparent);
    opacity: 0;
    transition: opacity 0.3s;
  }

  .tile.active::before {
    opacity: 1;
  }

  .tile.active {
    color: color-mix(in srgb, var(--tone-ink) 88%, #000 12%);
  }

  .art {
    width: 100%;
    aspect-ratio: 1;
    display: grid;
    place-items: center;
  }

  .name {
    font-family: var(--serif);
    font-size: 0.8rem;
    font-weight: 500;
    font-variation-settings: 'SOFT' 100;
    white-space: nowrap;
  }

  .tile.active .name {
    font-weight: 640;
  }
</style>
