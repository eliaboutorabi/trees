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
    {#if p.k === 'wash' || p.k === 'both'}
      <path d={p.d} transform={p.t} class="wash" style={washStyle(p)} />
    {/if}
    {#if p.k === 'ink' || p.k === 'both'}
      <path d={p.d} transform={p.t} stroke-width={p.w ? weight * p.w : undefined} stroke-opacity={p.o} />
    {/if}
    {#if p.k === 'dot'}
      <path d={p.d} transform={p.t} class="dot" />
    {/if}
  {/each}
</svg>

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
</style>
