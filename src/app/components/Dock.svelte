<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { IconSvgElement } from '@hugeicons/svelte';

  export interface Tool {
    id: string;
    label: string;
    icon: IconSvgElement;
    /** What opens above the button. */
    panel: Snippet;
    /** A wider card, for the grammar editor. */
    wide?: boolean;
    /** Tools in the same group sit together; a gap separates groups. */
    group: number;
    /** The tool's pastel, and a deeper shade of it for ink on top. */
    tone: string;
    toneInk: string;
  }
</script>

<script lang="ts">
  /**
   * A row of round tool buttons along the bottom of the scene, each opening a
   * small glass card of its own controls — the shape of a game's build menu
   * rather than an application's settings sidebar.
   *
   * Hover previews a card; clicking the button, or simply starting to use the
   * card, pins it open, so a slider can be dragged without the card vanishing
   * the moment the pointer strays off it. Escape, or a click anywhere else,
   * closes it. One card at a time.
   */
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';

  interface Props {
    tools: Tool[];
    /** Anything else that lives in the dock — the growth controls. */
    children?: Snippet;
  }

  let { tools, children }: Props = $props();

  let hovered = $state<string | null>(null);
  let pinned = $state<string | null>(null);
  const openId = $derived(hovered ?? pinned);
  const open = $derived(tools.find((t) => t.id === openId) ?? null);

  let dock = $state<HTMLElement>();
  let card = $state<HTMLElement>();
  const buttons: Record<string, HTMLButtonElement> = {};
  let cardLeft = $state(0);
  let cardBottom = $state(0);
  /** Where along the card's bottom edge its button is, for the notch. */
  let notch = $state(0);

  let enterTimer: ReturnType<typeof setTimeout> | undefined;
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  /** A pointer is down inside the card — a slider mid-drag. */
  let holding = false;

  function enter(id: string) {
    clearTimeout(leaveTimer);
    clearTimeout(enterTimer);
    // A short delay before the first card, so sweeping the pointer across the
    // dock on the way somewhere else does not flash every card in turn; none
    // once one is already open, so moving along the dock is immediate.
    enterTimer = setTimeout(() => (hovered = id), openId ? 0 : 110);
  }

  function leave() {
    clearTimeout(enterTimer);
    if (holding) return;
    leaveTimer = setTimeout(() => (hovered = null), 240);
  }

  function stay() {
    clearTimeout(leaveTimer);
  }

  function toggle(id: string) {
    clearTimeout(enterTimer);
    pinned = pinned === id ? null : id;
    hovered = pinned ? null : hovered;
  }

  function close() {
    pinned = null;
    hovered = null;
  }

  // Touching the card means you are using it: keep it.
  function grab() {
    holding = true;
    if (openId) pinned = openId;
    hovered = null;
  }

  /** Centre the card over its button, kept on screen. */
  function place() {
    if (!open || !card || !dock) return;
    const button = buttons[open.id];
    if (!button) return;
    const b = button.getBoundingClientRect();
    const d = dock.getBoundingClientRect();
    const w = card.offsetWidth;
    const margin = 12;
    cardLeft = Math.min(Math.max(b.left + b.width / 2 - w / 2, margin), window.innerWidth - w - margin);
    cardBottom = window.innerHeight - d.top + 12;
    notch = Math.min(Math.max(b.left + b.width / 2 - cardLeft, 18), w - 18);
  }

  $effect(() => {
    void openId;
    void card;
    requestAnimationFrame(place);
  });

  onMount(() => {
    // A click on the scene closes the card; a drag does not. Dragging is how
    // the camera is orbited, and the moment you most want a pinned card to
    // stay is while you swing round to see what its slider just did.
    let downAt: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      downAt = card?.contains(t) || dock?.contains(t) ? null : { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      holding = false;
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 5) close();
      downAt = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
    };
  });
</script>

