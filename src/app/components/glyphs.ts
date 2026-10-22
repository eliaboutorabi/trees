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
 */
export type Part = { d: string; k: 'wash' | 'ink' | 'both' | 'dot'; t?: string };

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
    { d: 'M9 5.2c2-.1 3.6 1.4 3.7 3.3', k: 'ink' },
    { d: 'M5.1 9.3c-.2-2 1.2-3.8 3.4-4.1', k: 'ink' },
    { d: 'M8.6 2.6v1.3M3.2 8.6h1.3M4.6 4.5l.9.9M12.7 4.6l-.9.9', k: 'ink' },
    { d: CLOUD, k: 'both' },
  ],
  'weather-rain': [
    { d: CLOUD_HIGH, k: 'both' },
    { d: 'M8.3 17.3l-.9 2.6M12.3 17.4l-.9 2.8M16.2 17.3l-.8 2.5', k: 'ink' },
  ],
  'weather-snow': [
    { d: CLOUD_HIGH, k: 'both' },
    { d: ring(8, 18.6, 0.9), k: 'dot' },
    { d: ring(12.2, 20.2, 0.9), k: 'dot' },
    { d: ring(16.3, 18.4, 0.9), k: 'dot' },
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
} satisfies Record<string, Part[]>;

export type GlyphName = keyof typeof GLYPHS;
