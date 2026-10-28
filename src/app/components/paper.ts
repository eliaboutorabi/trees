/**
 * The outline of a sheet cut by hand, for the cards.
 *
 * A rounded rectangle is what every settings panel is. This is a superellipse
 * — mostly straight sides, rounded corners — whose corners are each rounded a
 * little differently and whose edges wander in and out by a percent or two,
 * on a few slow ripples, then smoothed (Catmull–Rom, as cubic Béziers). It is
 * drawn in a 100 × 100 box and stretched to whatever size the card is, which
 * only makes the corners more uneven, as a torn or scissored sheet's are.
 */
export function paperPath(seed: number, n = 64): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    // How square each corner is, varying round the sheet: some soft, some tight.
    // (Never so round that a corner eats into what the card holds.)
    const square = 7.6 + 1.8 * Math.sin(2 * t + seed * 1.3) + 0.8 * Math.sin(3 * t + seed * 0.7);
    const e = 2 / square;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = Math.sign(c) * Math.pow(Math.abs(c), e);
    const y = Math.sign(s) * Math.pow(Math.abs(s), e);
    // The edge wandering in and out.
    const k = 1 + 0.011 * Math.sin(3 * t + seed) + 0.007 * Math.sin(5 * t + seed * 1.7) + 0.004 * Math.sin(9 * t + seed * 2.9);
    pts.push([50 + x * 48.6 * k, 50 + y * 48.6 * k]);
  }
  const f = (v: number) => v.toFixed(2);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    d += ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + 'Z';
}

/** The same outline as a CSS image, filled — for a mask, or a shadow. */
export function paperImage(path: string, fill = 'black'): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'><path d='${path}' fill='${fill}'/></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

/** A stable number from a name, so each card keeps its own cut. */
export function seedOf(name: string): number {
  let h = 7;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 9973;
  return (h / 9973) * 20;
}
