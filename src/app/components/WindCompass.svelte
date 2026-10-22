<script lang="ts">
  /**
   * Wind as an arrow you pull. Its direction is where the wind blows the tree
   * toward and its length is how hard — calm at the middle, a gale at the rim,
   * on a square-root scale so the everyday breezes get most of the room.
   * Streaks drift across the dial at the wind's own pace, so the setting can be
   * seen as well as read.
   *
   * Drawn relative to the camera, like the sun dial: the top is the far side of
   * the tree. `direction` uses the same compass convention as the camera
   * `bearing`.
   */
  interface Props {
    direction: number;
    strength: number;
    /** How fast the gusts come — sets the streaks' pace. */
    gusts: number;
    bearing: number;
    max?: number;
  }

  import Viewpoint from './Viewpoint.svelte';
  import { wobble } from './wobble';

  let { direction = $bindable(), strength = $bindable(), gusts, bearing, max = 1.5 }: Props = $props();

  const R = 88;
  const C = 100;
  const rad = Math.PI / 180;
  const rim = wobble(C, C, R, 2.1);

  const phi = $derived(bearing + 180 - direction);
  // Square-root scale: ordinary breezes sit low in the range, and a linear
  // arrow for them was a stub too short to grab. This gives a typical wind a
  // good long handle and still reaches the rim at the top of the range.
  const len = $derived(Math.sqrt(Math.min(max, Math.max(0, strength)) / max) * R);
  const tipX = $derived(C + Math.sin(phi * rad) * len);
  const tipY = $derived(C - Math.cos(phi * rad) * len);

  const word = $derived(
    strength < 0.06 ? 'Calm' : strength < 0.3 ? 'Light breeze' : strength < 0.65 ? 'Breezy' : strength < 1.05 ? 'Windy' : 'A gale',
  );
  const toward = $derived.by(() => {
    if (strength < 0.06) return '';
    const p = ((phi % 360) + 360) % 360;
    if (p < 45 || p >= 315) return 'blowing away from you';
    if (p < 135) return 'blowing to the right';
    if (p < 225) return 'blowing toward you';
    return 'blowing to the left';
  });

  // Streaks: a fixed set of short lines, rotated to the wind and scrolled
  // along it. Seconds per pass shrink as wind and gusts rise.
  const streaks = [
    [-50, -40, 34],
    [-10, -62, 26],
    [30, -30, 40],
    [-58, 8, 30],
    [8, 14, 36],
    [44, 40, 28],
    [-30, 52, 32],
    [60, -6, 24],
  ];
  const pace = $derived(strength < 0.06 ? 0 : Math.max(0.5, 3.2 / (0.4 + strength * 1.6) / Math.max(0.35, gusts)));

  let svg: SVGSVGElement;
  let dragging = $state(false);

  function place(e: PointerEvent) {
    const box = svg.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * 200 - C;
    const y = ((e.clientY - box.top) / box.height) * 200 - C;
    const d = Math.min(1, Math.hypot(x, y) / R);
    strength = Math.round(d * d * max * 100) / 100;
    if (d > 0.04) direction = Math.round((((bearing + 180 - Math.atan2(x, -y) / rad) % 360) + 360) % 360);
  }
  function down(e: PointerEvent) {
    dragging = true;
    svg.setPointerCapture(e.pointerId);
    place(e);
  }
  function move(e: PointerEvent) {
    if (dragging) place(e);
  }
  function up(e: PointerEvent) {
    dragging = false;
    svg.releasePointerCapture(e.pointerId);
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowUp') strength = Math.min(max, strength + 0.05);
    else if (e.key === 'ArrowDown') strength = Math.max(0, strength - 0.05);
    else if (e.key === 'ArrowLeft') direction = (direction + 5) % 360;
    else if (e.key === 'ArrowRight') direction = (direction + 355) % 360;
    else return;
    e.preventDefault();
  }
</script>

