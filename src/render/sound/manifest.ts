/**
 * Every sound in the garden: what it is, how it was asked for, and how loud
 * it sits in the mix.
 *
 * One list serves both ends. `scripts/sounds/generate.ts` walks it to make
 * the files with ElevenLabs (so the prompt that made a sound lives beside the
 * code that plays it), and the soundscape reads it to know what each file is.
 * It imports nothing, so the script can load it directly under Node.
 *
 * Files land in `public/sounds/`: `<id>.mp3` for a bed or a cue, and
 * `<id>-1.mp3`, `<id>-2.mp3`… for each take of a one-shot, played as a pool.
 */

export type SoundKind = 'bed' | 'shot' | 'music';

export interface SoundSpec {
  id: string;
  kind: SoundKind;
  /** What ElevenLabs was asked for. */
  prompt: string;
  /** Length to ask for, in seconds. */
  seconds: number;
  /** A one-shot's number of takes, played round-robin; one for everything else. */
  takes?: number;
  /** How literally to follow the prompt, 0–1 (ElevenLabs' `prompt_influence`). */
  influence?: number;
  /** Where it sits in the mix relative to its layer's target loudness, in dB. */
  level?: number;
  /** 1: the first pass. 2: when there are credits for it. */
  tier: 1 | 2;
}

const bed = (id: string, prompt: string, extra: Partial<SoundSpec> = {}): SoundSpec => ({
  id,
  kind: 'bed',
  prompt: `${prompt} Seamless continuous ambience, no music, no voices.`,
  seconds: 20,
  influence: 0.45,
  tier: 1,
  ...extra,
});

const shot = (id: string, takes: number, seconds: number, prompt: string, extra: Partial<SoundSpec> = {}): SoundSpec => ({
  id,
  kind: 'shot',
  prompt: `${prompt} Isolated single sound, no music, no voices.`,
  seconds,
  takes,
  influence: 0.55,
  tier: 1,
  ...extra,
});

const music = (id: string, seconds: number, prompt: string, extra: Partial<SoundSpec> = {}): SoundSpec => ({
  id,
  kind: 'music',
  prompt: `${prompt} Instrumental only.`,
  seconds,
  tier: 1,
  ...extra,
});

