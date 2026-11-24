<script lang="ts">
  /**
   * The L-system view's stem, where the growth stem stands in the garden: a
   * ladder of the rewrites, the axiom at its foot and the finished tree at
   * its top, headed by the step on show. Pick a rung, or run a finger up and
   * down it, and the tree turns into itself as it stood after that many
   * rewrites; play, and it grows through them all, one into the next.
   */
  import Glyph from '../components/Glyph.svelte';

  interface Props {
    step: number;
    steps: number;
    playing: boolean;
    night: boolean;
    onstep: (n: number) => void;
    onplay: () => void;
    onstop: () => void;
  }

  let { step, steps, playing, night, onstep, onplay, onstop }: Props = $props();

  let ladder = $state<HTMLElement>();
  let tall = $state(240);

  // A number on every rung there is room for one on (about sixteen pixels
  // apart); a long derivation (the willow's twenty-eight), or a short ladder,
  // gets one every few.
  const every = $derived.by(() => {
    const gap = tall / Math.max(1, steps);
    return gap >= 16 ? 1 : gap >= 8 ? 2 : gap >= 4 ? 4 : 8;
  });
  const rungs = $derived(Array.from({ length: steps + 1 }, (_, i) => steps - i));
  let dragging = false;

  function at(e: PointerEvent): number {
    const box = ladder!.getBoundingClientRect();
    const f = 1 - (e.clientY - box.top) / box.height;
    return Math.round(Math.max(0, Math.min(1, f)) * steps);
  }
  function down(e: PointerEvent) {
    dragging = true;
    ladder!.setPointerCapture(e.pointerId);
    const n = at(e);
    if (n !== step) onstep(n);
  }
  function move(e: PointerEvent) {
    if (!dragging) return;
    const n = at(e);
    if (n !== step) onstep(n);
  }
  function up(e: PointerEvent) {
    dragging = false;
    ladder!.releasePointerCapture(e.pointerId);
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onstep(Math.min(steps, step + 1));
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onstep(Math.max(0, step - 1));
    else if (e.key === 'Home') onstep(0);
    else if (e.key === 'End') onstep(steps);
    else return;
    e.preventDefault();
  }
</script>

<div class="stem xray-theme" class:night data-keep-clear data-tour="xray-steps">
  <span class="n"><i>n</i> = {step}</span>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="ladder"
    bind:this={ladder}
    bind:clientHeight={tall}
    role="slider"
    tabindex="0"
    aria-label="Rewrites"
    aria-valuemin={0}
    aria-valuemax={steps}
    aria-valuenow={step}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onkeydown={key}
  >
    <span class="rail"></span>
    <span class="done" style="height: {steps ? (step / steps) * 100 : 0}%"></span>
    {#each rungs as r (r)}
      <span class="rung" class:on={r === step} class:past={r < step} style="bottom: {steps ? (r / steps) * 100 : 0}%">
        <span class="dot"></span>
        {#if r % every === 0 || r === steps}<span class="num">{r}</span>{/if}
      </span>
    {/each}
  </div>
  <div class="buttons">
    {#if playing}
      <button class="round" onclick={onstop} aria-label="Stop" title="Stop"><Glyph name="close" size={15} weight={1.9} /></button>
    {:else}
      <button class="round go" onclick={onplay} aria-label="Grow through every rewrite" title="Grow through every rewrite"><Glyph name="play" size={18} weight={1.7} /></button>
    {/if}
    <button class="round" onclick={() => onstep(steps)} disabled={step === steps} aria-label="The finished tree" title="The finished tree"><Glyph name="done" size={17} weight={1.8} /></button>
  </div>
</div>

<style>
  .stem {
    position: absolute;
    right: 1.1rem;
    top: 50%;
    transform: translateY(-50%);
    z-index: 5;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 3.9rem;
    padding: 0.65rem 0 0.55rem;
    border-radius: 30px 26px 32px 24px / 24px 32px 26px 30px;
    color: var(--x-ink);
    background: var(--x-glass);
    backdrop-filter: var(--frost);
    -webkit-backdrop-filter: var(--frost);
    box-shadow: var(--x-rim), 0 10px 26px rgba(10, 8, 6, 0.22);
    animation: arrive 0.45s cubic-bezier(0.25, 0.9, 0.3, 1.1) both;
  }
  @keyframes arrive {
    from {
      opacity: 0;
      transform: translate(14px, -50%);
    }
  }

  .n {
    margin: 0.1rem 0 0.35rem;
    font-family: var(--serif);
    font-size: 1.02rem;
    font-weight: 560;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .ladder {
    position: relative;
    width: 100%;
    height: clamp(9rem, 34vh, 17rem);
    margin: 0.4rem 0 0.6rem;
    cursor: ns-resize;
    touch-action: none;
    outline: none;
  }
  .ladder:focus-visible {
    box-shadow: inset 0 0 0 2px var(--x-accent);
    border-radius: 12px;
  }
  .rail,
  .done {
    position: absolute;
    left: 1.25rem;
    bottom: 0;
    width: 2px;
    border-radius: 2px;
  }
  .rail {
    top: 0;
    background: var(--x-line);
  }
  .done {
    background: var(--x-accent);
    transition: height 0.35s cubic-bezier(0.3, 0.9, 0.3, 1);
  }
  .rung {
    position: absolute;
    left: 0;
    right: 0;
    height: 0;
    display: flex;
    align-items: center;
  }
  .dot {
    position: absolute;
    left: calc(1.25rem + 1px);
    width: 7px;
    height: 7px;
    margin-left: -3.5px;
    border-radius: 50%;
    background: var(--x-chip-solid);
    box-shadow: 0 0 0 1.5px var(--x-line);
    transition:
      transform 0.25s cubic-bezier(0.3, 1.6, 0.5, 1),
      background-color 0.25s;
  }
  .past .dot {
    background: var(--x-accent);
    box-shadow: none;
  }
  .on .dot {
    width: 13px;
    height: 13px;
    margin-left: -6.5px;
    background: var(--x-accent);
    box-shadow:
      0 0 0 3px var(--x-chip-solid),
      0 0 0 4.5px var(--x-accent);
  }
  .num {
    position: absolute;
    left: 2.05rem;
    font-family: var(--serif);
    font-size: 0.74rem;
    color: var(--x-faint);
    font-variant-numeric: tabular-nums;
    transform: translateY(-0.05rem);
  }
  .on .num {
    color: var(--x-ink);
    font-weight: 600;
  }

  .buttons {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding-top: 0.45rem;
    border-top: 1px solid var(--x-line);
  }
  .round {
    width: 2.3rem;
    height: 2.3rem;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 50% 46% 54% 48% / 48% 54% 46% 50%;
    background: var(--x-chip);
    color: var(--x-ink);
    cursor: pointer;
    transition:
      transform 0.25s cubic-bezier(0.25, 0.8, 0.3, 1.4),
      background-color 0.2s;
  }
  .round:hover:not(:disabled) {
    transform: scale(1.08) rotate(-4deg);
  }
  .round.go {
    background: color-mix(in srgb, var(--x-accent) 45%, transparent);
  }
  .round:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* On a phone the notes take the bottom of the screen: the ladder is shorter and sits higher. */
  @media (max-width: 640px) {
    .stem {
      top: 6rem;
      transform: none;
      right: 0.6rem;
      width: 3.4rem;
    }
    @keyframes arrive {
      from {
        opacity: 0;
        transform: translateX(14px);
      }
    }
    .ladder {
      height: 15vh;
    }
  }
</style>
