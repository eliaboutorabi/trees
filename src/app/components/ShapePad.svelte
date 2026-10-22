<script lang="ts">
  /**
   * A pad with a little tree in it, and a handle to drag.
   *
   * Across is how far the branches spread — upright and narrow on the left,
   * wide open on the right; up is how far each branch reaches — compact at the
   * bottom, tall at the top. Those are the two numbers that change a tree's
   * silhouette the most, and here they are one gesture instead of two sliders.
   *
   * The tree drawn in the pad is a sketch, not the real one: a symmetric
   * branching built from the same angle, length, contraction and droop, so it
   * answers the drag immediately while the real tree rebuilds a moment later.
   */
  interface Props {
    angle: number;
    step: number;
    shrink: number;
    tropism: number;
    leaf: string;
    angleRange?: [number, number];
    stepRange?: [number, number];
  }

  let {
    angle = $bindable(),
    step = $bindable(),
    shrink,
    tropism,
    leaf,
    angleRange = [5, 90],
    stepRange = [0.15, 2],
  }: Props = $props();

  const W = 220;
  const H = 150;
  const PAD = 12;

  const nx = $derived((angle - angleRange[0]) / (angleRange[1] - angleRange[0]));
  const ny = $derived((step - stepRange[0]) / (stepRange[1] - stepRange[0]));
  const hx = $derived(PAD + nx * (W - PAD * 2));
  const hy = $derived(H - PAD - ny * (H - PAD * 2));

  /** The sketch: a recursive fork, bent by droop, as line segments and tip dots. */
  const sketch = $derived.by(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number; w: number }[] = [];
    const tips: [number, number][] = [];
    const half = (angle * Math.PI) / 360;
    // Sized so that even the tallest, least-contracting tree still fits: a
    // six-deep fork reaches about 4.6 trunk-lengths up at the contraction cap.
    const base = 8 + ny * 19;
    const depth = 6;
    const grow = (x: number, y: number, dir: number, len: number, d: number) => {
      // Droop and reach pull every branch toward straight down or straight up.
      const bent = dir === 0 ? 0 : dir - Math.sign(dir) * tropism * 0.6 * (d / depth);
      const x2 = x + Math.sin(bent) * len;
      const y2 = y - Math.cos(bent) * len;
      lines.push({ x1: x, y1: y, x2, y2, w: Math.max(0.6, (depth - d + 1) * 0.75) });
      if (d >= depth) {
        tips.push([x2, y2]);
        return;
      }
      const next = len * Math.min(0.9, shrink + 0.02);
      grow(x2, y2, bent - half, next, d + 1);
      grow(x2, y2, bent + half, next, d + 1);
    };
    grow(W / 2, H - 6, 0, base, 1);
    return { lines, tips };
  });

  const spread = $derived(nx < 0.25 ? 'Narrow' : nx < 0.6 ? 'Rounded' : 'Spreading');
  const reach = $derived(ny < 0.3 ? 'compact' : ny < 0.65 ? 'medium height' : 'tall');

  let svg: SVGSVGElement;
  let dragging = $state(false);

  function place(e: PointerEvent) {
    const box = svg.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W;
    const y = ((e.clientY - box.top) / box.height) * H;
    const fx = Math.min(1, Math.max(0, (x - PAD) / (W - PAD * 2)));
    const fy = Math.min(1, Math.max(0, (H - PAD - y) / (H - PAD * 2)));
    angle = Math.round((angleRange[0] + fx * (angleRange[1] - angleRange[0])) * 2) / 2;
    step = Math.round((stepRange[0] + fy * (stepRange[1] - stepRange[0])) * 100) / 100;
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
    if (e.key === 'ArrowLeft') angle = Math.max(angleRange[0], angle - 1);
    else if (e.key === 'ArrowRight') angle = Math.min(angleRange[1], angle + 1);
    else if (e.key === 'ArrowUp') step = Math.min(stepRange[1], +(step + 0.05).toFixed(2));
    else if (e.key === 'ArrowDown') step = Math.max(stepRange[0], +(step - 0.05).toFixed(2));
    else return;
    e.preventDefault();
  }
</script>

<div class="shape">
  <svg
    bind:this={svg}
    viewBox="0 0 {W} {H}"
    class:dragging
    role="slider"
    tabindex="0"
    aria-label="Spread and height"
    aria-valuetext="{spread}, {reach}"
    aria-valuenow={angle}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onkeydown={key}
  >
    <defs><clipPath id="shape-bed"><rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="12" /></clipPath></defs>
    <rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="12" class="bed" />
    <!-- the axes, as words at the edges -->
    <text x={PAD} y={H - 4} class="axis">narrow</text>
    <text x={W - PAD} y={H - 4} class="axis" text-anchor="end">spreading</text>
    <text x={PAD - 2} y={PAD + 4} class="axis">tall</text>

    <g class="tree" clip-path="url(#shape-bed)">
      {#each sketch.lines as l, i (i)}
        <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke-width={l.w} />
      {/each}
      {#each sketch.tips as [x, y], i (i)}
        <circle cx={x} cy={y} r="2.6" fill={leaf} />
      {/each}
    </g>

    <circle cx={hx} cy={hy} r="9" class="handle" />
  </svg>
  <p class="reading"><b>{spread}</b>, {reach}</p>
</div>

<style>
  .shape {
    margin: 0.1rem 0 0.9rem;
  }

  svg {
    display: block;
    width: 100%;
    cursor: crosshair;
    touch-action: none;
    outline: none;
  }

  svg:focus-visible .bed {
    stroke: var(--accent);
  }

  .bed {
    fill: #f1f8e6;
    stroke: #fff;
    stroke-width: 3;
  }

  .axis {
    font-size: 8px;
    font-weight: 800;
    fill: rgba(85, 107, 34, 0.55);
  }

  .tree line {
    stroke: #8a7158;
    stroke-linecap: round;
  }

  .handle {
    fill: #fff;
    stroke: var(--tone-ink);
    stroke-width: 3;
    filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.5));
    cursor: grab;
    transition: r 0.14s;
  }

  svg:hover .handle,
  svg.dragging .handle {
    r: 10.5;
  }

  .reading {
    margin-top: 0.55rem;
    text-align: center;
    font-size: 0.72rem;
    color: var(--ink-dim);
  }

  .reading b {
    color: var(--ink);
    font-weight: 500;
  }
</style>
