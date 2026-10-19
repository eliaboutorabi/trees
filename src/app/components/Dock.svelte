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
    cardBottom = window.innerHeight - d.top + 10;
  }

  $effect(() => {
    void openId;
    void card;
    requestAnimationFrame(place);
  });

  onMount(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (card?.contains(t) || dock?.contains(t)) return;
      close();
    };
    const onUp = () => {
      holding = false;
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
      style="left: {cardLeft}px; bottom: {cardBottom}px"
      role="dialog"
      aria-label={open.label}
      tabindex="-1"
      onpointerenter={stay}
      onpointerleave={leave}
      onpointerdown={grab}
    >
      <div class="card__head">
        <Icon icon={open.icon} size={15} strokeWidth={1.8} />
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
      class:active={openId === tool.id}
      class:pinned={pinned === tool.id}
      bind:this={buttons[tool.id]}
      onpointerenter={() => enter(tool.id)}
      onpointerleave={leave}
      onclick={() => toggle(tool.id)}
      aria-label={tool.label}
      aria-expanded={openId === tool.id}
    >
      <Icon icon={tool.icon} size={20} strokeWidth={1.7} />
      <span class="tip">{tool.label}</span>
    </button>
  {/each}
  {#if children}
    <span class="gap wide"></span>
    {@render children()}
  {/if}
</nav>

<style>
  .dock {
    position: absolute;
    left: 50%;
    bottom: 1.4rem;
    transform: translateX(-50%);
    z-index: 6;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.45rem 0.6rem;
    border-radius: 999px;
    background: linear-gradient(to bottom, rgba(34, 27, 21, 0.66), rgba(18, 14, 11, 0.6));
    border: 1px solid rgba(255, 255, 255, 0.12);
    backdrop-filter: blur(22px) saturate(1.4);
    -webkit-backdrop-filter: blur(22px) saturate(1.4);
    box-shadow:
      0 14px 44px rgba(0, 0, 0, 0.42),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
    max-width: calc(100vw - 1.5rem);
    overflow-x: auto;
    scrollbar-width: none;
  }

  .gap {
    width: 1px;
    height: 1.6rem;
    margin: 0 0.25rem;
    background: rgba(255, 255, 255, 0.12);
    flex: none;
  }

  .tool {
    position: relative;
    flex: none;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    border: 1px solid transparent;
    background: rgba(255, 255, 255, 0.04);
    color: var(--ink-dim);
    cursor: pointer;
    transition:
      transform 0.18s cubic-bezier(0.3, 0.7, 0.4, 1.4),
      background 0.18s,
      color 0.18s,
      border-color 0.18s;
  }

  .tool:hover,
  .tool.active {
    transform: translateY(-3px) scale(1.06);
    background: rgba(255, 255, 255, 0.11);
    color: #fff;
  }

  .tool.pinned {
    background: var(--accent);
    border-color: var(--accent);
    color: #21160c;
  }

  .tool:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* The name, floated just above the button while it is hovered. */
  .tip {
    position: absolute;
    bottom: calc(100% + 0.5rem);
    left: 50%;
    transform: translate(-50%, 4px);
    padding: 0.2rem 0.5rem;
    border-radius: 6px;
    font-size: 0.66rem;
    letter-spacing: 0.04em;
    white-space: nowrap;
    color: var(--ink);
    background: rgba(14, 11, 9, 0.85);
    opacity: 0;
    pointer-events: none;
    transition:
      opacity 0.15s,
      transform 0.15s;
  }

  .tool:hover:not(.active) .tip {
    opacity: 1;
    transform: translate(-50%, 0);
  }

  .card {
    position: fixed;
    z-index: 7;
    width: 20rem;
    max-height: min(62vh, 36rem);
    display: flex;
    flex-direction: column;
    border-radius: 18px;
    background: linear-gradient(to bottom, rgba(34, 27, 21, 0.72), rgba(18, 14, 11, 0.66));
    border: 1px solid rgba(255, 255, 255, 0.13);
    backdrop-filter: blur(28px) saturate(1.45);
    -webkit-backdrop-filter: blur(28px) saturate(1.45);
    box-shadow:
      0 22px 60px rgba(0, 0, 0, 0.5),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
    animation: rise 0.2s cubic-bezier(0.2, 0.8, 0.3, 1.15);
    transform-origin: 50% 100%;
  }

  .card.wide {
    width: 28rem;
  }

  .card.pinned {
    border-color: rgba(240, 176, 100, 0.45);
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.96);
    }
  }

  .card__head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.85rem 1.1rem 0.4rem;
    font-size: 0.72rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  .card__body {
    padding: 0.35rem 1.1rem 1.05rem;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
  }

  @media (max-width: 640px) {
    .card,
    .card.wide {
      width: calc(100vw - 1.5rem);
    }
    .tool {
      width: 2.45rem;
      height: 2.45rem;
    }
  }
</style>
