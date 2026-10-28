/**
 * The outline of a card: a sheet cut by hand, but cut carefully.
 *
 * A rounded rectangle, drawn at the card's real size in pixels (not stretched
 * from a unit box, which squeezed some corners to points), whose four corners
 * are each rounded differently — some soft, some tight, a little lopsided —
 * and whose sides have a slow, uneven wave, bulging out a few pixels and only
 * ever dipping in by one. It never comes in more than a few pixels from the
 * card's edge, so nothing the card holds can end up outside it.
 */
export interface CutOptions {
  /** How far in from the box the outline sits, so outward bulges stay inside it. */
  inset?: number;
  /** The range of corner radii, in pixels. */
  radius?: [number, number];
  /** How far a side may dip in and bulge out, in pixels. */
  bulge?: [number, number];
}

export function paperPath(w: number, h: number, seed: number, opts: CutOptions = {}): string {
  const { inset = 5, radius = [16, 38], bulge: [bIn, bOut] = [-1.2, 4.2] } = opts;
  const rnd = (i: number) => {
    const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  // Inset far enough that a side bulging outward stays inside the box.
  const m = inset;
  const x0 = m;
  const y0 = m;
  const x1 = w - m;
  const y1 = h - m;
  const maxR = Math.max(4, Math.min(w, h) / 2 - m - 2);
  // Top-left, top-right, bottom-right, bottom-left: visibly not the same.
  const r = [0, 1, 2, 3].map((i) => Math.min(maxR, radius[0] + (radius[1] - radius[0]) * rnd(i)));
  // How far each corner's curve reaches along either side — lopsided.
  const k = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => 0.42 + 0.3 * rnd(10 + i));
  // Outward bulges, in pixels: mostly out (up to ~4), only ever a touch in.
  const bulge = (i: number) => bIn + (bOut - bIn) * rnd(20 + i);
  const f = (v: number) => v.toFixed(1);

  /*
   * One side, from a to b, as two curves meeting a little off the middle, so
   * it has a slow, uneven wave rather than one even bow. `n` is the outward
   * normal.
   */
  const side = (ax: number, ay: number, bx: number, by: number, nx: number, ny: number, i: number) => {
    const t = 0.38 + 0.24 * rnd(40 + i);
    const mx = ax + (bx - ax) * t + nx * bulge(i * 5);
    const my = ay + (by - ay) * t + ny * bulge(i * 5);
    const c = (px: number, py: number, qx: number, qy: number, j: number) => {
      const u1 = bulge(i * 5 + j);
      const u2 = bulge(i * 5 + j + 1);
      return `C${f(px + (qx - px) / 3 + nx * u1)} ${f(py + (qy - py) / 3 + ny * u1)} ${f(px + ((qx - px) * 2) / 3 + nx * u2)} ${f(py + ((qy - py) * 2) / 3 + ny * u2)} ${f(qx)} ${f(qy)}`;
    };
    return `${c(ax, ay, mx, my, 1)} ${c(mx, my, bx, by, 3)}`;
  };

  const p: string[] = [];
  p.push(`M${f(x0 + r[0])} ${f(y0)}`);
  p.push(side(x0 + r[0], y0, x1 - r[1], y0, 0, -1, 0));
  p.push(`C${f(x1 - r[1] + k[0] * r[1])} ${f(y0)} ${f(x1)} ${f(y0 + r[1] - k[1] * r[1])} ${f(x1)} ${f(y0 + r[1])}`);
  p.push(side(x1, y0 + r[1], x1, y1 - r[2], 1, 0, 1));
  p.push(`C${f(x1)} ${f(y1 - r[2] + k[2] * r[2])} ${f(x1 - r[2] + k[3] * r[2])} ${f(y1)} ${f(x1 - r[2])} ${f(y1)}`);
  p.push(side(x1 - r[2], y1, x0 + r[3], y1, 0, 1, 2));
  p.push(`C${f(x0 + r[3] - k[4] * r[3])} ${f(y1)} ${f(x0)} ${f(y1 - r[3] + k[5] * r[3])} ${f(x0)} ${f(y1 - r[3])}`);
  p.push(side(x0, y1 - r[3], x0, y0 + r[0], -1, 0, 3));
  p.push(`C${f(x0)} ${f(y0 + r[0] - k[6] * r[0])} ${f(x0 + r[0] - k[7] * r[0])} ${f(y0)} ${f(x0 + r[0])} ${f(y0)}Z`);
  return p.join(' ');
}

/** The same outline as a CSS image of the given size, filled — for a mask, or a shadow. */
export function paperImage(path: string, w: number, h: number, fill = 'black'): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}' preserveAspectRatio='none'><path d='${path}' fill='${fill}'/></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

/** A stable number from a name, so each card keeps its own cut. */
export function seedOf(name: string): number {
  let h = 7;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 9973;
  return (h / 9973) * 20;
}

/**
 * Cut an element to a hand-cut outline of its own, at whatever size it is —
 * a Svelte action, for the tiles, buttons and panels inside the cards. The
 * outline is a mask, redrawn when the element changes size; a string seed
 * keeps the same element the same shape every time it appears.
 */
export function cut(node: HTMLElement, opts: CutOptions & { seed?: string | number } = {}) {
  const seed = typeof opts.seed === 'string' ? seedOf(opts.seed) : (opts.seed ?? seedOf(node.className));
  let size = '';
  const apply = () => {
    const w = Math.round(node.offsetWidth);
    const h = Math.round(node.offsetHeight);
    if (w < 8 || h < 8 || `${w}x${h}` === size) return;
    size = `${w}x${h}`;
    const mask = `${paperImage(paperPath(w, h, seed, opts), w, h)} 0 0 / 100% 100% no-repeat`;
    node.style.setProperty('mask', mask);
    node.style.setProperty('-webkit-mask', mask);
  };
  const observer = new ResizeObserver(apply);
  observer.observe(node);
  apply();
  return {
    destroy() {
      observer.disconnect();
    },
  };
}
