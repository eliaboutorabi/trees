/**
 * Hand-drawn icons.
 *
 * Generic line icons are ruled: perfect circles, equal strokes, mirror
 * symmetry — the look of a settings app. These are drawn the way you would ink
 * them in a field notebook: curves a little uneven, nothing quite mirrored, and
 * each one a loose line over a soft wash of its own colour.
 *
 * Every glyph is a list of strokes on a 24×24 grid. `wash` parts are filled at
 * low opacity under the line work, `ink` parts are lines, `dot` parts are solid.
 *
 * A part can name what it is made of (`c`: leaf, sun, water…). Where the page
 * provides a colour for that — the `.illustrated` class does — the wash is
 * coloured in with it; elsewhere it falls back to the plain wash, so the same
 * glyph works as a one-colour mark on a tinted button and as a small coloured
 * picture on a card. `o` scales a part's opacity, and `w` its line weight (for
 * parts drawn scaled down, so their lines stay as heavy as the rest).
 *
 * A part can also move (`m`), round and round: rain streaks and drops falling
 * out of their cloud, snow drifting down with a sway. `md` is where in the
 * cycle it starts, 0–1, so a cloud's drops do not all fall in step. Moving
 * parts are listed *before* their cloud, so they come out from behind it.
 */
export type Hue = 'leaf' | 'sun' | 'water' | 'sky' | 'storm' | 'snow' | 'bark' | 'petal' | 'fruit' | 'earth' | 'mist';
export type Motion = 'streak' | 'drop' | 'snow' | 'flake' | 'beat' | 'flutter';
export type Part = { d: string; k: 'wash' | 'ink' | 'both' | 'dot'; t?: string; c?: Hue; o?: number; w?: number; m?: Motion; md?: number };

/** The same part, moving, from `at` (0–1) into its cycle. */
const moving = (part: Part, m: Motion, at: number): Part => ({ ...part, m, md: at });

/** Place a part drawn about the grid's middle at (x, y), `s` times the size. */
const placed = (part: Part, x: number, y: number, s: number): Part => ({
  ...part,
  t: `translate(${x} ${y}) scale(${s}) translate(-12 -12)`,
  // Lines keep (nearly) their weight however small the drawing.
  w: (part.w ?? 1) * Math.min(1.7, 1 / s),
});

/**
 * A dove on the wing, side on, flying right: pale grey, its wing raised —
 * and, if `alive`, beating — over a fanned tail. Centred on (x, y).
 */
function dove(x: number, y: number, s: number, alive = false, at = 0): Part[] {
  // Raised, with a curved leading edge and the trailing edge in three feathers.
  const wing: Part = {
    d: 'M10.3 13.3C9.5 10.3 9.9 7.3 11.6 4.8 12.6 6.2 13.2 7.4 13.6 8.3 13.4 8.9 14.4 9.4 14.5 10.3 14.1 10.8 15 11.5 15 13.1Z',
    k: 'both',
    c: 'snow',
  };
  return [
    placed({ d: 'M6.2 13.9L2.7 12.3C2.7 13.7 3 14.9 3.7 15.9L7 14.9Z', k: 'both', c: 'mist' }, x, y, s),
    placed(
      {
        d: 'M5.2 13.4C7.5 12.4 10.5 12.3 13.3 12.9 14.5 11.4 16.1 10.5 17.8 10.7 19.2 10.9 19.9 11.7 20 12.4L21.4 12.9 20 13.3C19.7 15.3 17.6 16.7 14.6 16.9 11.4 17.1 8.1 16 5.2 13.4Z',
        k: 'both',
        c: 'mist',
      },
      x,
      y,
      s,
    ),
    alive ? moving(placed(wing, x, y, s), 'beat', at) : placed(wing, x, y, s),
    placed({ d: ring(18.3, 12.1, 0.55), k: 'dot' }, x, y, s),
  ];
}

/**
 * A butterfly from above, wings open: orange fore, redder hind, a dark body
 * and two clubbed antennae. If `alive`, the wings open and close.
 */
function butterfly(x: number, y: number, s: number, alive = false, at = 0): Part[] {
  const fore: Part = {
    d: 'M11.6 11.6C9.6 7.4 6.4 5.4 4.4 6.4 3.2 7.2 3.6 9.8 5.6 11.2 7.2 12.2 9.6 12.4 11.6 12.2ZM12.4 11.6C14.4 7.4 17.6 5.4 19.6 6.4 20.8 7.2 20.4 9.8 18.4 11.2 16.8 12.2 14.4 12.4 12.4 12.2Z',
    k: 'both',
    c: 'sun',
  };
  const hind: Part = {
    d: 'M11.6 12.8C9.4 12.8 7 13.6 6.4 15.6 5.9 17.4 7.4 18.8 9 18.2 10.6 17.6 11.4 15.2 11.8 13.6ZM12.4 12.8C14.6 12.8 17 13.6 17.6 15.6 18.1 17.4 16.6 18.8 15 18.2 13.4 17.6 12.6 15.2 12.2 13.6Z',
    k: 'both',
    c: 'fruit',
    o: 0.75,
  };
  const wings = [fore, hind].map((w) => placed(w, x, y, s));
  return [
    ...(alive ? wings.map((w) => moving(w, 'flutter', at)) : wings),
    placed({ d: 'M12 9.8v8.4', k: 'ink', w: 1.15 }, x, y, s),
    placed({ d: 'M11.8 9.9c-.4-1.4-1.1-2.5-2-3.2M12.2 9.9c.4-1.4 1.1-2.5 2-3.2', k: 'ink', w: 0.7 }, x, y, s),
    placed({ d: `${ring(9.7, 6.6, 0.5)}${ring(14.3, 6.6, 0.5)}`, k: 'dot' }, x, y, s),
  ];
}

/** A circle as a path, so it can sit in the same lists as everything else. */
const ring = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

