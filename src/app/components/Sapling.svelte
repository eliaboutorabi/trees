<script lang="ts" module>
  interface Branch {
    d: string;
    /** When it starts to draw in, in seconds. */
    at: number;
  }
  interface Leaf {
    x: number;
    y: number;
    r: number;
    at: number;
    c: string;
  }
  interface Blossom {
    x: number;
    y: number;
    at: number;
  }
  interface Shape {
    box: [number, number];
    ground: { cx: number; cy: number; rx: number; ry: number };
    trunk: number;
    limb: number;
    branches: Branch[];
    leaves: Leaf[];
    blossoms: Blossom[];
    blossom: number;
  }

  /*
   * Two saplings, drawn by hand. Each branch is drawn in after the one it
   * grows from, so it reads as growing rather than as being traced; then the
   * crown leafs out, and a few blossoms open last.
   */
  const SHAPES: Record<'round' | 'tall', Shape> = {
    // The welcome card's: a young tree with a round crown.
    round: {
      box: [120, 120],
      ground: { cx: 60, cy: 113, rx: 34, ry: 5 },
      trunk: 4.6,
      limb: 2.6,
      branches: [
        { d: 'M60 112 C60 100 59 90 60 78', at: 0.15 },
        { d: 'M60 92 C53 86 47 82 40 78', at: 0.55 },
        { d: 'M60 86 C67 80 73 77 81 73', at: 0.7 },
        { d: 'M60 78 C60 70 61 63 60 55', at: 0.8 },
        { d: 'M44 80 C40 74 38 69 37 64', at: 1.05 },
        { d: 'M76 75 C80 70 83 66 84 60', at: 1.15 },
        { d: 'M60 64 C54 60 50 56 47 51', at: 1.2 },
        { d: 'M60 60 C66 56 70 52 72 47', at: 1.3 },
      ],
      leaves: [
        { x: 37, y: 62, r: 7, at: 1.45, c: '#8fb34f' },
        { x: 40, y: 75, r: 5.5, at: 1.5, c: '#a6c25e' },
        { x: 84, y: 58, r: 7, at: 1.55, c: '#7fa645' },
        { x: 81, y: 71, r: 5.5, at: 1.6, c: '#9bbb55' },
        { x: 47, y: 49, r: 7.5, at: 1.65, c: '#86ad4a' },
        { x: 72, y: 45, r: 7.5, at: 1.7, c: '#93b752' },
        { x: 60, y: 52, r: 8.5, at: 1.75, c: '#7ba243' },
        { x: 53, y: 41, r: 6.5, at: 1.85, c: '#a2c25b' },
        { x: 66, y: 39, r: 6, at: 1.9, c: '#8db34e' },
      ],
      blossoms: [
        { x: 45, y: 58, at: 2.1 },
        { x: 77, y: 52, at: 2.2 },
        { x: 63, y: 44, at: 2.3 },
      ],
      blossom: 2.3,
    },
    // The app's mark: the same sapling grown taller and narrower, a clear
    // stem under a crown that climbs, to stand the height of two lines.
    tall: {
      box: [60, 120],
      ground: { cx: 30, cy: 115, rx: 17, ry: 3.6 },
      trunk: 6,
      limb: 3.6,
      branches: [
        { d: 'M30 116 C30 104 29 92 30 78', at: 0.15 },
        { d: 'M30 92 C25 88 21 84 17 78', at: 0.5 },
        { d: 'M30 86 C35 82 39 78 43 72', at: 0.62 },
        { d: 'M30 78 C30 68 31 58 30 46', at: 0.72 },
        { d: 'M19 80 C16 74 15 69 15 63', at: 0.95 },
        { d: 'M41 74 C44 69 46 64 46 58', at: 1.02 },
        { d: 'M30 64 C25 59 22 54 20 48', at: 1.08 },
        { d: 'M30 60 C35 55 38 50 40 44', at: 1.14 },
        { d: 'M30 50 C29 44 30 38 31 31', at: 1.2 },
      ],
      leaves: [
        { x: 15, y: 62, r: 7.5, at: 1.35, c: '#8fb34f' },
        { x: 18, y: 76, r: 6, at: 1.4, c: '#a6c25e' },
        { x: 46, y: 57, r: 7.5, at: 1.45, c: '#7fa645' },
        { x: 43, y: 71, r: 6, at: 1.5, c: '#9bbb55' },
        { x: 20, y: 47, r: 8, at: 1.55, c: '#86ad4a' },
        { x: 40, y: 43, r: 8, at: 1.6, c: '#93b752' },
        { x: 30, y: 52, r: 9, at: 1.65, c: '#7ba243' },
        { x: 24, y: 33, r: 7.5, at: 1.72, c: '#a2c25b' },
        { x: 37, y: 30, r: 7, at: 1.78, c: '#8db34e' },
        { x: 30, y: 20, r: 7, at: 1.85, c: '#9fc058' },
      ],
      blossoms: [
        { x: 17, y: 57, at: 2.0 },
        { x: 43, y: 50, at: 2.08 },
        { x: 32, y: 33, at: 2.16 },
      ],
      blossom: 3,
    },
  };
