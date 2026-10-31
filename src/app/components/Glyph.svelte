<script lang="ts">
  /** One of the hand-drawn icons in `glyphs.ts`, in the current colour. */
  import { GLYPHS, type GlyphName, type Part } from './glyphs';

  interface Props {
    name: GlyphName;
    size?: number;
    /** Line weight, in grid units. */
    weight?: number;
  }

  let { name, size = 22, weight = 1.6 }: Props = $props();
  const parts = $derived(GLYPHS[name] as readonly Part[]);

  function washStyle(p: Part) {
    let css = p.c ? `fill: var(--glyph-${p.c}, var(--glyph-wash, currentColor));` : '';
    if (p.o !== undefined) css += `fill-opacity: calc(var(--glyph-wash-opacity, 0.22) * ${p.o});`;
    return css || undefined;
  }
</script>

<svg
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width={weight}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#each parts as p, i (i)}
    {#if p.m}
      <g class="move {p.m}" style="--at: {p.md ?? 0}">{@render part(p)}</g>
    {:else}
      {@render part(p)}
    {/if}
  {/each}
</svg>

{#snippet part(p: Part)}
  {#if p.k === 'wash' || p.k === 'both'}
    <path d={p.d} transform={p.t} class="wash" style={washStyle(p)} />
  {/if}
  {#if p.k === 'ink' || p.k === 'both'}
    <path d={p.d} transform={p.t} stroke-width={p.w ? weight * p.w : undefined} stroke-opacity={p.o} />
  {/if}
  {#if p.k === 'dot'}
    <path d={p.d} transform={p.t} class="dot" />
  {/if}
{/snippet}

<style>
  svg {
    display: block;
    flex: none;
    overflow: visible;
  }

  /* The fill inside a line: by default a tint of the line, but a button can
     set it to something lighter so the icon reads as drawn and coloured in. */
  .wash {
    fill: var(--glyph-wash, currentColor);
    fill-opacity: var(--glyph-wash-opacity, 0.22);
    stroke: none;
  }

  .dot {
    fill: currentColor;
    stroke: none;
  }

  /*
   * Weather that moves. Each part runs its own loop, started `--at` of the way
   * through so a cloud's drops never fall in step, fading in as it leaves the
   * cloud and out before it reaches the ground. At the middle of its fall a
   * part is where it is drawn, so a still icon and a moving one agree.
   * (Lengths are in the icon's 24-unit grid.) The keyframes are global: their
   * names travel through `--motion`, where Svelte's scoping cannot follow.
   */
  .move {
    --cycle: 1s;
    animation: var(--motion) var(--cycle) linear infinite;
    animation-delay: calc(var(--at) * var(--cycle) * -1);
  }

  /* Rain streaks, slanting the way they are drawn. */
  .streak {
    --motion: glyph-streak;
    --cycle: 0.95s;
  }

  /* Rounder drops fall straight, a little slower. */
  .drop {
    --motion: glyph-drop;
    --cycle: 1.25s;
    animation-timing-function: cubic-bezier(0.45, 0, 0.8, 0.6);
  }

  /* Snow drifts, swaying as it goes. */
  .snow {
    --motion: glyph-snow;
    --cycle: 3.2s;
  }

  /* And a flake turns slowly about its own middle while it drifts. */
  .flake {
    --motion: glyph-flake;
    --cycle: 3.8s;
    transform-box: fill-box;
    transform-origin: center;
  }

  @keyframes -global-glyph-streak {
    0% {
      transform: translate(1px, -2.9px);
      opacity: 0;
    }
    22%,
    72% {
      opacity: 1;
    }
    100% {
      transform: translate(-0.85px, 2.4px);
      opacity: 0;
    }
  }

  @keyframes -global-glyph-drop {
    0% {
      transform: translateY(-3px);
      opacity: 0;
    }
    25%,
    70% {
      opacity: 1;
    }
    100% {
      transform: translateY(2.6px);
      opacity: 0;
    }
  }

  @keyframes -global-glyph-snow {
    0% {
      transform: translate(0, -2.6px);
      opacity: 0;
    }
    18% {
      opacity: 1;
    }
    35% {
      transform: translate(0.75px, -0.7px);
    }
    65% {
      transform: translate(-0.65px, 1px);
    }
    82% {
      opacity: 1;
    }
    100% {
      transform: translate(0.15px, 2.7px);
      opacity: 0;
    }
  }

  @keyframes -global-glyph-flake {
    0% {
      transform: translate(0, -2.6px) rotate(-40deg);
      opacity: 0;
    }
    18% {
      opacity: 1;
    }
    35% {
      transform: translate(0.8px, -0.8px) rotate(-12deg);
    }
    65% {
      transform: translate(-0.7px, 1px) rotate(18deg);
    }
    82% {
      opacity: 1;
    }
    100% {
      transform: translate(0.15px, 2.7px) rotate(45deg);
      opacity: 0;
    }
  }

  /*
   * Wings. A dove's beats down from where it is drawn, raised, and back —
   * hinged at the shoulder, the bottom of the wing; a butterfly's pair close
   * toward the body and open again. Both start from the drawn pose.
   */
  .beat {
    --motion: glyph-beat;
    --cycle: 0.62s;
    animation-timing-function: ease-in-out;
    transform-box: fill-box;
    transform-origin: 45% 100%;
  }

  .flutter {
    --motion: glyph-flutter;
    --cycle: 0.48s;
    animation-timing-function: ease-in-out;
    transform-box: fill-box;
    transform-origin: 50% 50%;
  }

  @keyframes -global-glyph-beat {
    0%,
    100% {
      transform: scaleY(1);
    }
    50% {
      transform: scaleY(-0.45);
    }
  }

  @keyframes -global-glyph-flutter {
    0%,
    100% {
      transform: scaleX(1);
    }
    50% {
      transform: scaleX(0.2);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .move {
      animation: none;
    }
  }
</style>
