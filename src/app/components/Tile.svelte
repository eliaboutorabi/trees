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
   * A pane of frost with a picture in it. Each tile is cut a little
   * differently, so a row of them reads as pieces laid down by hand rather
   * than stamped from one mould.
   */
  .tile {
    --cut: 18px 22px 17px 21px / 21px 17px 22px 18px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    padding: 0.32rem 0.32rem 0.42rem;
    border-radius: var(--cut);
    border: 1px solid rgba(255, 255, 255, 0.34);
    background: rgba(255, 255, 255, 0.16);
    color: var(--ink-dim);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4), 0 3px 9px rgba(28, 20, 10, 0.08);
    cursor: pointer;
    transition:
      transform 0.32s cubic-bezier(0.25, 0.8, 0.3, 1.3),
      background 0.25s,
      box-shadow 0.25s,
      color 0.2s;
  }

  .tile:nth-child(3n + 2) {
    --cut: 21px 17px 22px 18px / 18px 22px 17px 21px;
  }

  .tile:nth-child(3n) {
    --cut: 17px 21px 19px 23px / 22px 19px 21px 17px;
  }

  .tile:hover {
    transform: translateY(-2px) rotate(-1.2deg);
    background: rgba(255, 255, 255, 0.26);
    color: var(--ink);
  }

  .tile:nth-child(even):hover {
    transform: translateY(-2px) rotate(1deg);
  }

  .tile.active {
    background: color-mix(in srgb, var(--tone) 58%, rgba(255, 255, 255, 0.12));
    color: var(--tone-ink);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.5),
      inset 0 0 0 1.5px color-mix(in srgb, var(--tone-ink) 55%, transparent),
      0 5px 14px rgba(28, 20, 10, 0.14);
  }

  .art {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 14px 17px 13px 16px / 16px 13px 17px 14px;
    overflow: hidden;
    display: grid;
    place-items: center;
    background: var(--backdrop, rgba(255, 255, 255, 0.14));
    box-shadow: inset 0 1px 3px rgba(28, 20, 10, 0.1);
  }

  .name {
    font-family: var(--serif);
    font-size: 0.8rem;
    font-weight: 500;
    font-variation-settings: 'SOFT' 100;
    white-space: nowrap;
  }

  .tile.active .name {
    font-weight: 620;
  }
</style>