</script>

<script lang="ts">
  /**
   * The little tree that grows: trunk first, then branch by branch the way
   * the turtle grows one, then leaves and blossom. The welcome card's
   * picture, and, tall, the app's own mark.
   */
  interface Props {
    variant?: 'round' | 'tall';
    /** Draw it in, or simply show it grown. */
    grow?: boolean;
  }

  let { variant = 'round', grow = true }: Props = $props();

  const shape = $derived(SHAPES[variant]);
</script>

<svg class="sapling {variant}" class:grow viewBox="0 0 {shape.box[0]} {shape.box[1]}" aria-hidden="true">
  <ellipse class="ground" cx={shape.ground.cx} cy={shape.ground.cy} rx={shape.ground.rx} ry={shape.ground.ry} />
  {#each shape.branches as b, i (i)}
    <path d={b.d} pathLength="1" class="branch" style="--at: {b.at}s; stroke-width: {i === 0 ? shape.trunk : shape.limb}" />
  {/each}
  <g class="crown">
    {#each shape.leaves as l, i (i)}
      <circle cx={l.x} cy={l.y} r={l.r} fill={l.c} class="leaf" style="--at: {l.at}s; transform-origin: {l.x}px {l.y}px" />
    {/each}
    {#each shape.blossoms as f, i (i)}
      <circle cx={f.x} cy={f.y} r={shape.blossom} class="blossom" style="--at: {f.at}s; transform-origin: {f.x}px {f.y}px" />
    {/each}
  </g>
</svg>

<style>
  .sapling {
    display: block;
    overflow: visible;
  }

  .ground {
    fill: rgba(120, 140, 70, 0.22);
  }

  .branch {
    fill: none;
    stroke: #6e5136;
    stroke-linecap: round;
  }

  .leaf {
    opacity: 0.95;
  }

  .blossom {
    fill: #f4b8c8;
    stroke: #fff4f6;
    stroke-width: 0.8;
  }

  .grow .ground {
    animation: fade 0.6s ease-out 0.1s both;
  }

  .grow .branch {
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    animation: draw 0.55s cubic-bezier(0.4, 0, 0.3, 1) var(--at) forwards;
  }

  .grow .leaf {
    transform: scale(0);
    animation: pop 0.5s cubic-bezier(0.3, 1.6, 0.5, 1) var(--at) forwards;
  }

  .grow .blossom {
    transform: scale(0);
    animation: pop 0.45s cubic-bezier(0.3, 1.8, 0.5, 1) var(--at) forwards;
  }

  @keyframes draw {
    to {
      stroke-dashoffset: 0;
    }
  }

  @keyframes pop {
    to {
      transform: scale(1);
    }
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .grow .ground,
    .grow .branch,
    .grow .leaf,
    .grow .blossom {
      animation-duration: 0.01s;
      animation-delay: 0s;
    }
  }
</style>
