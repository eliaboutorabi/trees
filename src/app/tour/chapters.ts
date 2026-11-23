/**
 * The tour: what it says, and what it points at.
 *
 * It is told in chapters, one for each part of the app, so the whole thing
 * can be watched from start to finish or any one part opened on its own —
 * from the map, or from the "?" on that part's own label or card. Each step
 * names what it points at by a `data-tour` attribute on the element itself,
 * so the steps survive the layout moving about; a step with no target talks
 * about the scene as a whole and sits in the middle of it.
 */
import type { GlyphName } from '../components/glyphs';

export interface TourStep {
  /**
   * What to point at: a selector for a `data-tour` name, or a list of them;
   * or `@tree` or `@pond`, for where those are in the scene. Nothing means
   * the scene as a whole.
   */
  target?: string;
  /** Which side of it the card sits on, if it matters. */
  side?: 'top' | 'bottom' | 'left' | 'right';
  title: string;
  /** A sentence or two. `*words*` are set in bold. */
  body: string;
  /** Open this tool's card on the way in, or close whichever is open. Left out, the dock is left alone. */
  open?: string | null;
}

export interface TourChapter {
  id: string;
  title: string;
  /** What the chapter covers, for the map. */
  blurb: string;
  icon: GlyphName;
  steps: TourStep[];
  /** Only in the full tour: the opening and the goodbye. */
  framing?: boolean;
}

/** A step, with the chapter it belongs to, as the tour runs through them. */
export interface TourStop {
  chapter: TourChapter;
  step: TourStep;
  /** Its place in its chapter, from 0. */
  n: number;
}

const at = (name: string) => `[data-tour="${name}"]`;

/** A dock tool: its button, then its card opened. */
function tool(
  id: string,
  title: string,
  icon: GlyphName,
  blurb: string,
  button: string,
  cardTitle: string,
  card: string,
  extra: TourStep[] = [],
): TourChapter {
  return {
    id,
    title,
    blurb,
    icon,
    steps: [
      { target: at(`tool-${id}`), side: 'top', title, body: button, open: null },
      { target: at('card'), title: cardTitle, body: card, open: id },
      ...extra,
    ],
  };
}