/** Petals around a centre, each a touch different in length, as real ones are. */
function petals(cx: number, cy: number, lengths: number[], width: number): Part[] {
  return lengths.map((len, i) => {
    const a = (360 / lengths.length) * i + 8;
    const w = width;
    return {
      d: `M${cx} ${cy - 0.9}c${-w} ${-len * 0.3} ${-w * 0.8} ${-len * 0.9} 0 ${-len}c${w * 0.8} ${len * 0.1} ${w} ${len * 0.7} 0 ${len}z`,
      k: 'both' as const,
      t: `rotate(${a} ${cx} ${cy})`,
    };
  });
}

/** A raindrop hanging from its tip at (x, y). */
const drop = (x: number, y: number, s = 1): Part => ({
  d: `M${x} ${y}c${-1.1 * s} ${1.5 * s} ${-1.7 * s} ${2.4 * s} ${-1.7 * s} ${3.2 * s}a${1.7 * s} ${1.7 * s} 0 0 0 ${3.4 * s} 0c0 ${-0.8 * s} ${-0.6 * s} ${-1.7 * s} ${-1.7 * s} ${-3.2 * s}z`,
  k: 'both',
  c: 'water',
});

/** A six-armed snowflake. */
const flake = (x: number, y: number, r: number): Part => ({
  d: `M${x} ${y - r}v${2 * r}M${x - 0.87 * r} ${y - 0.5 * r}l${1.73 * r} ${r}M${x - 0.87 * r} ${y + 0.5 * r}l${1.73 * r} ${-r}`,
  k: 'ink',
});

/** A leaf of length `len` from its stalk at (x, y), pointing along `angle` degrees. */
const leafAt = (x: number, y: number, angle: number, len: number, c: Hue = 'leaf'): Part => ({
  d: `M0 0c${len * 0.25} ${-len * 0.36} ${len * 0.72} ${-len * 0.42} ${len} 0c${-len * 0.28} ${len * 0.36} ${-len * 0.75} ${len * 0.4} ${-len} 0z`,
  k: 'both',
  t: `translate(${x} ${y}) rotate(${angle})`,
  c,
});

/** A cherry on its stalk, the stalk running up to (sx, sy). */
const cherry = (x: number, y: number, r: number, sx: number, sy: number): Part[] => [
  { d: `M${x} ${y - r + 0.2}c${(sx - x) * 0.1} ${(sy - y) * 0.45} ${(sx - x) * 0.5} ${(sy - y) * 0.8} ${sx - x} ${sy - y + r - 0.2}`, k: 'ink' },
  { d: ring(x, y, r), k: 'both', c: 'fruit' },
  { d: `M${x - r * 0.45} ${y - r * 0.2}c.2-.5.6-.9 1.1-1.1`, k: 'ink', o: 0.6, w: 0.7 },
];

const SUN_RAYS_LONG =
  'M12 1.7v3M12.1 19.3v3M1.7 12.1h3M19.3 11.9h3M4.6 4.5l2.1 2.1M17.3 17.4l2.1 2.1M19.5 4.6l-2.1 2.1M6.7 17.3l-2.1 2.1';

const CLOUD =
  'M6.8 18.6h9.9c2.1 0 3.6-1.5 3.6-3.4 0-1.8-1.4-3.2-3.2-3.3-.5-2.3-2.4-3.9-4.8-3.9-2.1 0-3.8 1.3-4.5 3.2-2 .2-3.5 1.8-3.5 3.8 0 2 1.6 3.6 3.6 3.6z';
const CLOUD_HIGH =
  'M6.9 14.6h9.8c2 0 3.5-1.5 3.5-3.3 0-1.8-1.4-3.2-3.2-3.3-.5-2.2-2.4-3.8-4.7-3.8-2.1 0-3.8 1.3-4.5 3.1-2 .2-3.5 1.8-3.5 3.7 0 2 1.6 3.6 3.6 3.6z';

