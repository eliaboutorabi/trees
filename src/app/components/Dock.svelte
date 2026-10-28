<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { GlyphName } from './glyphs';

  export interface Tool {
    id: string;
    label: string;
    icon: GlyphName;
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
   *
   * Nothing here ever scrolls or is cut off. A card's exact controls open in
   * a second panel that slides out beside it (or, where there is no room
   * beside it, takes its place), laid out in as many columns as it needs to
   * fit the height there is; and a card or panel that would still not fit is
   * drawn smaller, the way a game's interface scales with its window.
   */
  import { onMount, setContext, tick } from 'svelte';
  import { cubicIn } from 'svelte/easing';
  import Glyph from './Glyph.svelte';
  import { MORE, type MoreHost } from './more';
  import { paperImage, paperPath, seedOf } from './paper';

  /*
   * Each button is a pebble: its own slightly irregular outline and its own
   * small tilt, the way stones laid in a row never quite match.
   */
  const PEBBLES = [
    ['52% 48% 55% 45% / 47% 55% 45% 53%', -3],
    ['46% 54% 49% 51% / 55% 46% 54% 45%', 2],
    ['55% 45% 51% 49% / 50% 56% 44% 50%', -1.5],
    ['49% 51% 45% 55% / 45% 50% 50% 55%', 3],
    ['53% 47% 52% 48% / 52% 44% 56% 48%', -2.5],
    ['47% 53% 55% 45% / 49% 54% 46% 51%', 1.5],
  ] as const;

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

  // ---------------------------------------------------------- fine-tune
  let more = $state<{ label: string; panel: Snippet } | null>(null);
  let moreOpen = $state(false);
  let morePanel = $state<HTMLElement>();
  let moreLeft = $state(0);
  let moreCols = $state(1);
  let moreScale = $state(1);
  /** No room beside the card: the panel takes the card's place instead. */
  let moreOver = $state(false);
  let moreReady = $state(false);
  let cardScale = $state(1);

  setContext<MoreHost>(MORE, {
    offer(label, panel) {
      more = { label, panel };
      return () => {
        if (more?.panel === panel) {
          more = null;
          moreOpen = false;
        }
      };
    },
  });

  // A different card starts with its exact controls put away.
  $effect(() => {
    void openId;
    moreOpen = false;
  });

  /** Room above the dock, below the name and the buttons along the top. */
  const TOP = 76;
  const GAP = 10;
  const MARGIN = 12;
  const COLUMN = 300;

  /** Shrink the card, if it must, to fit the height above the dock. */
  function fitCard() {
    if (!card) return;
    const room = window.innerHeight - cardBottom - TOP;
    cardScale = Math.min(1, room / card.offsetHeight);
  }

  /**
   * Lay the fine-tune panel out: as many columns as it takes to fit the height,
   * then beside the card on whichever side has room, or over it if neither does.
   */
  async function layoutMore() {
    if (!moreOpen || !card) return;
    moreReady = false;
    moreCols = 1;
    moreScale = 1;
    await tick();
    if (!morePanel) return;
    const room = window.innerHeight - cardBottom - TOP;
    const body = morePanel.querySelector('.more__body') as HTMLElement;
    const chrome = morePanel.offsetHeight - body.offsetHeight;
    // Aim to stand no taller than the card it belongs to: the two read as a
    // pair, and a tall column of numbers beside a short card looks like a list.
    const goal = Math.min(room, Math.max(card.offsetHeight * cardScale, 360));
    const cols = Math.min(3, Math.max(1, Math.ceil(body.offsetHeight / Math.max(120, goal - chrome))));

    const c = card.getBoundingClientRect();
    const width = (n: number) => n * COLUMN + (n - 1) * 20 + 36;
    // Whatever else is pinned to the edges of the scene — the growth stem —
    // marks itself to be kept clear, and the panel stops short of it.
    let rightEdge = window.innerWidth;
    let leftEdge = 0;
    for (const el of document.querySelectorAll<HTMLElement>('[data-keep-clear]')) {
      const r = el.getBoundingClientRect();
      if (r.left >= c.right) rightEdge = Math.min(rightEdge, r.left);
      else if (r.right <= c.left) leftEdge = Math.max(leftEdge, r.right);
    }
    const right = rightEdge - c.right - GAP - MARGIN;
    const left = c.left - leftEdge - GAP - MARGIN;
    // Fewer, taller columns are fine when the side has no room for more.
    let n = cols;
    while (n > 1 && Math.max(right, left) < width(n) * cardScale) n--;
    moreOver = Math.max(right, left) < width(n) * cardScale;
    moreCols = moreOver ? Math.min(cols, Math.max(1, Math.floor((c.width - 36 + 20) / (COLUMN + 20)))) : n;
    await tick();
    if (!morePanel) return;
    // Drawn at the card's scale, so the pair match — smaller only if it must be.
    moreScale = Math.min(cardScale, room / morePanel.offsetHeight);
    // The panel scales about its foot on the side nearest the card (see the
    // origins in the styles), so its unscaled width places it.
    const full = morePanel.offsetWidth;
    const w = full * moreScale;
    if (moreOver) {
      const centre = Math.min(Math.max(c.left + c.width / 2, MARGIN + w / 2), window.innerWidth - MARGIN - w / 2);
      moreLeft = centre - full / 2;
    } else {
      moreLeft = right >= w ? c.right + GAP : c.left - GAP - full;
    }
    moreReady = true;
  }

  $effect(() => {
    void moreOpen;
    void more;
    requestAnimationFrame(() => void layoutMore());
  });

  // Cards change size as they are used (rain brings its own slider): refit.
  $effect(() => {
    if (!card) return;
    const ro = new ResizeObserver(() => {
      fitCard();
      if (moreOpen) void layoutMore();
    });
    ro.observe(card);
    return () => ro.disconnect();
  });

  /*
   * Leaving as gently as arriving. A card used to rise in and then simply
   * vanish — on Escape, on a click elsewhere, or when the pointer moved to
   * the next button — and the fine-tune pane did the same. Now each settles
   * back down and fades, quickly enough that moving along the dock still
   * feels immediate.
   */
  function cardOut(_node: Element) {
    return {
      duration: 150,
      easing: cubicIn,
      css: (t: number) => `opacity: ${t}; transform: translateY(${(1 - t) * 10}px) scale(${0.97 + 0.03 * t})`,
    };
  }

  function paneOut(_node: Element, { toLeft }: { toLeft: boolean }) {
    return {
      duration: 170,
      easing: cubicIn,
      css: (t: number) => `opacity: ${t}; transform: translateX(${(1 - t) * (toLeft ? 18 : -18)}px)`,
    };
  }

  /*
   * Each card is a sheet cut by hand (see `paper.ts`): its own outline, kept
   * for that card, used to mask the frosted sheet, to cast its shadow, and to
   * draw the faint light along its cut edge.
   */
  const cuts = new Map<string, { d: string; w: number; h: number; mask: string; shadow: string }>();
  function cutFor(id: string, w: number, h: number) {
    w = Math.round(w);
    h = Math.round(h);
    if (w < 8 || h < 8) return null;
    const key = `${id}@${w}x${h}`;
    let cut = cuts.get(key);
    if (!cut) {
      const d = paperPath(w, h, seedOf(id));
      cut = { d, w, h, mask: paperImage(d, w, h), shadow: paperImage(d, w, h, 'rgb(20,14,6)') };
      if (cuts.size > 64) cuts.clear();
      cuts.set(key, cut);
    }
    return cut;
  }
  // Measured at layout size (unaffected by the fit-to-window `scale`), so the
  // outline is drawn at the card's real size, never stretched.
  let cardW = $state(0);
  let cardH = $state(0);
  let moreW = $state(0);
  let moreH = $state(0);
  const cardCut = $derived(open ? cutFor(open.id, cardW, cardH) : null);
  const moreCut = $derived(open ? cutFor(`${open.id}:more`, moreW, moreH) : null);

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
    cardBottom = window.innerHeight - d.top + 6;
    fitCard();
    if (moreOpen) void layoutMore();
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
      downAt = card?.contains(t) || morePanel?.contains(t) || dock?.contains(t) ? null : { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      holding = false;
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 5) close();
      downAt = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape steps back one level: the fine-tune panel first, then the card.
      if (moreOpen) moreOpen = false;
      else close();
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
      out:cardOut|global
      class="card"
      class:wide={open.wide}
      class:pinned={pinned === open.id}
      class:covered={moreOpen && moreOver && moreReady}
      bind:this={card}
      bind:clientWidth={cardW}
      bind:clientHeight={cardH}
      style="left: {cardLeft}px; bottom: {cardBottom}px; scale: {cardScale}; --tone: {open.tone}; --tone-ink: {open.toneInk}; --cut: {cardCut?.mask}; --cut-shadow: {cardCut?.shadow}"
      role="dialog"
      aria-label={open.label}
      tabindex="-1"
      onpointerenter={stay}
      onpointerleave={leave}
      onpointerdown={grab}
    >
      <span class="sheet" aria-hidden="true"></span>
      {#if cardCut}
        <svg class="edge" viewBox="0 0 {cardCut.w} {cardCut.h}" preserveAspectRatio="none" aria-hidden="true"><path d={cardCut.d} /></svg>
      {/if}
      <div class="card__head">
        <span class="badge"><Glyph name={open.icon} size={21} weight={1.85} /></span>
        <span class="title">
          {open.label}
          <svg class="stroke" viewBox="0 0 120 8" preserveAspectRatio="none" aria-hidden="true">
            <path d="M2 5.2c14-2.6 27-2.9 40-1.4 14 1.6 27 1.9 41-.4 12-1.9 23-1.6 35 .6" />
          </svg>
        </span>
        {#if more}
          <button
            class="more-toggle"
            class:on={moreOpen}
            onclick={() => (moreOpen = !moreOpen)}
            aria-expanded={moreOpen}
            title="The exact numbers behind the pictures"
          >
            <Glyph name="tune" size={17} weight={1.7} />
            {more.label}
          </button>
        {/if}
      </div>
      <div class="card__body">
        {@render open.panel()}
      </div>
    </div>
  {/key}
{/if}

{#if open && more && moreOpen}
  <div
    out:paneOut|global={{ toLeft: !moreOver && moreLeft < cardLeft }}
    class="more"
    class:over={moreOver}
    class:ready={moreReady}
    class:left={!moreOver && moreLeft < cardLeft}
    bind:this={morePanel}
    bind:clientWidth={moreW}
    bind:clientHeight={moreH}
    style="left: {moreLeft}px; bottom: {cardBottom}px; scale: {moreScale}; --tone: {open.tone}; --tone-ink: {open.toneInk}; --cut: {moreCut?.mask}; --cut-shadow: {moreCut?.shadow}"
    role="dialog"
    aria-label="{open.label}: {more.label}"
    tabindex="-1"
    onpointerenter={stay}
    onpointerleave={leave}
    onpointerdown={grab}
  >
    <span class="sheet" aria-hidden="true"></span>
    {#if moreCut}
      <svg class="edge" viewBox="0 0 {moreCut.w} {moreCut.h}" preserveAspectRatio="none" aria-hidden="true"><path d={moreCut.d} /></svg>
    {/if}
    <div class="more__head">
      <span class="more__badge"><Glyph name="tune" size={17} weight={1.7} /></span>
      <span class="more__title">{more.label}<small>{open.label}</small></span>
      <button class="more__close" onclick={() => (moreOpen = false)} aria-label="Put the exact controls away" title="Back (Esc)">
        <Glyph name="close" size={16} weight={1.8} />
      </button>
    </div>
    <div class="more__body" style="column-count: {moreCols}; width: {moreCols * COLUMN + (moreCols - 1) * 20}px">
      {@render more.panel()}
    </div>
  </div>
{/if}

<nav class="dock" bind:this={dock} aria-label="Tools">
  {#each tools as tool, i (tool.id)}
    {#if i > 0 && tool.group !== tools[i - 1].group}<span class="gap"></span>{/if}
    <button
      class="tool"
      style="--tone: {tool.tone}; --tone-ink: {tool.toneInk}; --shape: {PEBBLES[i % PEBBLES.length][0]}; --tilt: {PEBBLES[i % PEBBLES.length][1]}deg"
      class:active={openId === tool.id}
      class:pinned={pinned === tool.id}
      bind:this={buttons[tool.id]}
      onpointerenter={() => enter(tool.id)}
      onpointerleave={leave}
      onclick={() => toggle(tool.id)}
      aria-label={tool.label}
      aria-expanded={openId === tool.id}
    >
      <Glyph name={tool.icon} size={29} weight={1.8} />
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
   * No tray: a row of pebbles on the scene. Each is frosted glass tinted with
   * its tool's garden colour, so the scene glows through it, and each has its
   * own outline and tilt. The pinned one sits up off the ground with a small
   * seed of colour under it.
   */
  .dock {
    position: absolute;
    left: 50%;
    bottom: 1.1rem;
    transform: translateX(-50%);
    z-index: 6;
    display: flex;
    align-items: flex-end;
    gap: 0.55rem;
    padding: 0.9rem 0.6rem 0.5rem;
    max-width: calc(100vw - 1rem);
    overflow-x: auto;
    scrollbar-width: none;
  }

  .gap {
    width: 0.7rem;
    flex: none;
  }

  .tool {
    position: relative;
    flex: none;
    width: 3.6rem;
    height: 3.42rem;
    border-radius: var(--shape);
    display: grid;
    place-items: center;
    border: none;
    background:
      var(--sheen),
      radial-gradient(130% 120% at 30% 20%, color-mix(in srgb, var(--tone) 82%, white 18%), color-mix(in srgb, var(--tone) 58%, transparent));
    backdrop-filter: var(--frost);
    -webkit-backdrop-filter: var(--frost);
    /* Drawn in a deep ink of the tool's colour and coloured in with light. */
    color: color-mix(in srgb, var(--tone-ink) 82%, #000 18%);
    --glyph-wash: #fffaf0;
    --glyph-wash-opacity: 0.72;
    cursor: pointer;
    transform: rotate(var(--tilt));
    box-shadow:
      var(--rim),
      0 8px 18px rgba(20, 14, 6, 0.22);
    transition:
      transform 0.35s cubic-bezier(0.25, 0.8, 0.3, 1.3),
      box-shadow 0.3s,
      --tone 0.7s,
      --tone-ink 0.7s;
  }

  .tool:hover,
  .tool.active {
    transform: translateY(-5px) rotate(calc(var(--tilt) * -0.6)) scale(1.06);
    box-shadow:
      var(--rim),
      0 14px 24px rgba(20, 14, 6, 0.26);
  }

  .tool.pinned {
    transform: translateY(-7px) rotate(0deg) scale(1.08);
    background:
      var(--sheen),
      radial-gradient(130% 120% at 30% 20%, color-mix(in srgb, var(--tone) 94%, white 6%), color-mix(in srgb, var(--tone) 84%, transparent));
  }

  /* A seed of the tool's colour under the one that is open. */
  .tool::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: -0.7rem;
    width: 0.38rem;
    height: 0.3rem;
    border-radius: 50% 50% 45% 55%;
    background: var(--tone-ink);
    opacity: 0;
    transform: translateX(-50%) scale(0.4);
    transition:
      opacity 0.25s,
      transform 0.3s cubic-bezier(0.3, 0.8, 0.3, 1.6);
  }

  .tool.pinned::after {
    opacity: 0.85;
    transform: translateX(-50%) scale(1);
  }

  .tool:focus-visible {
    outline: 2px solid var(--tone-ink);
    outline-offset: 3px;
  }

  .tip {
    position: absolute;
    bottom: calc(100% + 0.6rem);
    left: 50%;
    transform: translate(-50%, 4px) rotate(calc(var(--tilt) * -1));
    padding: 0.25rem 0.65rem 0.3rem;
    border-radius: 12px 10px 13px 9px;
    font-family: var(--serif);
    font-size: 0.82rem;
    font-weight: 500;
    font-variation-settings: 'SOFT' 100, 'opsz' 14;
    white-space: nowrap;
    color: var(--ink);
    background: var(--sheen), var(--glass);
    backdrop-filter: var(--frost);
    -webkit-backdrop-filter: var(--frost);
    box-shadow: var(--rim), 0 6px 14px rgba(28, 20, 10, 0.18);
    opacity: 0;
    pointer-events: none;
    transition:
      opacity 0.18s,
      transform 0.18s;
  }

  /*
   * The card: a sheet of frosted vellum with hand-cut corners. A wash of the
   * tool's colour at the top is all the colour it carries; the scene shows
   * through the rest of it.
   */
  .card {
    position: fixed;
    z-index: 7;
    width: 20.5rem;
    display: flex;
    flex-direction: column;
    /* The sheet, its edge and its shadow are drawn by the layers below. */
    isolation: isolate;
    --tint: 46%;
    color: var(--ink);
    animation: rise 0.34s cubic-bezier(0.2, 0.85, 0.3, 1.15);
    transform-origin: 50% 100%;
  }

  .card.wide {
    width: 28rem;
  }

  /*
   * A hand-cut sheet of frosted paper. Not a rounded rectangle: its outline
   * (see `paper.ts`) masks the frost, so the sheet has soft uneven corners
   * and edges that wander a little; paper grain lies over the glass; a light
   * line follows the cut; and the shadow under it is the same shape, blurred.
   */
  .sheet {
    position: absolute;
    inset: 0;
    z-index: -1;
    background:
      var(--paper-grain),
      var(--sheen),
      linear-gradient(175deg, color-mix(in srgb, var(--tone) var(--tint), transparent), transparent 30%),
      var(--glass);
    backdrop-filter: var(--frost);
    -webkit-backdrop-filter: var(--frost);
    mask: var(--cut) 0 0 / 100% 100% no-repeat;
    -webkit-mask: var(--cut) 0 0 / 100% 100% no-repeat;
  }

  .edge {
    position: absolute;
    inset: 0;
    z-index: -1;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }

  .edge path {
    fill: none;
    stroke: rgba(255, 255, 255, 0.5);
    stroke-width: 1;
  }

  .card::before,
  .more::before {
    content: '';
    position: absolute;
    inset: 8px 0 -10px 0;
    z-index: -2;
    background: var(--cut-shadow) 0 0 / 100% 100% no-repeat;
    opacity: 0.28;
    filter: blur(14px);
    pointer-events: none;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(12px) scale(0.96) rotate(-0.6deg);
    }
  }

  .card__head {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 1rem 1.2rem 0.35rem 1.05rem;
    color: var(--tone-ink);
  }

  .badge {
    width: 2.3rem;
    height: 2.2rem;
    border-radius: 48% 52% 55% 45% / 52% 46% 54% 48%;
    display: grid;
    place-items: center;
    color: color-mix(in srgb, var(--tone-ink) 82%, #000 18%);
    --glyph-wash: #fffaf0;
    --glyph-wash-opacity: 0.72;
    background: color-mix(in srgb, var(--tone) 72%, rgba(255, 255, 255, 0.2));
  }

  .title {
    position: relative;
    font-family: var(--serif);
    font-size: 1.22rem;
    font-weight: 560;
    font-variation-settings: 'SOFT' 100, 'opsz' 30;
    letter-spacing: -0.005em;
    color: var(--ink);
  }

  /* A hand-drawn stroke under the title, in the tool's colour. */
  .stroke {
    position: absolute;
    left: -2%;
    bottom: -0.38rem;
    width: 104%;
    height: 0.5rem;
    overflow: visible;
  }

  .stroke path {
    fill: none;
    stroke: var(--tone);
    stroke-width: 3;
    stroke-linecap: round;
    opacity: 0.9;
  }

  .card__body {
    padding: 0.7rem 1.2rem 1.15rem;
  }

  .card {
    transition:
      opacity 0.25s,
      filter 0.25s;
  }

  /* While its exact controls stand in for it, the card steps back. */
  .card.covered {
    opacity: 0;
    pointer-events: none;
  }

  /* The Fine-tune button, at the right of the card's header. */
  .more-toggle {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.32rem 0.7rem 0.32rem 0.5rem;
    border: none;
    border-radius: 14px 17px 13px 16px / 16px 13px 17px 14px;
    background: rgba(255, 255, 255, 0.24);
    color: var(--ink-dim);
    font-size: 0.74rem;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    --glyph-wash: var(--tone);
    --glyph-wash-opacity: 0.9;
    transition:
      background 0.2s,
      color 0.2s,
      transform 0.3s cubic-bezier(0.25, 0.8, 0.3, 1.4);
  }

  .more-toggle:hover {
    color: var(--ink);
    background: rgba(255, 255, 255, 0.42);
    transform: rotate(-2deg);
  }

  .more-toggle.on {
    color: color-mix(in srgb, var(--tone-ink) 85%, #000 15%);
    background: color-mix(in srgb, var(--tone) 62%, rgba(255, 255, 255, 0.2));
    --glyph-wash: #fffaf0;
  }

  /*
   * The exact controls: a second, narrower pane that slides out from behind the
   * card, its foot level with the card's. Columns, never a scrollbar.
   */
  .more {
    position: fixed;
    z-index: 7;
    display: flex;
    flex-direction: column;
    isolation: isolate;
    --tint: 30%;
    color: var(--ink);
    transform-origin: 0 100%;
    visibility: hidden;
  }

  .more.left {
    transform-origin: 100% 100%;
  }

  .more.over {
    transform-origin: 50% 100%;
  }

  .more.ready {
    visibility: visible;
    animation: slide-out 0.38s cubic-bezier(0.2, 0.85, 0.3, 1.15);
  }

  .more.left.ready {
    animation-name: slide-out-left;
  }

  .more.over.ready {
    animation-name: flip-in;
  }

  @keyframes slide-out {
    from {
      opacity: 0;
      transform: translateX(-28px) rotate(-1deg) scale(0.97);
    }
  }

  @keyframes slide-out-left {
    from {
      opacity: 0;
      transform: translateX(28px) rotate(1deg) scale(0.97);
    }
  }

  /* Where it takes the card's place, it turns over like the card's back. */
  @keyframes flip-in {
    from {
      opacity: 0;
      transform: perspective(900px) rotateY(-70deg);
    }
  }

  .more__head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.85rem 0.8rem 0.3rem 1rem;
  }

  .more__badge {
    width: 2rem;
    height: 1.9rem;
    display: grid;
    place-items: center;
    border-radius: 48% 52% 55% 45% / 52% 46% 54% 48%;
    color: color-mix(in srgb, var(--tone-ink) 82%, #000 18%);
    --glyph-wash: #fffaf0;
    --glyph-wash-opacity: 0.72;
    background: color-mix(in srgb, var(--tone) 72%, rgba(255, 255, 255, 0.2));
  }

  .more__title {
    display: flex;
    flex-direction: column;
    font-family: var(--serif);
    font-size: 1.02rem;
    font-weight: 560;
    font-variation-settings: 'SOFT' 100;
    line-height: 1.1;
  }

  .more__title small {
    font-family: var(--sans);
    font-size: 0.68rem;
    font-weight: 500;
    color: var(--ink-faint);
  }

  .more__close {
    margin-left: auto;
    width: 1.9rem;
    height: 1.85rem;
    display: grid;
    place-items: center;
    border: none;
    border-radius: 50% 46% 54% 48%;
    background: rgba(255, 255, 255, 0.24);
    color: var(--ink-dim);
    cursor: pointer;
    transition:
      background 0.2s,
      transform 0.3s cubic-bezier(0.25, 0.8, 0.3, 1.4);
  }

  .more__close:hover {
    background: rgba(255, 255, 255, 0.45);
    color: var(--ink);
    transform: rotate(90deg);
  }

  .more__body {
    padding: 0.55rem 1.1rem 0.9rem 1.1rem;
    column-gap: 20px;
    column-fill: balance;
    box-sizing: content-box;
  }

  .more__body > :global(*) {
    break-inside: avoid;
  }

  @media (hover: hover) {
    .tool:hover:not(.active) .tip {
      opacity: 1;
      transform: translate(-50%, 0) rotate(calc(var(--tilt) * -1));
    }
  }

  @media (max-width: 640px) {
    .card,
    .card.wide {
      width: calc(100vw - 1.5rem);
    }
    .tool {
      width: 3rem;
      height: 2.88rem;
    }
    /* On a phone the dock scrolls sideways; fading its ends is what says so. */
    .dock {
      mask-image: linear-gradient(to right, transparent, #000 1.1rem, #000 calc(100% - 1.1rem), transparent);
      -webkit-mask-image: linear-gradient(to right, transparent, #000 1.1rem, #000 calc(100% - 1.1rem), transparent);
    }
  }
</style>
