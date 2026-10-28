/**
 * The outline of a card: a sheet cut by hand, but cut carefully.
 *
 * A rounded rectangle, drawn at the card's real size in pixels (not stretched
 * from a unit box, which squeezed some corners to points), whose four corners
 * are each rounded a little differently and whose sides bow very slightly,
 * a pixel or two, as a sheet cut by hand along a ruler does. It never comes
 * in more than a couple of pixels from the card's edge, so nothing the card
 * holds can end up outside it.
 */
export function paperPath(w: number, h: number, seed: number): string {
  const rnd = (i: number) => {
    const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  const m = 2.5; // inset, so an outward bow stays within the box
  const x0 = m;
  const y0 = m;
  const x1 = w - m;
  const y1 = h - m;
  const maxR = Math.max(4, Math.min(w, h) / 2 - m - 2);
  // Top-left, top-right, bottom-right, bottom-left.
  const r = [0, 1, 2, 3].map((i) => Math.min(maxR, 18 + 10 * rnd(i)));
  // How far a corner's curve reaches along each side: a hand never quite matches.
  const k = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => 0.52 + 0.1 * rnd(10 + i));
  // A side's bow at a third and two-thirds along, outward positive: −0.6 to 1.8 px.
  const b = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => -0.6 + 2.4 * rnd(20 + i));

  const f = (v: number) => v.toFixed(1);
  const p: string[] = [];
  // Top side, left to right.
  p.push(`M${f(x0 + r[0])} ${f(y0)}`);
  p.push(`C${f(x0 + r[0] + (x1 - r[1] - x0 - r[0]) / 3)} ${f(y0 - b[0])} ${f(x1 - r[1] - (x1 - r[1] - x0 - r[0]) / 3)} ${f(y0 - b[1])} ${f(x1 - r[1])} ${f(y0)}`);
  // Top-right corner.
  p.push(`C${f(x1 - r[1] + k[0] * r[1])} ${f(y0)} ${f(x1)} ${f(y0 + r[1] - k[1] * r[1])} ${f(x1)} ${f(y0 + r[1])}`);
  // Right side, top to bottom.
  p.push(`C${f(x1 + b[2])} ${f(y0 + r[1] + (y1 - r[2] - y0 - r[1]) / 3)} ${f(x1 + b[3])} ${f(y1 - r[2] - (y1 - r[2] - y0 - r[1]) / 3)} ${f(x1)} ${f(y1 - r[2])}`);
  // Bottom-right corner.
  p.push(`C${f(x1)} ${f(y1 - r[2] + k[2] * r[2])} ${f(x1 - r[2] + k[3] * r[2])} ${f(y1)} ${f(x1 - r[2])} ${f(y1)}`);
  // Bottom side, right to left.
  p.push(`C${f(x1 - r[2] - (x1 - r[2] - x0 - r[3]) / 3)} ${f(y1 + b[4])} ${f(x0 + r[3] + (x1 - r[2] - x0 - r[3]) / 3)} ${f(y1 + b[5])} ${f(x0 + r[3])} ${f(y1)}`);
  // Bottom-left corner.
  p.push(`C${f(x0 + r[3] - k[4] * r[3])} ${f(y1)} ${f(x0)} ${f(y1 - r[3] + k[5] * r[3])} ${f(x0)} ${f(y1 - r[3])}`);
  // Left side, bottom to top.
  p.push(`C${f(x0 - b[6])} ${f(y1 - r[3] - (y1 - r[3] - y0 - r[0]) / 3)} ${f(x0 - b[7])} ${f(y0 + r[0] + (y1 - r[3] - y0 - r[0]) / 3)} ${f(x0)} ${f(y0 + r[0])}`);
  // Top-left corner.
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
