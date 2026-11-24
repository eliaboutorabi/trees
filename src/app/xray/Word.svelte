<script lang="ts">
  /**
   * A word of the L-system, typeset: symbols in a mathematical serif, the
   * letters italic, each family in its colour, and one module (or a run of
   * them) lit. Parameters, when shown, hang as a small subscript, the way
   * they are written on paper.
   */
  import { glyphOf, kindOf, prettyArgs } from './symbols';

  interface Item {
    s: string;
    /** Numeric parameters (a derived word) … */
    p?: number[];
    /** … or the arguments as written (a production). */
    args?: string;
  }

  interface Props {
    items: Item[];
    /** The lit module, if any. */
    at?: number;
    /** Parameters: never, only on the lit module, or on every module. */
    params?: 'none' | 'at' | 'all';
    /** Keep to one line, rather than wrap (cut it to fit first: see the panel's `excerpt`). */
    line?: boolean;
    size?: 'small' | 'normal' | 'large';
  }

  let { items, at = -1, params = 'none', line = false, size = 'normal' }: Props = $props();

  const argsOf = (it: Item) => (it.args !== undefined ? prettyArgs(it.args) : (it.p ?? []).map((v) => String(v).replace('-', '−')).join(', '));
</script>

<span class="word {size}" class:line>
  {#each items as it, i (i)}
    {@const k = kindOf(it.s)}
    {@const shown = (params === 'all' || (params === 'at' && i === at)) && argsOf(it)}
    <span class="sym k-{k}" class:lit={i === at} class:letter={/[A-Za-z]/.test(it.s)}>{glyphOf(it.s)}{#if shown}<sub>{argsOf(it)}</sub>{/if}</span>
  {/each}
</span>

<style>
  .word {
    font-family: var(--serif);
    font-variation-settings: 'SOFT' 50, 'opsz' 24;
    letter-spacing: 0.01em;
    line-height: 1.55;
    color: var(--x-ink);
    overflow-wrap: anywhere;
  }
  .word.small {
    font-size: 0.86rem;
  }
  .word.normal {
    font-size: 1.04rem;
  }
  .word.large {
    font-size: 1.5rem;
    line-height: 1.35;
  }
  .word.line {
    display: block;
    white-space: nowrap;
    overflow: hidden;
  }

  .sym {
    display: inline-block;
    padding: 0 0.035em;
    border-radius: 0.3em;
  }
  .letter {
    font-style: italic;
  }
  sub {
    font-size: 0.58em;
    font-style: normal;
    margin-left: 0.06em;
    opacity: 0.85;
    font-variant-numeric: tabular-nums;
  }

  .k-draw {
    color: var(--x-draw);
  }
  .k-move {
    color: var(--x-move);
  }
  /* Operators in the plain face: the serif's ampersand is a flourish, and a bracket wants to be upright and quiet. */
  .k-turn,
  .k-branch,
  .k-width {
    font-family: var(--sans);
    font-size: 0.92em;
    font-weight: 500;
  }
  .k-turn {
    color: var(--x-turn);
  }
  .k-branch {
    color: var(--x-branch);
    font-weight: 400;
  }
  .k-leaf {
    color: var(--x-leaf);
  }
  .k-width {
    color: var(--x-width);
  }
  .k-grows {
    color: var(--x-grows);
    font-weight: 560;
  }
  .k-gap {
    color: var(--x-faint);
    padding: 0 0.15em;
  }

  /* The lit module: a warm box round it, the way the selection is lit on the tree. */
  .lit {
    color: var(--x-lit-ink);
    background: var(--x-lit-wash);
    box-shadow: 0 0 0 1px var(--x-lit-line);
    padding: 0 0.16em;
    margin: 0 0.04em;
  }
</style>
