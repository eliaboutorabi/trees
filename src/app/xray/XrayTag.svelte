<script lang="ts">
  /**
   * A small tag at the pointer, over the segment it is on: how deep in
   * brackets it was drawn, when its wood first appeared, and which
   * production drew it. Only while pointing; the panel has the rest.
   */
  import type { SkeletonData } from '../../engine';

  interface Props {
    skeleton: SkeletonData | null;
    node: number;
    x: number;
    y: number;
    night: boolean;
    /** A production's colour by its index (-1 the axiom), when colour names productions; else null. */
    colourOf: ((rule: number) => string) | null;
  }

  let { skeleton, node, x, y, night, colourOf }: Props = $props();

  const info = $derived.by(() => {
    const sk = skeleton;
    if (!sk || node < 1 || node >= sk.count) return null;
    return { depth: sk.order[node], age: sk.age[node], rule: sk.rule[node] };
  });

  // Beside the pointer, below and to the right, unless that would run off the screen.
  const flip = $derived(x > window.innerWidth - 260);
</script>

{#if info}
  <div class="tag xray-theme" class:night class:flip style="left: {x}px; top: {y}px" aria-hidden="true">
    <i class="sym">F</i>
    <span class="what">
      depth {info.depth}
      <span class="dot">·</span>
      {info.age === 0 ? 'in the axiom' : `since n = ${info.age}`}
      {#if info.rule >= 0}
        <span class="dot">·</span>
        rule
        <span class="mark" class:coloured={!!colourOf} style="--c: {colourOf?.(info.rule) ?? 'transparent'}">{info.rule + 1}</span>
      {/if}
    </span>
  </div>
{/if}

<style>
  .tag {
    position: fixed;
    z-index: 30;
    pointer-events: none;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.22rem 0.65rem 0.24rem 0.55rem;
    border-radius: 999px;
    transform: translate(16px, 14px);
    background: var(--x-glass);
    box-shadow:
      var(--x-rim),
      0 6px 16px rgba(10, 8, 6, 0.14);
    color: var(--x-ink);
    white-space: nowrap;
    animation: in 0.16s ease-out both;
  }
  .tag.flip {
    transform: translate(calc(-100% - 12px), 14px);
  }
  @keyframes in {
    from {
      opacity: 0;
    }
  }
  .sym {
    font-family: var(--serif);
    font-size: 1rem;
    font-weight: 600;
    color: var(--x-draw);
  }
  .what {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-family: var(--serif);
    font-size: 0.78rem;
    color: var(--x-dim);
    font-variant-numeric: tabular-nums;
  }
  .dot {
    color: var(--x-faint);
  }
  .mark {
    display: inline-grid;
    place-items: center;
    min-width: 1.05rem;
    height: 1.05rem;
    border-radius: 50%;
    font-size: 0.66rem;
    font-weight: 600;
    color: var(--x-ink);
    box-shadow: inset 0 0 0 1.2px var(--x-line);
  }
  .mark.coloured {
    background: var(--c);
    color: var(--x-on-colour, #fff);
    box-shadow: none;
  }
</style>