export const SOUNDS: SoundSpec[] = [
  // ------------------------------------------------ the air of the place
  bed('bed-spring-day', 'Open countryside meadow on a mild spring morning: soft breeze over young grass, very distant songbirds far across the fields, faint bees, airy and fresh.'),
  bed('bed-summer-day', 'Warm summer afternoon in a grassy meadow: lazy insect hum, grasshoppers ticking in the long grass, a gentle warm breeze, distant and sleepy.'),
  bed('bed-autumn-day', 'Cool autumn day in open fields: a breeze stirring dry grass, fallen leaves skittering softly along the ground, rooks very far away, hollow and calm.'),
  bed('bed-winter-day', 'Snow-covered field on a still winter day: deep muffled hush, faint cold wind over the snow, almost silent, a sense of wide space.'),
  bed('bed-spring-night', 'Spring night beside a small pond: a chorus of frogs gently croaking, soft breeze in the grass, peaceful and dark.'),
  bed('bed-summer-night', 'Warm summer night in a meadow: a steady chorus of crickets, a few frogs by a pond, still air, peaceful.'),
  bed('bed-autumn-night', 'Cool autumn night in the countryside: sparse slow crickets, light wind through dry grass, quiet and lonely.'),
  bed('bed-winter-night', 'Freezing clear winter night over snow: near silence, a faint high wind, crystalline cold stillness.'),

  // ------------------------------------------- wind, and the tree's voice
  bed('wind-leaves', 'A single broadleaf tree’s leaves rustling softly in a light breeze, close by, gentle swells rising and falling.'),
  bed('wind-gale', 'Strong gusty wind through a large leafy tree: leaves roaring and branches creaking in surges.'),
  bed('wind-bare', 'Cold wind through the bare branches of a winter tree: faint whistling and the creak of twigs, sparse.'),
  bed('wind-pine', 'Wind sighing through the needles of a tall pine tree: a soft whooshing hiss rising and falling.'),
  bed('rustle-hand', 'Hands brushing slowly through the leaves of a small tree, close, continuous soft rustling of leaves.'),
  bed('rustle-twigs', 'Fingers brushing through dry bare twigs, delicate dry clicking and scratching, close.', { tier: 2 }),

  // ----------------------------------------------------------- weather
  bed('rain-light', 'Gentle light rain falling on leaves and grass in the countryside, soft and even, no thunder.'),
  bed('rain-heavy', 'Steady heavy rain on a leafy tree and a meadow, dense pattering and dripping, no thunder.'),
  bed('rain-pond', 'Rain pattering on the surface of a small pond, close, many little plinks and drips on the water.'),
  bed('snowfall', 'Snow falling quietly in the countryside: soft muffled hush, the faint whisper of flakes and a light wind, very quiet.'),
  shot('thunder-far', 3, 8, 'Distant thunder rolling slowly far away over hills, low and soft.', { tier: 2 }),

  // ------------------------------------------------------------ the pond
  bed('pond-water', 'Gentle water lapping at the reedy edge of a small calm pond, soft trickles, intimate and close.'),
  shot('fish-plop', 3, 1, 'A small fish rising to the surface of a calm pond: a soft gulp and a tiny plop of water.'),
  shot('duck-dabble', 1, 2, 'A duck up-ending to feed in a shallow pond: a soft splash and water dripping.'),
  bed('duck-paddle', 'A duck paddling slowly across calm pond water, faint soft swishing of water.', { seconds: 15, tier: 2 }),
  shot('ice-sing', 3, 3, 'A frozen lake making its eerie singing sound: a high descending ping and twang of ice under tension.', { tier: 2 }),
  shot('ice-creak', 1, 3, 'Thin pond ice creaking and cracking softly as it freezes over.'),

  // ------------------------------------------------------------ creatures
  shot('dove-coo', 3, 2.5, 'A collared dove cooing softly from a tree nearby, three gentle notes.'),
  shot('dove-takeoff', 2, 2, 'Several pigeons taking off at once from a tree, a sudden clatter of wings.'),
  shot('dove-wheel', 2, 4, 'A small flock of doves flying past overhead, steady whistling wingbeats passing by.', { tier: 2 }),
  shot('dove-land', 2, 1.5, 'A single pigeon landing on a tree branch with a flutter of wings and a rustle of leaves.'),
  shot('songbird-spring', 2, 4, 'A blackbird singing a short melodious phrase from a nearby tree on a spring morning.'),
  shot('songbird-summer', 2, 4, 'A wren singing a bright rapid trill from a hedge on a summer day.'),
  shot('songbird-autumn', 1, 4, 'A robin singing its thin wistful autumn song, one short phrase.'),
  shot('chickadee', 2, 2, 'A chickadee calling chick-a-dee-dee-dee, clear and close, on a winter day.'),
  shot('duck-quack', 2, 1.5, 'A female mallard duck quacking softly a few times on a pond.'),
  shot('drake-call', 2, 1.5, 'A male mallard drake making a low, raspy, quiet call on a pond.', { tier: 2 }),
  shot('duckling-peep', 2, 2, 'Tiny ducklings peeping softly as they paddle after their mother.'),
  shot('bee-flyby', 3, 3, 'A bumblebee buzzing past close by and away.', { tier: 2 }),
  shot('crow-far', 2, 3, 'A crow cawing in the distance across autumn fields.', { tier: 2 }),
  shot('geese-far', 1, 6, 'A skein of wild geese honking far overhead, passing slowly.', { tier: 2 }),
  shot('owl-hoot', 3, 4, 'A tawny owl hooting softly in the night, far off.', { tier: 2 }),

  // ------------------------------------------------------------- the tree
  // Heard only while the tree grows (three seconds at the usual speed), so it
  // has to be all texture from its first instant: no build-up, no pauses.
  bed(
    'grow-texture',
    'A living plant growing fast, heard from the very first instant: soft creaking of green wood stretching, leaves unfurling and rustling, tiny crackles of buds opening, over a faint airy shimmer. Dense, even and constant throughout, no pauses, no build-up.',
    { seconds: 12, influence: 0.6 },
  ),
  shot('grow-seed', 1, 2, 'A seed dropped into soft soil with a soft earthy thump, then a tiny bright sparkle as it sprouts.'),
  shot('grow-bloom', 1, 3, 'Leaves settling into place on a young tree with a soft rustle and a gentle magical shimmer resolving.'),
  shot('tree-sink', 1, 3, 'A small tree sinking back into the earth: soft rustling withdrawal and a low earthy whoosh.'),
  shot('leaf-fall', 2, 2.5, 'A few dry leaves falling from a tree and landing softly on the grass.'),
  shot('apple-thud', 2, 1, 'An apple dropping from a tree onto soft grass: a dull thud and a small roll.'),
  shot('berry-patter', 1, 1, 'Small berries dropping into the grass, a light soft patter.'),
  shot('cone-thud', 1, 1, 'A pine cone falling onto the ground, a woody tap and a little bounce.'),

  // ----------------------------------------------------------------- music
  music(
    'music-rainbow',
    16,
    'Hopeful, gentle wonder. Start with a soft harp glissando, then celesta notes and a warm slow string swell, D major, 70 BPM, airy hall reverb, no percussion. Rise once and fade out to silence.',
  ),
  music(
    'music-aurora',
    28,
    'Ethereal, vast night sky. Slow evolving warm analogue pads, a soft wordless choir, glassy bell tones, F sharp minor drifting to A major, 56 BPM, long shimmering reverb, no drums. Fade out slowly.',
  ),
  music(
    'music-nightfall',
    12,
    'Dusk. Solo felt piano playing three soft descending chords with a low cello underneath, warm and close-mic’d, 60 BPM, then silence.',
  ),
  music(
    'music-daybreak',
    12,
    'Morning. Fingerpicked acoustic guitar harmonics and a light wooden flute rising, G major, 84 BPM, bright and fresh, gentle ending.',
  ),
  music(
    'music-welcome',
    24,
    'Cosy, whimsical picture-book garden. Kalimba and soft piano with light pizzicato strings, G major, 92 BPM, warm and playful, gentle ending.',
  ),
  music(
    'music-tour',
    75,
    'Unobtrusive, curious underscore. Soft marimba ostinato, brushed bells and low warm strings, C major, 80 BPM, steady and light, no big moments, even from start to end.',
    { tier: 2 },
  ),

  // ------------------------------------------------------------- interface
  shot('ui-pebble', 3, 0.5, 'A small smooth river pebble tapped softly on another, a single gentle click.', { tier: 2 }),
  shot('ui-card', 2, 0.8, 'A sheet of thick paper slid softly across a wooden table.', { tier: 2 }),
  shot('ui-ask', 2, 1, 'A tiny wooden wind chime, one soft note.', { tier: 2 }),
];

/** The files a spec is played from. */
export function filesOf(spec: SoundSpec): string[] {
  if (spec.kind === 'shot') return Array.from({ length: spec.takes ?? 1 }, (_, i) => `${spec.id}-${i + 1}.mp3`);
  return [`${spec.id}.mp3`];
}

export const SOUND_BY_ID: Record<string, SoundSpec> = Object.fromEntries(SOUNDS.map((s) => [s.id, s]));