export const CHAPTERS: TourChapter[] = [
  {
    id: 'hello',
    title: 'Welcome',
    blurb: 'What Arbor is, and how to move about.',
    icon: 'grove',
    framing: true,
    steps: [
      {
        title: 'A tour of the garden',
        body: 'Arbor grows trees from *L-systems*: little grammars, rewritten over and over, that a turtle then walks into wood and leaves. Here is everything you can do with them. The arrow keys move through the tour, and Esc leaves it any time.',
        open: null,
      },
      {
        target: at('brand'),
        side: 'bottom',
        title: 'Arbor',
        body: 'Click the name to say hello again. Underneath it, how fast the scene is being drawn and how many leaves and triangles the tree has.',
      },
      {
        title: 'Walk round it',
        body: '*Drag* anywhere on the scene to circle the tree, and *scroll* or *pinch* to come closer or step back.',
      },
    ],
  },
  {
    id: 'top',
    title: 'Along the top',
    blurb: 'Reframing, pictures, links, starting over, the map.',
    icon: 'reframe',
    steps: [
      { target: at('top-reframe'), side: 'bottom', title: 'Reframe', body: 'Lost the tree? This swings the camera back round to frame it.' },
      { target: at('top-save'), side: 'bottom', title: 'Save a picture', body: 'Saves the scene as an image: just the garden, none of these buttons.' },
      { target: at('top-link'), side: 'bottom', title: 'Share this tree', body: 'Copies a link that grows *this exact tree* for whoever opens it: species, season, every slider you moved.' },
      { target: at('top-reset'), side: 'bottom', title: 'Start over', body: 'Puts this species back just the way it first came.' },
      { target: at('top-map'), side: 'bottom', title: 'The map', body: 'Every part of this tour, to pick from whenever you like, or to watch from the start.' },
      { target: at('top-github'), side: 'bottom', title: 'Made in the open', body: 'All of Arbor’s code, with a long and rather entertaining tour of how it works.' },
    ],
  },
  {
    id: 'scene',
    title: 'Scene switches',
    blurb: 'The L-system view, orbit, focus blur, rainbow and aurora, night, sound.',
    icon: 'orbit',
    steps: [
      { target: at('quick'), side: 'right', title: 'Switches for the whole scene', body: 'One tap each, always in reach.' },
      {
        target: at('quick-xray'),
        side: 'right',
        title: 'The L-system view',
        body: 'Put the garden away and see the tree as its grammar drew it: every *F* a segment, coloured by how deep in brackets it was drawn. Step through the rewrites one at a time, pick any branch to see the symbols that wrote it and how it grew from the axiom, rewrite by rewrite. The *L* key does the same.',
      },
      { target: at('quick-orbit'), side: 'right', title: 'Orbit', body: 'The camera drifts slowly round the tree by itself. Lovely to leave running.' },
      { target: at('quick-focus'), side: 'right', title: 'Focus blur', body: 'A camera’s shallow depth of field: the tree sharp, the hills behind it and the flowers in front soft.' },
      {
        target: `${at('quick-rainbow')}, ${at('quick-aurora')}`,
        side: 'right',
        title: 'Rainbow and aurora',
        body: 'By day, a rainbow arcs over the hills. At night the same button lights the *aurora*.',
      },
      { target: at('quick-night'), side: 'right', title: 'Night', body: 'Dusk falls: the stars come out, the moon rises, and fireflies drift over the meadow.' },
      {
        target: at('quick-sound'),
        side: 'right',
        title: 'Sound',
        body: 'Hear the garden: the air of each season by day and by night, the wind in the crown, rain, the pond and its creatures, the tree growing, and now and then some music. Every sound comes from where it is, so turning the camera turns the garden round you, and the interface itself plays quiet notes as you use it. Hover the speaker for a little mixer. Off until you turn it on.',
      },
    ],
  },
  {
    id: 'grow',
    title: 'Growing',
    blurb: 'Grow it, shrink it, replay it, plant a new seed.',
    icon: 'sprout',
    steps: [
      {
        target: at('grow-bud'),
        side: 'left',
        title: 'Grow',
        body: '*Drag the bud* up to grow the tree, and down to take it back to a seed. Every branch and leaf arrives in the order it grew.',
      },
      { target: at('grow-replay'), side: 'left', title: 'Watch it again', body: 'Grows the tree from a seed once more. The space bar does it too.' },
      { target: at('grow-seed'), side: 'left', title: 'A new seed', body: 'The same grammar from a different seed: a new tree of the same kind, never the same tree twice. Or press R.' },
    ],
  },
  tool(
    'species',
    'Species',
    'grove',
    'Nine trees, each its own grammar.',
    'Nine trees, each grown from a grammar of its own. Hover here and the card opens; click to keep it open while you use it.',
    'Pick one',
    'Oak, willow, pine, birch, sakura, apple, rowan, baobab, and the *textbook bush* from The Algorithmic Beauty of Plants. The tree you have grows back into the ground while the new one grows out of it.',
  ),
  tool(
    'season',
    'Seasons',
    'year-summer',
    'The same tree through the year.',
    'The same tree through the year, the light, the meadow and the pond changing with it. The icon is the year’s wheel, the season you are in coloured in.',
    'Spring to winter',
    'Blossom and ducklings in spring, full green in summer, turning and falling leaves in autumn, snow and a frozen pond in winter. The light changes with them.',
  ),
  tool(
    'weather',
    'Weather',
    'weather-rain',
    'Rain, snow and cloud.',
    'What the sky is doing. The icon shows the weather you have now.',
    'Rain, snow, cloud',
    'Rain rings the pond and darkens the bark; snow settles on the branches, the grass and the ground. Close the clouds over and the sun’s strength and colour go with them.',
  ),
  tool(
    'wildlife',
    'Wildlife',
    'wildlife',
    'Birds, butterflies and ducks.',
    'Who lives in the garden, and how many of them.',
    'Birds, butterflies, ducks',
    'How many doves and how big, the butterflies over the meadow, and the mallards and their ducklings on the pond. *Shoo* the birds and they wheel round the tree and come back.',
  ),
  tool(
    'shape',
    'Shape',
    'twig',
    'How the tree branches.',
    'How the tree branches: the grammar’s own numbers, behind a few friendly pictures.',
    'Grow it differently',
    'Droop or reach, how branchy, how stout a trunk. The exact numbers open beside the card: generations, branch angle, internode length, tropism.',
  ),
  tool(
    'foliage',
    'Foliage',
    'leaf',
    'The leaves, and how they turn.',
    'The leaves, on whatever tree is growing.',
    'Leaves',
    'A bare crown or a full one, leaf size, how far they have turned, and how much sun glows through them.',
  ),
  tool(
    'bloom',
    'Bloom & fruit',
    'bloom',
    'Flowers and fruit, on any tree.',
    'Any tree can flower and fruit, whatever its species does in the wild.',
    'Flowers and fruit',
    'Petals and their colour, fruit and its skin, ripeness, the sun’s blush on a cheek and the waxy bloom on a plum. Touch the tree and ripe fruit falls.',
  ),
  tool(
    'light',
    'Light',
    'sunset',
    'The sun, the sky and the haze.',
    'The sun and the sky, and the hour of the day with them.',
    'Sun dial',
    'Drag the sun round the dial to set its height and bearing: low and golden, or high noon. Its strength, the haze, the colour and the sky’s own light are here too.',
  ),
  tool(
    'wind',
    'Wind',
    'wind',
    'How hard, how gusty, which way.',
    'How the air moves through the garden.',
    'How it blows',
    'Its strength, how restless the gusts are, and which way it blows. Leaves flutter, branches sway, and the willow’s curtains swing.',
  ),
  tool(
    'look',
    'Look',
    'frame',
    'How the picture is drawn.',
    'How the picture is drawn, as a photographer would set a camera.',
    'The finish',
    'Film grain, smooth edges, the glow round bright light, and how fast the tree grows when it is redrawn.',
  ),
  tool(
    'grammar',
    'Grammar',
    'quill',
    'The L-system itself, and learning to write one.',
    'The tree itself, written out as the grammar it grows from.',
    'Its L-system',
    'This is the sentence the tree grows from: an *axiom*, and *rules* that rewrite it generation after generation. Change a rule and the tree regrows to match.',
    [
      {
        target: at('learn'),
        title: 'Learn to write one',
        body: 'A short course, from a turtle drawing a square to the oak in the garden, with a drawing board that follows as you type.',
        open: 'grammar',
      },
    ],
  ),
  {
    id: 'touch',
    title: 'Touch the garden',
    blurb: 'The tree and the pond answer your pointer.',
    icon: 'butterfly-many',
    steps: [
      {
        target: '@tree',
        title: 'Touch the tree',
        body: 'Move your pointer through the crown and the leaves *part* round it. Rustle it quickly and leaves shake loose; touch ripe fruit and it falls.',
        open: null,
      },
      {
        target: '@pond',
        title: 'The pond',
        body: 'Hold your pointer over the water and the *fish* swim over to see you. Now and then one rises to kiss the surface.',
      },
    ],
  },
  {
    id: 'bye',
    title: 'That’s the garden',
    blurb: '',
    icon: 'sprout',
    framing: true,
    steps: [
      {
        title: 'Happy growing',
        body: 'The map at the top opens any part of this again, and every card has a *?* that explains it. Now go and grow something.',
        open: null,
      },
    ],
  },
];

/** The chapters the map offers, and the "?" buttons open. */
export const PARTS = CHAPTERS.filter((c) => !c.framing);

/** The steps of these chapters, in order; all of them, opening and goodbye included, if none are named. */
export function stopsFor(ids?: string[]): TourStop[] {
  const chosen = ids ? CHAPTERS.filter((c) => ids.includes(c.id)) : CHAPTERS;
  return chosen.flatMap((chapter) => chapter.steps.map((step, n) => ({ chapter, step, n })));
}
