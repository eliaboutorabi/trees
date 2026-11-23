<script lang="ts">
  /**
   * Notes drawn over the tree in the L-system view, the way a figure in a
   * paper is annotated: the picked branch called out with the symbols that
   * drew it, its first few segments marked F, the angle it leaves its parent
   * at, and in the corner which way the world's axes run and what the
   * colours of depth mean. Recomputed every frame, so it stays on the tree
   * as the camera moves.
   */
  import type { BranchDetail, SkeletonData } from '../../engine';
  import Word from './Word.svelte';

  interface Props {
    skeleton: SkeletonData | null;
    picked: number;
    detail: BranchDetail | null;
    night: boolean;
    /** Where the free part of the screen starts, past the panel. */
    left: number;
    colours: string[];
    project: (x: number, y: number, z: number) => { x: number; y: number; visible: boolean };
    axes: () => { x: [number, number, number]; y: [number, number, number]; z: [number, number, number] };
  }

  let { skeleton, picked, detail, night, left, colours, project, axes }: Props = $props();

  interface Frame {
    callout: { ax: number; ay: number; bx: number; by: number; side: 1 | -1 } | null;
    fs: { x: number; y: number }[];
    arc: { cx: number; cy: number; path: string; lx: number; ly: number; deg: number } | null;
    axes: { x: [number, number, number]; y: [number, number, number]; z: [number, number, number] };
  }
  let frame = $state<Frame | null>(null);

  const P = (sk: SkeletonData, i: number) => [sk.pos[i * 3], sk.pos[i * 3 + 1], sk.pos[i * 3 + 2]] as const;

  function compute(): Frame {
    const sk = skeleton;
    const ax = axes();
    if (!sk || picked < 1 || picked >= sk.count || sk.parent[picked] < 0) return { callout: null, fs: [], arc: null, axes: ax };
    const { parent, order } = sk;
    const p = parent[picked];
    const a = P(sk, p);
    const b = P(sk, picked);
    const mid = project((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    const root = project(0, 0, 0);
    // Outward from the trunk, unless the free part of the screen runs out first.
    const wide = 30 + 13 * Math.min(14, (detail?.group.length ?? 6) + 2);
    const room = { from: left + 12, to: window.innerWidth - 104 };
    let side: 1 | -1 = mid.x >= root.x ? 1 : -1;
    if (side > 0 && mid.x + 120 + wide > room.to) side = -1;
    else if (side < 0 && mid.x - 120 - wide < room.from) side = 1;
    const callout = mid.visible ? { ax: mid.x, ay: mid.y, bx: mid.x + side * 120, by: mid.y - 46, side } : null;

    // The branch's first segments, from where it leaves its parent, along its own axis.
    let start = picked;
    while (parent[start] >= 0 && order[parent[start]] === order[picked]) start = parent[start];
    const chain: number[] = [start];
    for (let k = 0, at = start; k < 3; k++) {
      let next = -1;
      for (let i = at + 1; i < sk.count && i < at + 4000; i++) {
        if (parent[i] === at && order[i] === order[start]) {
          next = i;
          break;
        }
      }
      if (next < 0) break;
      chain.push(next);
      at = next;
    }
    // Each marked beside its segment, not on it, and only where the segment is long enough on screen to carry a mark.
    const fs: { x: number; y: number }[] = [];
    for (const n of chain) {
      const q = parent[n];
      if (q < 0) continue;
      const u = project(...P(sk, q));
      const v = project(...P(sk, n));
      const len = Math.hypot(v.x - u.x, v.y - u.y);
      if (!u.visible || !v.visible || len < 26) continue;
      const nx = -(v.y - u.y) / len;
      const ny = (v.x - u.x) / len;
      fs.push({ x: (u.x + v.x) / 2 + nx * 13, y: (u.y + v.y) / 2 + ny * 13 });
    }

    // The angle at the fork: between the parent's last segment and the branch's first.
    let arc: Frame['arc'] = null;
    const fork = parent[start];
    if (fork >= 0 && parent[fork] >= 0) {
      const f = P(sk, fork);
      const g = P(sk, parent[fork]);
      const s0 = P(sk, start);
      const F = project(f[0], f[1], f[2]);
      const into = project(f[0] + (f[0] - g[0]), f[1] + (f[1] - g[1]), f[2] + (f[2] - g[2]));
      const out = project(s0[0], s0[1], s0[2]);
      // Only a fork big enough on screen to read an angle off.
      if (F.visible && Math.hypot(out.x - F.x, out.y - F.y) > 22) {
        const r = 30;
        const a0 = Math.atan2(into.y - F.y, into.x - F.x);
        const a1 = Math.atan2(out.y - F.y, out.x - F.x);
        let d = a1 - a0;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        const x0 = F.x + Math.cos(a0) * r;
        const y0 = F.y + Math.sin(a0) * r;
        const x1 = F.x + Math.cos(a0 + d) * r;
        const y1 = F.y + Math.sin(a0 + d) * r;
        const am = a0 + d / 2;
        const t = [s0[0] - f[0], s0[1] - f[1], s0[2] - f[2]];
        const w = [f[0] - g[0], f[1] - g[1], f[2] - g[2]];
        const cos = (t[0] * w[0] + t[1] * w[1] + t[2] * w[2]) / (Math.hypot(...t) * Math.hypot(...w) || 1);
        arc = {
          cx: F.x,
          cy: F.y,
          path: `M${F.x + Math.cos(a0) * (r + 10)} ${F.y + Math.sin(a0) * (r + 10)}L${F.x} ${F.y}L${F.x + Math.cos(a0 + d) * (r + 10)} ${F.y + Math.sin(a0 + d) * (r + 10)}M${x0} ${y0}A${r} ${r} 0 0 ${d > 0 ? 1 : 0} ${x1} ${y1}`,
          lx: F.x + Math.cos(am) * (r + 16),
          ly: F.y + Math.sin(am) * (r + 16),
          deg: (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI,
        };
      }
    }
    return { callout, fs, arc, axes: ax };
  }

  $effect(() => {
    let raf = 0;
    const loop = () => {
      frame = compute();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });

  /** The callout's text: the picked module and a few either side, or the whole group if it is short. */
  const short = $derived.by(() => {
    if (!detail) return null;
    const g = detail.group;
    if (g.length <= 12) return { items: g, at: detail.at };
    const from = Math.max(0, detail.at - 4);
    const to = Math.min(g.length, detail.at + 5);
    const items = [...(from > 0 ? [{ s: '…', p: [] }] : []), ...g.slice(from, to), ...(to < g.length ? [{ s: '…', p: [] }] : [])];
    return { items, at: detail.at - from + (from > 0 ? 1 : 0) };
  });

  const AX = 34;
</script>

<div class="overlay xray-theme" class:night aria-hidden="true">
  <svg class="lines">
    {#if frame?.callout && short}
      {@const c = frame.callout}
      <path class="leader" d="M{c.ax} {c.ay} C {c.ax + c.side * 50} {c.ay - 4}, {c.bx - c.side * 40} {c.by}, {c.bx} {c.by}" />
      <circle class="anchor" cx={c.ax} cy={c.ay} r="3.2" />
      <circle class="ring" cx={c.ax} cy={c.ay} r="11" />
    {/if}
    {#if frame?.arc}
      {@const a = frame.arc}
      <path class="angle" d={a.path} />
    {/if}
  </svg>

  {#if frame?.callout && short}
    {@const c = frame.callout}
    <div class="callout" class:left={c.side < 0} style="left: {c.bx}px; top: {c.by}px">
      <Word items={short.items} at={short.at} />
    </div>
  {/if}

  {#each frame?.fs ?? [] as f, i (i)}
    <span class="f" style="left: {f.x}px; top: {f.y}px"><i>F</i></span>
  {/each}

  {#if frame?.arc}
    {@const a = frame.arc}
    <span class="theta" style="left: {a.lx}px; top: {a.ly}px"><i>θ</i> {a.deg.toFixed(0)}°</span>
  {/if}

  <div class="corner" style="left: {left + 24}px">
    <div class="depth">
      <span class="title">Depth</span>
      <span class="swatches">
        {#each colours as c, i (i)}
          <span class="swatch"><span class="dot" style="background: {c}"></span>{i === 0 ? 'trunk' : i === colours.length - 1 ? 'tips' : ''}</span>
        {/each}
      </span>
    </div>
    {#if frame}
      {@const ax = frame.axes}
      <svg class="gizmo" viewBox="-46 -46 92 92">
        {#each [['x', ax.x], ['y', ax.y], ['z', ax.z]] as [name, v] (name)}
          {@const d = v as [number, number, number]}
          <line x1="0" y1="0" x2={d[0] * AX} y2={d[1] * AX} class="axis a-{name}" style="opacity: {0.55 + 0.45 * (d[2] < 0 ? 1 : 0.4)}" />
          <text x={d[0] * (AX + 9)} y={d[1] * (AX + 9) + 4} class="axis-label a-{name}">{name}</text>
        {/each}
        <circle r="2.2" class="origin" />
      </svg>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: absolute;
    inset: 0;
    z-index: 4;
    pointer-events: none;
    color: var(--x-ink);
  }
  .lines {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .leader {
    fill: none;
    stroke: var(--x-lit-line);
    stroke-width: 1.4;
  }
  .anchor {
    fill: var(--x-lit-line);
  }
  /* A ring round the picked point, breathing, so even a twig is found. */
  .ring {
    fill: none;
    stroke: var(--x-lit-line);
    stroke-width: 1.5;
    transform-box: fill-box;
    transform-origin: center;
    animation: breathe 1.8s ease-in-out infinite;
  }
  @keyframes breathe {
    0%,
    100% {
      opacity: 0.85;
      transform: scale(1);
    }
    50% {
      opacity: 0.35;
      transform: scale(1.35);
    }
  }
  .angle {
    fill: none;
    stroke: var(--x-lit-ink);
    stroke-width: 1.1;
    stroke-dasharray: 3 3;
    opacity: 0.8;
  }

  .callout {
    position: absolute;
    transform: translate(0, -50%);
    padding: 0.25rem 0.7rem 0.3rem;
    border-radius: 12px 10px 13px 9px;
    background: var(--x-glass);
    backdrop-filter: var(--frost);
    -webkit-backdrop-filter: var(--frost);
    box-shadow:
      var(--x-rim),
      0 0 0 1.5px var(--x-lit-line),
      0 8px 20px rgba(10, 8, 6, 0.18);
    white-space: nowrap;
    animation: pop 0.3s cubic-bezier(0.3, 1.5, 0.5, 1) both;
  }
  .callout.left {
    transform: translate(-100%, -50%);
  }
  @keyframes pop {
    from {
      opacity: 0;
      scale: 0.9;
    }
  }

  .f,
  .theta {
    position: absolute;
    transform: translate(-50%, -50%);
    font-family: var(--serif);
    font-size: 0.82rem;
    line-height: 1;
    padding: 0.18rem 0.38rem;
    border-radius: 8px 7px 9px 6px;
    background: var(--x-glass);
    box-shadow:
      var(--x-rim),
      0 0 0 1px var(--x-lit-line);
    color: var(--x-lit-ink);
    white-space: nowrap;
  }
  .f i {
    font-weight: 600;
  }
  .theta {
    background: transparent;
    box-shadow: none;
    font-size: 0.9rem;
  }

  .corner {
    position: absolute;
    bottom: 6.8rem;
    display: flex;
    align-items: flex-end;
    gap: 1.6rem;
    transition: left 0.4s cubic-bezier(0.3, 0.9, 0.3, 1);
  }
  .depth {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .title {
    font-family: var(--serif);
    font-size: 0.86rem;
    font-weight: 560;
    color: var(--x-dim);
  }
  .swatches {
    display: flex;
    gap: 0.55rem;
  }
  .swatch {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    min-width: 1.1rem;
    font-size: 0.68rem;
    color: var(--x-faint);
    font-family: var(--serif);
    font-style: italic;
  }
  .dot {
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 50%;
    box-shadow: 0 1px 3px rgba(10, 8, 6, 0.25);
  }

  .gizmo {
    width: 5.6rem;
    height: 5.6rem;
    overflow: visible;
  }
  .axis {
    stroke-width: 1.6;
    stroke-linecap: round;
  }
  .axis-label {
    font-family: var(--serif);
    font-style: italic;
    font-size: 12px;
    text-anchor: middle;
  }
  .a-x {
    stroke: #c0634a;
    fill: #c0634a;
  }
  .a-y {
    stroke: #6f9a52;
    fill: #6f9a52;
  }
  .a-z {
    stroke: #6f7fbf;
    fill: #6f7fbf;
  }
  .night .a-x {
    stroke: #f09a80;
    fill: #f09a80;
  }
  .night .a-y {
    stroke: #a6d681;
    fill: #a6d681;
  }
  .night .a-z {
    stroke: #a8b4f0;
    fill: #a8b4f0;
  }
  .origin {
    fill: var(--x-dim);
  }

  @media (max-width: 640px) {
    .corner {
      display: none;
    }
  }
</style>