export const GLYPHS = {
  // A small grove: a round tree and a young conifer on a line of ground.
  grove: [
    {
      d: 'M8.7 3.7c2.5-.1 4.3 1.8 4.2 4.2 1.3.6 1.9 2 1.5 3.4-.5 1.5-2 2.3-3.6 2-1 .8-2.6.9-3.7.1-1.5.3-3-.6-3.3-2.1-.2-1.3.5-2.6 1.7-3.1-.1-2.4 1.2-4.3 3.2-4.5z',
      k: 'both',
    },
    { d: 'M8.6 12.9c.1 2.4 0 4.6-.2 6.9M8.7 15.7l1.7-1.4', k: 'ink' },
    { d: 'M17.5 8.4l-2.8 4.7h1.5l-2.2 3.8h7l-2.2-3.8h1.5z', k: 'both' },
    { d: 'M17.5 16.9c.1 1 0 2 0 2.9', k: 'ink' },
    { d: 'M3.1 20.2c3.3-.6 6.5-.5 9.1 0 2.9.5 5.6.4 8.7-.3', k: 'ink' },
  ],

  // Seasons.
  'season-spring': [
    ...petals(12, 12, [5.6, 6.2, 5.4, 6, 5.8], 2.5),
    { d: ring(12, 12, 1.5), k: 'dot' },
  ],
  'season-summer': [
    { d: 'M12 7.5c2.6-.1 4.6 2 4.5 4.6-.1 2.4-2.1 4.4-4.6 4.4-2.5-.1-4.4-2.1-4.4-4.6.1-2.4 2-4.3 4.5-4.4z', k: 'both' },
    {
      d: 'M12 2.7v2.1M12.1 19.3v2.2M2.8 12.1h2.1M19.2 11.9h2.1M5.4 5.2l1.5 1.4M17.1 17.2l1.6 1.5M18.6 5.4l-1.5 1.5M6.8 17.4l-1.5 1.4',
      k: 'ink',
    },
  ],
  // An acorn: unmistakably autumn, and kinder than a spiky leaf.
  'season-autumn': [
    { d: 'M7.9 11.7c0 4 1.8 7.4 4.1 8.6 2.4-1.1 4.2-4.6 4.2-8.6z', k: 'both' },
    { d: 'M6.3 11.8c-.2-2.9 2.5-5 5.7-5 3.3 0 5.9 2.2 5.7 5z', k: 'both' },
    { d: 'M8.6 9.4l1 1.4M11.3 8.4l.8 1.6M14.1 8.6l.6 1.6', k: 'ink' },
    { d: 'M12 6.8c.1-1.5.7-2.7 1.8-3.6', k: 'ink' },
  ],
  'season-winter': [
    {
      d: 'M12 3.4v17.2M4.5 7.7l15 8.6M4.6 16.3l14.9-8.6',
      k: 'ink',
    },
    { d: 'M9.9 5.1L12 6.9l2.1-1.8M9.9 18.9l2.1-1.8 2.1 1.8', k: 'ink' },
    { d: 'M9.9 5.1L12 6.9l2.1-1.8M9.9 18.9l2.1-1.8 2.1 1.8', k: 'ink', t: 'rotate(60 12 12)' },
    { d: 'M9.9 5.1L12 6.9l2.1-1.8M9.9 18.9l2.1-1.8 2.1 1.8', k: 'ink', t: 'rotate(120 12 12)' },
    { d: ring(12, 12, 1.2), k: 'dot' },
  ],

  // Weather.
  'weather-clear': [
    { d: ring(8.9, 9.2, 3.9), k: 'wash', c: 'sun' },
    { d: 'M9 5.2c2-.1 3.6 1.4 3.7 3.3', k: 'ink' },
    { d: 'M5.1 9.3c-.2-2 1.2-3.8 3.4-4.1', k: 'ink' },
    { d: 'M8.6 2.6v1.3M3.2 8.6h1.3M4.6 4.5l.9.9M12.7 4.6l-.9.9', k: 'ink' },
    { d: CLOUD, k: 'both', c: 'sky' },
  ],
  'weather-rain': [
    moving({ d: 'M8.3 17.3l-.9 2.6', k: 'ink' }, 'streak', 0),
    moving({ d: 'M12.3 17.4l-.9 2.8', k: 'ink' }, 'streak', 0.42),
    moving({ d: 'M16.2 17.3l-.8 2.5', k: 'ink' }, 'streak', 0.74),
    { d: CLOUD_HIGH, k: 'both', c: 'storm' },
  ],
  'weather-snow': [
    moving({ d: ring(8, 18.6, 0.9), k: 'dot' }, 'snow', 0),
    moving({ d: ring(12.2, 20.2, 0.9), k: 'dot' }, 'snow', 0.38),
    moving({ d: ring(16.3, 18.4, 0.9), k: 'dot' }, 'snow', 0.7),
    { d: CLOUD_HIGH, k: 'both', c: 'sky' },
  ],

  // A forking twig, with buds.
  twig: [
    { d: 'M12 21.2c-.1-2.6.1-5 0-7.6', k: 'ink' },
    { d: 'M12 13.7c-.1-2.6-1.7-4.4-4.3-5.6M12.1 15.7c.3-2.4 2-4.1 4.7-5', k: 'ink' },
    { d: 'M7.8 8.2c-.7-1.7-.5-3.1.4-4.5M7.7 8.1c-1.6-.4-2.9 0-4.1 1.1M16.8 10.7c.4-1.8 1.4-3 3-3.7', k: 'ink' },
    { d: ring(8.4, 3.4, 1.1), k: 'dot' },
    { d: ring(3.3, 9.5, 1.1), k: 'dot' },
    { d: ring(20.1, 6.8, 1.1), k: 'dot' },
  ],

  // A leaf with its veins.
  leaf: [
    { d: 'M5 19.1c-.7-7.5 4.6-14 14.7-14.7.4 8.7-5.6 14.5-14.7 14.7z', k: 'both' },
    { d: 'M5 19.1c3.9-4.4 7.2-7.9 11.1-11.5', k: 'ink' },
    { d: 'M9.2 14.6l-.5-3.2M9.2 14.6l3.4.3M12.5 11.4l-.3-3M12.5 11.4l3.1.1', k: 'ink' },
  ],

  // Blossom, and berries on a stalk.
  bloom: [
    ...petals(8.6, 8.6, [3.6, 4, 3.5, 3.9, 3.7], 1.8),
    { d: ring(8.6, 8.6, 1.05), k: 'dot' },
    { d: ring(15.6, 17.2, 2.5), k: 'both' },
    { d: ring(19.2, 14.6, 2), k: 'both' },
    { d: 'M15.6 14.7c.3-1.8 1.2-3.1 2.6-3.9M19.2 12.6c-.1-1-.1-1.7.5-2.4', k: 'ink' },
  ],

  // The sun going down behind a line of land.
  sunset: [
    { d: 'M7.3 16.8c-.1-2.6 2-4.8 4.7-4.8 2.6 0 4.8 2.1 4.7 4.8z', k: 'both' },
    { d: 'M2.8 17c3.3-.4 5.6-.2 8.3 0 2.8.2 5.6.2 10.1-.3', k: 'ink' },
    { d: 'M12 9.4V6.9M6.4 11.5L4.9 10M17.6 11.4l1.6-1.5M6.7 20.2h3.8M13.3 20.2h4.3', k: 'ink' },
  ],

  // Wind: three loose strokes, two curling back.
  wind: [
    { d: 'M3 9.3h10.7c1.7 0 2.9-1.2 2.9-2.7 0-1.4-1.1-2.5-2.5-2.5-1.1 0-2 .7-2.3 1.7', k: 'ink' },
    { d: 'M3.4 13.3h14.9c1.7 0 2.9 1.2 2.9 2.7 0 1.4-1.1 2.5-2.5 2.5-1.1 0-2-.7-2.3-1.7', k: 'ink' },
    { d: 'M3 17.4h7.4', k: 'ink' },
  ],

  // A small framed landscape, for the look of the picture.
  frame: [
    {
      d: 'M3.5 16.4c2.8-3.3 5.6-4.3 8.6-2.4 2.1-1.8 4.7-2.1 8.3.5v2.8c0 .9-.7 1.6-1.6 1.6H5.1c-.9 0-1.6-.7-1.6-1.6z',
      k: 'wash',
    },
    { d: 'M5.1 5.1h13.8c.9 0 1.6.7 1.6 1.6v10.6c0 .9-.7 1.6-1.6 1.6H5.1c-.9 0-1.6-.7-1.6-1.6V6.7c0-.9.7-1.6 1.6-1.6z', k: 'ink' },
    { d: 'M3.6 16.3c2.8-3.3 5.6-4.3 8.5-2.3 2.1-1.8 4.7-2.1 8.3.5', k: 'ink' },
    { d: ring(15.6, 9.3, 1.6), k: 'both' },
  ],

  // A quill, for writing the grammar.
  quill: [
    { d: 'M19.7 3.5c-5.7.4-10.1 4.3-11.7 9.9L6.8 17.6l4.1-1.2c5.4-1.6 9.2-6.6 8.8-12.9z', k: 'both' },
    { d: 'M8.5 15.8C11.1 12 14.6 8 19.7 3.5M6.8 17.6L4 20.5', k: 'ink' },
    { d: 'M8.1 13.3l3.3-.1M10.3 10.2l3.6-.3M12.9 7.3l3.5-.5', k: 'ink' },
  ],

  // An open book with a sprig on its page, for learning the grammar.
  learn: [
    { d: 'M12 6.4c-2.5-1.7-5.3-2.3-8.4-1.9v13c3.2-.3 6 .3 8.4 1.9z', k: 'both', c: 'sky' },
    { d: 'M12 6.4c2.4-1.7 5.2-2.3 8.4-1.9v13c-3.1-.3-5.9.3-8.4 1.9z', k: 'both', c: 'sky' },
    { d: 'M5.9 8.5c1.5 0 2.8.3 4 .9M5.9 11.3c1.4 0 2.7.3 3.9.8M5.9 14.1c1.3 0 2.5.2 3.6.7', k: 'ink', w: 0.75, o: 0.75 },
    { d: 'M16.4 15.6c-.1-1.9.1-3.6.6-5.2', k: 'ink', w: 0.85 },
    { d: 'M16.8 11.5c-1.2-.2-2-1-2.1-2.3 1.3 0 2.1.9 2.1 2.3zM17.1 10.4c.3-1.2 1.2-1.9 2.4-1.8-.2 1.2-1.1 1.9-2.4 1.8z', k: 'both', c: 'leaf', w: 0.85 },
  ],

  // Wildlife: the card's icon, its two portraits, and the ends of its sliders.
  wildlife: [...dove(9.2, 9.6, 0.64, true), ...butterfly(16.4, 16.6, 0.5, true, 0.3)],
  dove: dove(12, 12, 1, true),
  'dove-few': dove(12, 12.4, 0.66),
  'dove-many': [...dove(7, 8.2, 0.44), ...dove(17, 7, 0.44), ...dove(12.2, 16.6, 0.44)],
  'dove-small': dove(12.6, 13.4, 0.48),
  'dove-big': dove(12, 12, 1.04),
  butterfly: butterfly(12, 12, 1, true),
  'butterfly-few': butterfly(12, 12, 0.62),
  'butterfly-many': [
    ...butterfly(7, 7.2, 0.4),
    ...butterfly(17.2, 7.8, 0.4),
    ...butterfly(7.6, 16.8, 0.4),
    ...butterfly(16.8, 17, 0.4),
    ...butterfly(12.2, 12, 0.34),
  ],
  'butterfly-small': butterfly(12, 12.6, 0.46),
  'butterfly-big': butterfly(12, 12, 1.02),

  // Actions.
  reframe: [
    { d: 'M4 8.6V6.2C4 5 5 4 6.2 4h2.4M15.4 4h2.4C19 4 20 5 20 6.2v2.4M20 15.4v2.4c0 1.2-1 2.2-2.2 2.2h-2.4M8.6 20H6.2C5 20 4 19 4 17.8v-2.4', k: 'ink' },
    { d: ring(12, 12, 2.6), k: 'both' },
  ],
  save: [
    { d: 'M12 3.8c.1 3.5 0 6.9 0 10.4M8.2 10.6l3.8 3.8 3.8-3.8', k: 'ink' },
    { d: 'M4.4 15.4v2.2c0 1.3 1 2.3 2.3 2.3h10.6c1.3 0 2.3-1 2.3-2.3v-2.2', k: 'ink' },
  ],
  link: [
    { d: 'M9.9 13.8l-1.7 1.7a3.1 3.1 0 0 1-4.4-4.4l2.6-2.6a3.1 3.1 0 0 1 4.4 0', k: 'ink' },
    { d: 'M14.1 10.2l1.7-1.7a3.1 3.1 0 0 1 4.4 4.4l-2.6 2.6a3.1 3.1 0 0 1-4.4 0', k: 'ink' },
    { d: 'M9.5 14.5l5-5', k: 'ink' },
  ],
  // A crescent moon and two stars.
  moon: [
    { d: 'M14.6 3.6a8.6 8.6 0 1 0 5.9 14.5 7 7 0 1 1-5.9-14.5z', k: 'both', c: 'sun' },
    { d: 'M18.6 5.2l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z', k: 'dot' },
    { d: ring(20.6, 10.6, 0.7), k: 'dot' },
  ],

  // The aurora: three curtains of light hanging over a line of hills, and a star.
  aurora: [
    { d: 'M3.6 17.4c.5-3.6 2.3-6.4 1.7-11 1.9 3.1 2.8 7 2.3 11z', k: 'both', c: 'leaf' },
    { d: 'M9.7 17.4c.4-4.4 2.5-7.8 1.8-13 2.3 3.6 3.2 8.2 2.5 13z', k: 'both', c: 'leaf' },
    { d: 'M16.1 17.4c.5-3.8 2.4-6.6 2-11.4 2 3.2 2.7 7.2 2.2 11.4z', k: 'both', c: 'water' },
    { d: 'M2.4 19.6c3.4-1.4 6.4-1.6 9.4-.6 3.1 1 6.2.9 9.8-.4', k: 'ink' },
    { d: ring(14.6, 3.6, 0.7), k: 'dot' },
  ],

  // A rainbow: three bands, coloured in where the page allows.
  rainbow: [
    { d: 'M3 18a9 9 0 0 1 18 0h-2.7a6.3 6.3 0 0 0-12.6 0z', k: 'wash', c: 'fruit' },
    { d: 'M5.7 18a6.3 6.3 0 0 1 12.6 0h-2.7a3.6 3.6 0 0 0-7.2 0z', k: 'wash', c: 'sun' },
    { d: 'M3 18a9 9 0 0 1 18 0M5.7 18a6.3 6.3 0 0 1 12.6 0M8.4 18a3.6 3.6 0 0 1 7.2 0', k: 'ink' },
  ],

  // GitHub's mark — a link to the project should look like what it links to.
  github: [
    {
      d: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
      k: 'dot',
      t: 'translate(2.6 2.6) scale(.78)',
    },
  ],

  // Three sliders, for the exact controls.
  tune: [
    { d: 'M3.8 7.3c5.4-.3 10.8-.2 16.4 0M3.8 12.1c5.6.2 11-.1 16.4 0M3.8 17c5.4-.2 10.9.1 16.4-.1', k: 'ink' },
    { d: ring(15.2, 7.3, 2.1), k: 'both' },
    { d: ring(8.6, 12.1, 2.1), k: 'both' },
    { d: ring(13.2, 17, 2.1), k: 'both' },
  ],
  close: [{ d: 'M6.6 6.4c3.8 3.6 7.4 7.4 10.9 11.2M17.4 6.5c-3.9 3.5-7.5 7.3-10.8 11.1', k: 'ink' }],
  done: [{ d: 'M5.4 12.7c1.4 1.2 2.7 2.5 3.9 3.9 2.8-3.6 5.8-6.6 9.3-9.3', k: 'ink' }],
  reset: [
    { d: 'M5.5 7.3A8 8 0 1 1 4.3 13.4', k: 'ink' },
    { d: 'M5.2 3.6v3.9h3.9', k: 'ink' },
  ],
  sprout: [
    { d: 'M12 20.4c.1-2.6-.1-5.1 0-7.6', k: 'ink' },
    { d: 'M12 13.3c-.4-2.9-2.6-4.6-6.1-4.4.2 3.1 2.5 4.8 6.1 4.4z', k: 'both' },
    { d: 'M12 11.4c.4-2.8 2.4-4.6 5.9-4.6 0 3.2-2.3 5-5.9 4.6z', k: 'both' },
    { d: 'M7.6 20.4c2.9-.4 5.8-.4 8.8 0', k: 'ink' },
  ],
  play: [{ d: 'M8.1 5.7c0-.9 1-1.4 1.8-.9l9.2 6.3c.7.5.7 1.5 0 2l-9.2 6.3c-.8.5-1.8 0-1.8-.9z', k: 'both' }],
  seeds: [
    { d: 'M7.4 9.6c-.4-2.4 1-4.3 2.9-4.6 1.4 1.6 1.3 4-.6 5.6-.9.3-1.7.1-2.3-1z', k: 'both' },
    { d: 'M14.9 8.6c1-2.1 3.2-2.7 4.9-1.9.2 2.1-1.3 3.8-3.6 4-.9-.1-1.4-.8-1.3-2.1z', k: 'both' },
    { d: 'M10.6 17.8c.2-2.4 2.1-3.7 4-3.5.9 1.9.1 4.1-2.3 4.9-.8 0-1.4-.4-1.7-1.4z', k: 'both' },
  ],

  // ---- Pairs for the ends of the picture sliders: the low end and the high.

  'rain-light': [moving(drop(12, 16.4, 1.05), 'drop', 0.2), { d: CLOUD_HIGH, k: 'both', c: 'sky' }],
  'rain-heavy': [
    moving(drop(6.6, 16, 0.85), 'drop', 0),
    moving(drop(10.9, 17.6, 0.85), 'drop', 0.55),
    moving(drop(15.1, 16, 0.85), 'drop', 0.25),
    moving(drop(19, 17.4, 0.85), 'drop', 0.8),
    { d: CLOUD_HIGH, k: 'both', c: 'storm' },
  ],
  'snow-light': [moving(flake(12, 19, 2.3), 'flake', 0.15), { d: CLOUD_HIGH, k: 'both', c: 'sky' }],
  'snow-heavy': [
    moving(flake(6.8, 18.2, 1.9), 'flake', 0),
    moving(flake(12.2, 20.4, 1.9), 'flake', 0.45),
    moving(flake(17.6, 18.2, 1.9), 'flake', 0.75),
    moving({ d: ring(9.6, 21.3, 0.7), k: 'dot' }, 'snow', 0.3),
    moving({ d: ring(15, 16.8, 0.7), k: 'dot' }, 'snow', 0.6),
    { d: CLOUD_HIGH, k: 'both', c: 'storm' },
  ],

  'sky-clear': [
    { d: 'M12 7.3c2.7-.1 4.8 2.1 4.7 4.8-.1 2.5-2.2 4.6-4.8 4.6-2.6-.1-4.6-2.2-4.6-4.8.1-2.5 2.1-4.5 4.7-4.6z', k: 'both', c: 'sun' },
    { d: SUN_RAYS_LONG, k: 'ink' },
  ],
  'sky-overcast': [
    {
      d: 'M14 11.6c-1.6 0-2.8-1.2-2.8-2.7 0-1.4 1-2.5 2.4-2.7.5-1.6 2-2.7 3.7-2.7 2 0 3.7 1.5 3.9 3.5 1.1.3 1.9 1.3 1.9 2.4 0 1.2-1 2.2-2.3 2.2z',
      k: 'both',
      c: 'storm',
    },
    { d: CLOUD, k: 'both', c: 'sky' },
  ],

  'ground-grass': [
    { d: 'M2.6 19.7c3.4-.5 6.5-.4 9.3 0 2.9.4 5.6.3 9.4-.3', k: 'ink' },
    { d: 'M6 19.3c-.3-3-1.2-5.5-2.8-7.1 2.1 1.3 3.4 3.8 3.8 7.1z', k: 'both', c: 'leaf' },
    { d: 'M6.4 19.3c.4-3.6 1.6-6.3 3.4-8-1.1 2.2-1.8 4.8-2.1 8z', k: 'both', c: 'leaf' },
    { d: 'M13 19.5c-.1-3.6-.9-6.6-2.4-8.7 2 1.6 3.2 4.6 3.4 8.7z', k: 'both', c: 'leaf' },
    { d: 'M13.6 19.5c.6-2.9 1.8-5 3.5-6.4-1 1.9-1.6 4-1.9 6.4z', k: 'both', c: 'leaf' },
    { d: 'M18.6 19.4c-.2-2.4-.8-4.3-1.8-5.8 1.6 1.1 2.6 3 2.8 5.8z', k: 'both', c: 'leaf' },
  ],
  'ground-snow': [
    { d: 'M7.4 13.6c-.2-1.6-.8-2.9-1.7-3.9M16.1 12.6c.3-1.5 1-2.6 2-3.3', k: 'ink' },
    { d: 'M2.4 19.8c1.4-3.6 4.2-5.6 7.6-5.1 1.8-1.8 4.3-2.5 6.8-1.6 2.7 1 4.3 3.3 4.8 6.7z', k: 'both', c: 'snow' },
    { d: 'M2.4 19.9h19.2', k: 'ink' },
    { d: ring(4.6, 6.4, 0.75), k: 'dot' },
    { d: ring(11.2, 4.4, 0.75), k: 'dot' },
    { d: ring(20, 5.6, 0.75), k: 'dot' },
  ],

  droop: [
    { d: 'M12 21.1c.1-2.9 0-6 0-9', k: 'ink' },
    { d: 'M12 12.6c-1.6-3.3-4.5-4.6-6.9-3.3-1.7.9-2.4 3.2-2.2 6.8', k: 'ink' },
    { d: 'M12 11.6c1.7-3.1 4.7-4.1 7-2.6 1.6 1.1 2.1 3.3 1.8 6.7', k: 'ink' },
    { d: 'M12 12c.2-2.7.9-4.8 2.3-6.5', k: 'ink' },
    leafAt(2.9, 16, 100, 4.2),
    leafAt(20.8, 15.6, 80, 4.2),
    leafAt(14.3, 5.6, 20, 3.6),
    { d: 'M8.6 21.2h6.8', k: 'ink' },
  ],
  reach: [
    { d: 'M12 21.1c.1-2.5 0-5.4 0-8', k: 'ink' },
    { d: 'M12 13.6c-2.2-1.6-3.8-4.6-4.3-8.9M12 12.8c2-1.8 3.4-4.7 3.8-8.9M12 13.1c-.1-2.8 0-5.5.1-8', k: 'ink' },
    leafAt(7.7, 4.8, -100, 3.6),
    leafAt(15.8, 4, -80, 3.6),
    leafAt(12.1, 5.1, -90, 3.6),
    { d: 'M8.6 21.2h6.8', k: 'ink' },
  ],

  'branch-few': [
    { d: 'M12 21.2c0-3 .1-5.6 0-8.2', k: 'ink' },
    { d: 'M12 13c-1.5-2.4-3.3-4.1-5.6-5.4M12 13.1c1.3-2.6 3-4.5 5.3-6.1', k: 'ink' },
    { d: 'M8.6 21.2h6.8', k: 'ink' },
  ],
  'branch-many': [
    { d: 'M12 21.2c0-3 .1-5.2 0-7.4', k: 'ink' },
    { d: 'M12 13.8c-1.6-1.8-3.4-3-5.4-3.8M12 13.8c1.4-2 3.3-3.4 5.5-4.2M12 13.8c0-2.8.2-5.5.6-8.2', k: 'ink' },
    { d: 'M6.6 10c-.6-1.8-.4-3.4.4-4.9M6.6 10c-1.6-.6-3-.4-4.2.4M17.5 9.6c.2-1.8.9-3.2 2.2-4.2M17.5 9.6c-.9-1.5-1-3.2-.4-4.9', k: 'ink', w: 0.85 },
    { d: 'M12.6 5.6c-.9-1.2-1.9-2-3.2-2.4M12.6 5.6c.8-1.3 1.8-2.2 3-2.7', k: 'ink', w: 0.85 },
    { d: 'M8.6 21.2h6.8', k: 'ink' },
  ],

  'trunk-thin': [
    { d: 'M12 3.2c3.1 0 5.2 2.1 5 4.8-.2 2.3-2.3 3.8-5 3.8s-4.9-1.5-5-3.8C6.8 5.3 8.9 3.2 12 3.2z', k: 'both', c: 'leaf' },
    { d: 'M11.2 20.7c.4-3 .4-6 .2-8.9h1.3c-.2 2.9-.2 5.9.2 8.9z', k: 'both', c: 'bark' },
    { d: 'M7.4 20.9c3-.3 6.1-.3 9.2 0', k: 'ink' },
  ],
  'trunk-stout': [
    { d: 'M12 3.2c3.1 0 5.2 2.1 5 4.8-.2 2.3-2.3 3.8-5 3.8s-4.9-1.5-5-3.8C6.8 5.3 8.9 3.2 12 3.2z', k: 'both', c: 'leaf' },
    { d: 'M8.4 20.7c1-2.8 1.2-5.6.9-8.9h5.4c-.3 3.3-.1 6.1.9 8.9z', k: 'both', c: 'bark' },
    { d: 'M5.4 20.9c4.4-.3 8.8-.3 13.2 0', k: 'ink' },
  ],

  'twig-bare': [
    { d: 'M12 21.2c-.1-2.6.1-5 0-7.6', k: 'ink' },
    { d: 'M12 13.7c-.1-2.6-1.7-4.4-4.3-5.6M12.1 15.7c.3-2.4 2-4.1 4.7-5', k: 'ink' },
    { d: 'M7.8 8.2c-.7-1.7-.5-3.1.4-4.5M7.7 8.1c-1.6-.4-2.9 0-4.1 1.1M16.8 10.7c.4-1.8 1.4-3 3-3.7', k: 'ink' },
  ],
  'twig-leafy': [
    { d: 'M12 21.2c-.1-2.6.1-5 0-7.6', k: 'ink' },
    { d: 'M12 13.7c-.1-2.6-1.7-4.4-4.3-5.6M12.1 15.7c.3-2.4 2-4.1 4.7-5', k: 'ink' },
    { d: 'M7.8 8.2c-.7-1.7-.5-3.1.4-4.5M7.7 8.1c-1.6-.4-2.9 0-4.1 1.1M16.8 10.7c.4-1.8 1.4-3 3-3.7', k: 'ink' },
    leafAt(8.2, 3.8, -80, 4.2),
    leafAt(3.7, 9.1, -165, 4.2),
    leafAt(19.7, 7.1, -40, 4.2),
    leafAt(12, 18.6, -25, 4.2),
    leafAt(12, 17.2, -160, 4.2),
  ],

  'leaf-small': [
    { d: 'M5 19.1c-.7-7.5 4.6-14 14.7-14.7.4 8.7-5.6 14.5-14.7 14.7z', k: 'both', c: 'leaf', t: 'translate(4.8 4.8) scale(.6)', w: 1.65 },
    { d: 'M5 19.1c3.9-4.4 7.2-7.9 11.1-11.5', k: 'ink', t: 'translate(4.8 4.8) scale(.6)', w: 1.65 },
  ],
  'leaf-big': [
    { d: 'M3.6 20.5c-.8-8.4 5.1-15.8 16.6-16.6.4 9.8-6.3 16.4-16.6 16.6z', k: 'both', c: 'leaf' },
    { d: 'M3.6 20.5c4.4-5 8.2-9 12.6-13', k: 'ink' },
    { d: 'M8.4 15.4l-.6-3.6M8.4 15.4l3.9.4M12.1 11.8l-.4-3.4M12.1 11.8l3.5.2', k: 'ink' },
  ],

  'flower-one': [
    ...petals(12, 12, [4, 4.5, 3.9, 4.4, 4.2], 2.2).map((p) => ({ ...p, c: 'petal' as const })),
    { d: ring(12, 12, 1.4), k: 'both', c: 'sun' },
  ],
  'flower-many': [
    ...petals(7.4, 7.6, [3.2, 3.6, 3.1, 3.5, 3.3], 1.7).map((p) => ({ ...p, c: 'petal' as const })),
    { d: ring(7.4, 7.6, 1), k: 'both', c: 'sun' },
    ...petals(16.8, 9.4, [3.4, 3, 3.5, 3.2, 3.6], 1.7).map((p) => ({ ...p, c: 'petal' as const, t: `${p.t} rotate(20 16.8 9.4)` })),
    { d: ring(16.8, 9.4, 1), k: 'both', c: 'sun' },
    ...petals(10.8, 16.8, [3.3, 3.5, 3.2, 3.6, 3.1], 1.7).map((p) => ({ ...p, c: 'petal' as const, t: `${p.t} rotate(-14 10.8 16.8)` })),
    { d: ring(10.8, 16.8, 1), k: 'both', c: 'sun' },
  ],

  'fruit-one': [...cherry(11.4, 16.4, 3.6, 15.4, 4.2), leafAt(15.4, 4.4, -10, 4.4)],
  'fruit-many': [
    ...cherry(6.8, 16.6, 2.9, 13.4, 4),
    ...cherry(14.6, 18.2, 2.9, 13.4, 4),
    ...cherry(18.2, 12.4, 2.6, 13.4, 4),
    leafAt(13.4, 4.2, -170, 4),
  ],

  'sun-soft': [
    { d: 'M12 8.2c2.1 0 3.8 1.8 3.8 3.9 0 2.1-1.8 3.8-3.9 3.7-2 0-3.7-1.7-3.7-3.8.1-2.1 1.7-3.8 3.8-3.8z', k: 'both', c: 'sun', o: 0.7 },
    { d: 'M12 5v1.2M12 17.8V19M5 12h1.2M17.8 12H19', k: 'ink', o: 0.6 },
  ],
  'sun-strong': [
    { d: 'M12 7.1c2.8 0 5 2.2 4.9 5 0 2.7-2.3 4.9-5 4.8-2.7 0-4.8-2.3-4.8-5 .1-2.7 2.2-4.8 4.9-4.8z', k: 'both', c: 'sun' },
    { d: SUN_RAYS_LONG, k: 'ink' },
  ],

  'hills-clear': [
    { d: ring(16.8, 6.4, 2.3), k: 'both', c: 'sun' },
    { d: 'M2.4 19c2.4-5.2 5.3-7.9 8.5-7.9 3.1 0 5.7 2.5 7.8 7.9z', k: 'both', c: 'leaf' },
    { d: 'M9.6 19c2.4-3.7 4.9-5.4 7.4-5.4 2.3 0 3.8 1.7 4.8 5.4z', k: 'both', c: 'leaf' },
    { d: 'M2 19.1h20', k: 'ink' },
  ],
  'hills-hazy': [
    { d: ring(16.8, 6.4, 2.3), k: 'both', c: 'sun', o: 0.45 },
    { d: 'M2.4 19c2.4-5.2 5.3-7.9 8.5-7.9 3.1 0 5.7 2.5 7.8 7.9z', k: 'both', c: 'mist', o: 0.8 },
    { d: 'M9.6 19c2.4-3.7 4.9-5.4 7.4-5.4 2.3 0 3.8 1.7 4.8 5.4z', k: 'both', c: 'mist' },
    { d: 'M2 19.1h20', k: 'ink' },
    { d: 'M3.2 10.4h5.2M10.6 10.4h7.6M5.4 13.4h4M12.2 13.6h8.2M2.6 16.4h6.8M11.4 16.5h4.4', k: 'ink', o: 0.55, w: 0.9 },
  ],

  breeze: [
    { d: 'M3.4 13.4h10.8c1.7 0 2.9 1.2 2.9 2.7 0 1.4-1.1 2.5-2.5 2.5-1.1 0-2-.7-2.3-1.7', k: 'ink' },
    leafAt(14.2, 8.4, -30, 4.4),
  ],
  gale: [
    { d: 'M2.6 8.4h11.1c1.7 0 2.9-1.2 2.9-2.7 0-1.4-1.1-2.5-2.5-2.5-1.1 0-2 .7-2.3 1.7', k: 'ink' },
    { d: 'M2.6 12.4h16.4c1.7 0 2.9 1.2 2.9 2.7 0 1.4-1.1 2.5-2.5 2.5-1.1 0-2-.7-2.3-1.7', k: 'ink' },
    { d: 'M2.6 16.4h8.8M4.6 20.2h4.8', k: 'ink' },
    leafAt(19.4, 6.4, 25, 3.8),
    leafAt(13.6, 19.6, -60, 3.4),
  ],

  'glow-off': [{ d: ring(12, 12, 3.6), k: 'both', c: 'sun' }],
  'glow-on': [
    { d: ring(12, 12, 9.2), k: 'wash', c: 'sun', o: 0.28 },
    { d: ring(12, 12, 6.6), k: 'wash', c: 'sun', o: 0.5 },
    { d: ring(12, 12, 3.6), k: 'both', c: 'sun' },
    { d: 'M19.6 3.4c.2 1.3.6 1.7 1.9 1.9-1.3.2-1.7.6-1.9 1.9-.2-1.3-.6-1.7-1.9-1.9 1.3-.2 1.7-.6 1.9-1.9z', k: 'both', c: 'sun' },
    { d: 'M4.2 17.4c.15 1 .45 1.3 1.4 1.4-1 .15-1.3.45-1.4 1.4-.15-1-.45-1.3-1.4-1.4 1-.15 1.3-.45 1.4-1.4z', k: 'both', c: 'sun' },
  ],

  snail: [
    { d: 'M2.6 19.2c.6-1.2 1.8-1.8 3.6-1.8h11c1.4 0 2.3-.9 2.6-2.3l.7-2.2c.9 1.1 1.3 2.4 1.1 3.9-.2 1.5-1.4 2.4-3.1 2.4z', k: 'both', c: 'earth' },
    { d: 'M19.8 13.4l-.4-3M20.8 13.6l1.2-2.6', k: 'ink' },
    { d: ring(19.3, 10, 0.75), k: 'dot' },
    { d: ring(22.1, 10.8, 0.75), k: 'dot' },
    { d: 'M12.2 17.4c3.4 0 5.4-2.4 5.4-5.4s-2.4-5.4-5.4-5.4-5.4 2.4-5.4 5.4c0 2.9 2.2 5.4 5.4 5.4z', k: 'both', c: 'bark' },
    { d: 'M12.3 12.1c.9-.1 1.6.6 1.5 1.5-.1 1.1-1.2 1.8-2.3 1.6-1.6-.3-2.4-1.8-2.1-3.3.4-2 2.5-3.1 4.4-2.6 2.3.6 3.4 3 2.8 5.2', k: 'ink' },
  ],
  swift: [
    { d: 'M2.8 9.6c3.6.3 6.6 1.6 8.8 3.9 1.9-2.7 4.9-4.6 9.8-5.6-2.7 1.6-4.7 3.7-6 6.4-.8 1.7-2.5 2.3-3.9 1.4-1.5-.9-4.6-3.7-8.7-6.1z', k: 'both', c: 'sky' },
    { d: 'M3 16.2h5M2.4 19h4.2', k: 'ink' },
  ],

  'colour-muted': [
    { d: ring(9.2, 9.6, 4.6), k: 'both', c: 'mist' },
    { d: ring(14.8, 9.6, 4.6), k: 'both', c: 'mist', o: 0.8 },
    { d: ring(12, 14.4, 4.6), k: 'both', c: 'mist', o: 0.6 },
  ],
  'colour-vivid': [
    { d: ring(9.2, 9.6, 4.6), k: 'both', c: 'fruit' },
    { d: ring(14.8, 9.6, 4.6), k: 'both', c: 'sun', o: 0.9 },
    { d: ring(12, 14.4, 4.6), k: 'both', c: 'water', o: 0.85 },
  ],

  // ---- The look card's switches.

  lens: [
    { d: ring(12, 12, 8), k: 'ink' },
    { d: ring(12, 12, 4.4), k: 'both', c: 'water' },
    { d: 'M9.8 10.4c.4-.9 1.1-1.5 2-1.8', k: 'ink', w: 0.8 },
  ],
  grain: [
    { d: 'M6 4.4h12c.9 0 1.6.7 1.6 1.6v12c0 .9-.7 1.6-1.6 1.6H6c-.9 0-1.6-.7-1.6-1.6V6c0-.9.7-1.6 1.6-1.6z', k: 'both', c: 'earth', o: 0.6 },
    ...[
      [8, 8], [12.6, 7.6], [16.2, 9], [9.6, 12.2], [14.4, 12.4], [7.6, 16], [11.8, 16.4], [16, 15.8],
    ].map(([x, y]) => ({ d: ring(x, y, 0.75), k: 'dot' as const })),
  ],
  smooth: [
    { d: 'M4 19.4h3.4V16h3.4v-3.4h3.4V9.2h3.4V5.8H20', k: 'ink', o: 0.35, w: 0.8 },
    { d: 'M4 19.6c6.8-.4 12.2-5.2 16-13.8', k: 'ink' },
  ],
  orbit: [
    { d: 'M7.2 16.4c-2.6-.7-4.2-1.8-4.2-3 0-2.2 4-4 9-4s9 1.8 9 4c0 2.1-3.6 3.8-8.4 4', k: 'ink' },
    { d: 'M14.1 15.2l-1.5 2.2 2 1.6', k: 'ink' },
    { d: 'M12 3.4c2.1 0 3.6 1.6 3.4 3.5-.1 1.7-1.6 2.9-3.4 2.9s-3.3-1.2-3.4-2.9C8.4 5 9.9 3.4 12 3.4z', k: 'both', c: 'leaf' },
    { d: 'M12 9.8v4.6', k: 'ink' },
  ],
} satisfies Record<string, Part[]>;

export type GlyphName = keyof typeof GLYPHS;