<div class="compass">
  <svg
    bind:this={svg}
    viewBox="0 0 200 200"
    class:dragging
    role="slider"
    tabindex="0"
    aria-label="Wind"
    aria-valuetext="{word} {toward}"
    aria-valuenow={strength}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onkeydown={key}
  >
    <defs>
      <clipPath id="compass-clip"><path d={rim} /></clipPath>
    </defs>
    <path d={rim} class="rim" />
    <circle cx={C} cy={C} r={R * 0.5} fill="none" stroke="rgba(255,255,255,0.55)" stroke-dasharray="1.5 4.5" stroke-linecap="round" />

    <g clip-path="url(#compass-clip)">
      <g transform="rotate({phi} {C} {C})">
        {#each streaks as [x, y, l], i (i)}
          <line
            class="streak"
            class:still={pace === 0}
            x1={C + x}
            y1={C + y + l / 2}
            x2={C + x}
            y2={C + y - l / 2}
            style="animation-duration: {pace || 1}s; animation-delay: -{(i * 0.37) % 1}s"
          />
        {/each}
      </g>
    </g>

    <Viewpoint x={C} y={C + R} reach={R - 20} id="wind-dial" />
    <circle cx={C} cy={C} r="9" fill="#5d7a33" stroke="#2f4419" stroke-width="1.5" />
    <circle cx={C - 3} cy={C - 3} r="3.5" fill="#86a83c" />

    {#if len > 6}
      <g transform="rotate({phi} {tipX} {tipY})">
        <line x1={tipX} y1={tipY + len} x2={tipX} y2={tipY + 9} class="shaft" />
        <path d="M{tipX} {tipY} l-7 11 l14 0 z" class="head" />
      </g>
    {/if}
    <circle cx={tipX} cy={tipY} r="8" class="grip" />
  </svg>
  <p class="reading"><b>{word}</b>{toward ? `, ${toward}` : ''}</p>
</div>

<style>
  .compass {
    margin: 0.1rem 0 0.9rem;
  }

  svg {
    display: block;
    width: 100%;
    max-width: 13.5rem;
    margin: 0 auto;
    overflow: visible;
    cursor: grab;
    touch-action: none;
    outline: none;
  }

  svg.dragging {
    cursor: grabbing;
  }

  svg:focus-visible {
    filter: drop-shadow(0 0 4px var(--accent));
  }

  .rim {
    fill: rgba(169, 196, 216, 0.34);
    stroke: none;
  }

  .streak {
    stroke: rgba(51, 86, 110, 0.42);
    stroke-width: 1.4;
    stroke-linecap: round;
    animation: blow linear infinite;
  }

  .streak.still {
    animation: none;
    opacity: 0;
  }

  /* Upward in the rotated frame, which is the direction the wind blows. */
  @keyframes blow {
    from {
      transform: translateY(70px);
      opacity: 0;
    }
    30% {
      opacity: 1;
    }
    70% {
      opacity: 1;
    }
    to {
      transform: translateY(-70px);
      opacity: 0;
    }
  }

  .shaft {
    stroke: var(--tone-ink);
    stroke-width: 3;
    stroke-linecap: round;
  }

  .head {
    fill: var(--tone-ink);
  }

  .grip {
    fill: rgba(255, 248, 239, 0.001);
    stroke: rgba(51, 86, 110, 0);
    stroke-width: 2;
    transition: stroke 0.15s;
  }

  svg:hover .grip,
  svg.dragging .grip {
    stroke: rgba(51, 86, 110, 0.7);
  }

  .reading {
    margin-top: 0.7rem;
    text-align: center;
    font-family: var(--serif);
    font-style: italic;
    font-size: 0.88rem;
    font-variation-settings: 'SOFT' 100;
    color: var(--ink-dim);
  }

  .reading b {
    font-style: normal;
    color: var(--ink);
    font-weight: 560;
  }
</style>
