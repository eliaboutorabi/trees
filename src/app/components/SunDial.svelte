<script lang="ts">
  /**
   * The sky from above, with the sun in it to drag about.
   *
   * Two sliders — elevation and azimuth in degrees — asked you to imagine a
   * compass bearing; this asks you to put the sun where you want it. The rim is
   * the horizon and the middle is straight overhead, so dragging outward sets
   * the sun lower and the light warmer.
   *
   * It is drawn relative to the camera, not to north: the top of the disc is the
   * far side of the tree and the bottom is where you are standing, so "sun at
   * the top" means backlit and "sun at the bottom" means lit from behind you —
   * whichever way the camera has been turned. `bearing` is the camera's compass
   * bearing from the tree, in the same convention as the sun's azimuth.
   */
  interface Props {
    azimuth: number;
    elevation: number;
    bearing: number;
    min?: number;
    max?: number;
  }

  let { azimuth = $bindable(), elevation = $bindable(), bearing, min = -2, max = 70 }: Props = $props();

  const R = 92;
  const C = 100;
  const rad = Math.PI / 180;

  // Angle on the disc, clockwise from the top, from the sun's azimuth and the
  // camera's bearing: the far side of the tree (bearing + 180°) is at the top.
  const phi = $derived(bearing + 180 - azimuth);
  const r = $derived(Math.min(1.04, Math.max(0, (90 - elevation) / 90)) * R);
  const sunX = $derived(C + Math.sin(phi * rad) * r);
  const sunY = $derived(C - Math.cos(phi * rad) * r);

  // The sun's own colour, from deep orange on the horizon to white overhead.
  const sunColor = $derived(
    elevation < 4 ? '#ff8a3c' : elevation < 14 ? '#ffb45c' : elevation < 30 ? '#ffd889' : '#fff4d6',
  );

  const when = $derived(
    elevation < 1
      ? 'At the horizon'
      : elevation < 12
        ? 'Golden hour'
        : elevation < 30
          ? 'Late afternoon'
          : elevation < 50
            ? 'Afternoon'
            : 'Midday',
  );
  const where = $derived.by(() => {
    const p = ((phi % 360) + 360) % 360;
    if (p < 45 || p >= 315) return 'behind the tree';
    if (p < 135) return 'from the right';
    if (p < 225) return 'behind you';
    return 'from the left';
  });

  let svg: SVGSVGElement;
  let dragging = $state(false);

  function place(e: PointerEvent) {
    const box = svg.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * 200 - C;
    const y = ((e.clientY - box.top) / box.height) * 200 - C;
    const dist = Math.min(1.04, Math.hypot(x, y) / R);
    const p = Math.atan2(x, -y) / rad;
    elevation = Math.round(Math.min(max, Math.max(min, 90 - dist * 90)) * 2) / 2;
    azimuth = Math.round((((bearing + 180 - p) % 360) + 360) % 360);
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
    const step = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowUp') elevation = Math.min(max, elevation + step);
    else if (e.key === 'ArrowDown') elevation = Math.max(min, elevation - step);
    else if (e.key === 'ArrowLeft') azimuth = (azimuth + step + 360) % 360;
    else if (e.key === 'ArrowRight') azimuth = (azimuth - step + 360) % 360;
    else return;
    e.preventDefault();
  }
</script>

<div class="dial">
  <svg
    bind:this={svg}
    viewBox="0 0 200 200"
    class:dragging
    role="slider"
    tabindex="0"
    aria-label="Sun position"
    aria-valuetext="{when}, {where}"
    aria-valuenow={elevation}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onkeydown={key}
  >
    <defs>
      <radialGradient id="dial-sky" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="#3c6aa8" stop-opacity="0.55" />
        <stop offset="0.72" stop-color="#9fb6cf" stop-opacity="0.32" />
        <stop offset="1" stop-color="#f0a85c" stop-opacity="0.5" />
      </radialGradient>
      <radialGradient id="dial-glow">
        <stop offset="0" stop-color={sunColor} stop-opacity="0.9" />
        <stop offset="1" stop-color={sunColor} stop-opacity="0" />
      </radialGradient>
    </defs>

    <circle cx={C} cy={C} r={R} fill="url(#dial-sky)" stroke="rgba(255,255,255,0.18)" />
    <!-- 30° and 60° above the horizon -->
    <circle cx={C} cy={C} r={R * (60 / 90)} fill="none" stroke="rgba(255,255,255,0.08)" stroke-dasharray="2 4" />
    <circle cx={C} cy={C} r={R * (30 / 90)} fill="none" stroke="rgba(255,255,255,0.08)" stroke-dasharray="2 4" />

    <!-- the tree, from above, and you, at the bottom of the rim -->
    <circle cx={C} cy={C} r="9" fill="#5d7a33" stroke="#2f4419" stroke-width="1.5" />
    <circle cx={C - 3} cy={C - 3} r="3.5" fill="#86a83c" />
    <g transform="translate({C} {C + R + 2})">
      <circle r="7" fill="rgba(20,16,12,0.9)" stroke="rgba(255,255,255,0.35)" />
      <path d="M-3.5 -1.5 L3.5 -1.5 L3.5 3 L-3.5 3 Z M-1.2 -1.5 L-0.4 -3.2 L1.6 -3.2 L2.2 -1.5" fill="none" stroke="rgba(255,255,255,0.8)" stroke-width="1" />
    </g>
    <text x={C} y="15" text-anchor="middle" class="tag">behind the tree</text>

    <!-- the light falling across the tree -->
    <line x1={sunX} y1={sunY} x2={C} y2={C} stroke={sunColor} stroke-opacity="0.35" stroke-width="1.5" stroke-dasharray="3 3" />

    <circle cx={sunX} cy={sunY} r="22" fill="url(#dial-glow)" />
    <circle cx={sunX} cy={sunY} r="8.5" fill={sunColor} stroke="#fff" stroke-width="2" class="sun" />
  </svg>
  <p class="reading"><b>{when}</b>, {where}</p>
</div>

<style>
  .dial {
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

  .sun {
    filter: drop-shadow(0 0 6px rgba(255, 200, 120, 0.9));
    transition: r 0.15s;
  }

  svg:hover .sun,
  svg.dragging .sun {
    r: 10.5;
  }

  .tag {
    font-size: 8px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    fill: rgba(255, 255, 255, 0.4);
  }

  .reading {
    margin-top: 0.7rem;
    text-align: center;
    font-size: 0.72rem;
    color: var(--ink-dim);
  }

  .reading b {
    color: var(--ink);
    font-weight: 500;
  }
</style>
