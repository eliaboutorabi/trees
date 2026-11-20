<script lang="ts">
  /**
   * A glassy label that pops out beside a button while the pointer is on it,
   * in place of the browser's own tooltip: a small frosted pill in the serif
   * the rest of the interface speaks in, tilted a touch like everything else.
   *
   * It can carry a little "?" that opens the tour at just this part. The label
   * is a sibling of the button inside one wrapper, and a strip of invisible
   * bridge spans the gap between them, so the pointer can travel from the
   * button onto the "?" without the label vanishing on the way.
   */
  import type { Snippet } from 'svelte';
  import Ask from './Ask.svelte';

  interface Props {
    label: string;
    /** Which side of the button the label comes out on. */
    side?: 'below' | 'right' | 'above' | 'left';
    /** Below or above: centred on the button, or lined up with its far edge (for a row at the edge of the screen). */
    align?: 'center' | 'end';
    /** Open the tour at this part; no "?" without it. */
    onhelp?: () => void;
    children: Snippet;
  }

  let { label, side = 'below', align = 'center', onhelp, children }: Props = $props();
</script>

<span class="hinted {side}" class:end={align === 'end'}>
  {@render children()}
  <span class="tip" role="tooltip">
    <span class="text">{label}</span>
    {#if onhelp}
      <Ask about={label} onclick={onhelp} size="small" />
    {/if}
  </span>
</span>

<style>
  .hinted {
    position: relative;
    display: inline-flex;
  }

  .tip {
    position: absolute;
    z-index: 30;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.24rem 0.34rem 0.28rem 0.66rem;
    border-radius: 12px 10px 13px 9px;
    font-family: var(--serif);
    font-size: 0.82rem;
    font-weight: 500;
    font-variation-settings: 'SOFT' 100, 'opsz' 14;
    white-space: nowrap;
    color: var(--ink);
    background: var(--sheen), var(--glass);
    box-shadow: var(--rim), 0 6px 14px rgba(28, 20, 10, 0.18);
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition:
      opacity 0.18s,
      transform 0.22s cubic-bezier(0.3, 1.4, 0.5, 1),
      visibility 0s linear 0.22s;
  }

  .tip:not(:has(button)) {
    padding-right: 0.66rem;
  }

  /* An invisible bridge across the gap, so the pointer can reach the "?". */
  .tip::before {
    content: '';
    position: absolute;
  }

  .below .tip {
    top: calc(100% + 0.55rem);
    right: 50%;
    transform: translate(50%, -5px) rotate(-1.5deg) scale(0.94);
    transform-origin: 50% 0;
  }
  .below .tip::before {
    inset: -0.7rem 0 100% 0;
  }

  .below.end .tip {
    right: -0.2rem;
    transform: translate(0, -5px) rotate(-1.5deg) scale(0.94);
    transform-origin: 100% 0;
  }

  .above .tip {
    bottom: calc(100% + 0.55rem);
    left: 50%;
    transform: translate(-50%, 5px) rotate(1.5deg) scale(0.94);
    transform-origin: 50% 100%;
  }
  .above .tip::before {
    inset: 100% 0 -0.7rem 0;
  }

  .right .tip {
    left: calc(100% + 0.6rem);
    top: 50%;
    transform: translate(-5px, -50%) rotate(1deg) scale(0.94);
    transform-origin: 0 50%;
  }
  .right .tip::before {
    inset: 0 100% 0 -0.75rem;
  }

  .left .tip {
    right: calc(100% + 0.6rem);
    top: 50%;
    transform: translate(5px, -50%) rotate(-1deg) scale(0.94);
    transform-origin: 100% 50%;
  }
  .left .tip::before {
    inset: 0 -0.75rem 0 100%;
  }

  @media (hover: hover) {
    /* Frosted only while it shows: an invisible frost still costs a blur a frame. */
    .hinted:hover .tip,
    .hinted:focus-within .tip {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      backdrop-filter: var(--frost);
      -webkit-backdrop-filter: var(--frost);
      transition:
        opacity 0.18s,
        transform 0.22s cubic-bezier(0.3, 1.4, 0.5, 1),
        visibility 0s;
    }
    .below:hover .tip,
    .below:focus-within .tip {
      transform: translate(50%, 0) rotate(-1.5deg);
    }
    .below.end:hover .tip,
    .below.end:focus-within .tip {
      transform: translate(0, 0) rotate(-1.5deg);
    }
    .above:hover .tip,
    .above:focus-within .tip {
      transform: translate(-50%, 0) rotate(1.5deg);
    }
    .right:hover .tip,
    .right:focus-within .tip {
      transform: translate(0, -50%) rotate(1deg);
    }
    .left:hover .tip,
    .left:focus-within .tip {
      transform: translate(0, -50%) rotate(-1deg);
    }
  }

</style>
