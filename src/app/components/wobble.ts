/**
 * A closed loop that is nearly, but not quite, a circle — the outline of a
 * thing cut out by hand. Two slow ripples of a few percent, joined smoothly
 * (Catmull–Rom, as cubic Béziers), so it reads as drawn rather than wobbly.
 */
export function wobble(cx: number, cy: number, r: number, seed = 1, amount = 0.02, n = 36): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const k = 1 + amount * Math.sin(2 * t + seed) + amount * 0.55 * Math.sin(3 * t + seed * 2.3);
    pts.push([cx + Math.sin(t) * r * k, cy - Math.cos(t) * r * k]);
  }
  const f = (v: number) => v.toFixed(2);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + 'Z';
}