{#if open}
  {#key open.id}
    <div
      class="card"
      class:wide={open.wide}
      class:pinned={pinned === open.id}
      bind:this={card}
      style="left: {cardLeft}px; bottom: {cardBottom}px; --notch: {notch}px; --tone: {open.tone}; --tone-ink: {open.toneInk}"
      role="dialog"
      aria-label={open.label}
      tabindex="-1"
      onpointerenter={stay}
      onpointerleave={leave}
      onpointerdown={grab}
    >
      <div class="card__head">
        <span class="badge"><Icon icon={open.icon} size={16} strokeWidth={2} /></span>
        <span>{open.label}</span>
      </div>
      <div class="card__body">
        {@render open.panel()}
      </div>
    </div>
  {/key}
{/if}

<nav class="dock" bind:this={dock} aria-label="Tools">
  {#each tools as tool, i (tool.id)}
    {#if i > 0 && tool.group !== tools[i - 1].group}<span class="gap"></span>{/if}
    <button
      class="tool"
      style="--tone: {tool.tone}; --tone-ink: {tool.toneInk}"
      class:active={openId === tool.id}
      class:pinned={pinned === tool.id}
      bind:this={buttons[tool.id]}
      onpointerenter={() => enter(tool.id)}
      onpointerleave={leave}
      onclick={() => toggle(tool.id)}
      aria-label={tool.label}
      aria-expanded={openId === tool.id}
    >
      <Icon icon={tool.icon} size={21} strokeWidth={2} />
      <span class="tip">{tool.label}</span>
    </button>
  {/each}
  {#if children}
    <span class="gap wide"></span>
    {@render children()}
  {/if}
</nav>

<style>
  /*
   * No tray: the tools are a row of separate round pastel buttons sitting on
   * the scene, each in its own colour, that bob up when you reach for them.
   */
  .dock {
    position: absolute;
    left: 50%;
    bottom: 1.3rem;
    transform: translateX(-50%);
    z-index: 6;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.4rem 0.2rem;
    max-width: calc(100vw - 1rem);
    overflow-x: auto;
    scrollbar-width: none;
  }

  .gap {
    width: 0.55rem;
    flex: none;
  }

  .gap.wide {
    width: 0.9rem;
  }

  .tool {
    position: relative;
    flex: none;
    width: 3.1rem;
    height: 3.1rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    border: 3px solid #fffaf2;
    background: var(--tone);
    color: var(--tone-ink);
    cursor: pointer;
    box-shadow:
      0 6px 14px rgba(70, 45, 25, 0.25),
      inset 0 -4px 0 rgba(0, 0, 0, 0.07),
      inset 0 3px 0 rgba(255, 255, 255, 0.45);
    transition:
      transform 0.22s cubic-bezier(0.3, 0.7, 0.4, 1.6),
      box-shadow 0.22s;
  }

  .tool:hover,
  .tool.active {
    transform: translateY(-6px) rotate(-4deg) scale(1.08);
    box-shadow:
      0 12px 22px rgba(70, 45, 25, 0.28),
      inset 0 -4px 0 rgba(0, 0, 0, 0.07),
      inset 0 3px 0 rgba(255, 255, 255, 0.45);
  }

  .tool.pinned {
    transform: translateY(-8px) scale(1.1);
    border-color: var(--tone-ink);
  }

  .tool:focus-visible {
    outline: 3px solid var(--tone-ink);
    outline-offset: 2px;
  }

  /* The name, in a little cream bubble above the button. */
  .tip {
    position: absolute;
    bottom: calc(100% + 0.55rem);
    left: 50%;
    transform: translate(-50%, 4px);
    padding: 0.22rem 0.6rem;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 700;
    white-space: nowrap;
    color: var(--ink);
    background: var(--paper);
    box-shadow: 0 4px 10px rgba(70, 45, 25, 0.2);
    opacity: 0;
    pointer-events: none;
    transition:
      opacity 0.15s,
      transform 0.15s;
  }

  .card {
    position: fixed;
    z-index: 7;
    width: 20rem;
    max-height: min(64vh, 38rem);
    display: flex;
    flex-direction: column;
    border-radius: 26px;
    background: var(--paper);
    border: 3px solid #fffdf8;
    box-shadow: var(--shadow);
    color: var(--ink);
    animation: rise 0.24s cubic-bezier(0.2, 0.9, 0.3, 1.35);
    transform-origin: 50% 100%;
  }

  .card.wide {
    width: 28rem;
  }

  /* A small notch on the bottom edge, over the button the card belongs to. */
  .card::after {
    content: '';
    position: absolute;
    left: var(--notch, 50%);
    bottom: -9px;
    width: 14px;
    height: 14px;
    transform: translateX(-50%) rotate(45deg);
    background: var(--paper);
    border-right: 3px solid #fffdf8;
    border-bottom: 3px solid #fffdf8;
    border-bottom-right-radius: 4px;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(14px) scale(0.92);
    }
  }

  .card__head {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    margin: 0.55rem 0.55rem 0.3rem;
    padding: 0.45rem 0.7rem;
    border-radius: 18px;
    background: var(--tone);
    color: var(--tone-ink);
    font-size: 0.86rem;
    font-weight: 800;
    letter-spacing: 0.01em;
  }

  .badge {
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: rgba(255, 255, 255, 0.6);
  }

  .card__body {
    padding: 0.5rem 1.1rem 1.1rem;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(110, 80, 50, 0.2) transparent;
  }

  @media (hover: hover) {
    .tool:hover:not(.active) .tip {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }

  @media (max-width: 640px) {
    .card,
    .card.wide {
      width: calc(100vw - 1.5rem);
    }
    .tool {
      width: 2.7rem;
      height: 2.7rem;
    }
    /* On a phone the dock scrolls sideways; fading its ends is what says so. */
    .dock {
      mask-image: linear-gradient(to right, transparent, #000 1.1rem, #000 calc(100% - 1.1rem), transparent);
      -webkit-mask-image: linear-gradient(to right, transparent, #000 1.1rem, #000 calc(100% - 1.1rem), transparent);
    }
  }
</style>
