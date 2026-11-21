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
  /** 1: the first pass. 2: when there were credits for it. 3: placed sound, single doves, the garden's music. */
  tier: 1 | 2 | 3;
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

  // A single dove, and only a soft one: the flock comes and goes all day, so
  // what is heard is a bird braking into the crown and the odd one leaving it.
  shot('dove-flutter-in', 3, 2, 'A single dove gliding in to land on a leafy branch: a few soft braking wingbeats, then a light rustle of leaves as it settles.', { tier: 3, level: -3 }),
  shot('dove-flutter-off', 3, 1.5, 'A single dove leaving a branch: one soft wing clap and a few quick wingbeats fading away.', { tier: 3, level: -3 }),

  // -------------------------------------- the places around, heard from where they are
  // Mono-minded loops for one spot each: the pond's frogs, the meadow's
  // insects, the woods on the horizon. Placed in the world, they turn round
  // the listener as the camera does.
  bed('frogs-pond', 'A few common frogs croaking softly among the reeds at the edge of a small pond in the evening, close by, sparse unhurried calls with gentle pauses.', { tier: 3 }),
  bed('insects-meadow', 'Grasshoppers and bush crickets ticking and buzzing softly in long sunlit grass on a warm summer afternoon, close by, gentle and dry.', { tier: 3, level: -2 }),
  bed('crickets-night', 'A handful of field crickets chirping steadily in the grass on a warm night, close by, clear individual chirps, calm.', { tier: 3, level: -2 }),
  bed('woods-spring', 'A spring woodland heard from across an open meadow: a soft distant chorus of many small songbirds, far away and airy, a faint breeze in far trees.', { tier: 3 }),
  bed('woods-summer', 'A summer woodland heard from across a field, steady and continuous from start to end: wood pigeons cooing far off, distant songbirds, a soft far hum of insects, warm and drowsy.', { tier: 3, influence: 0.6 }),
  bed('woods-autumn', 'An autumn woodland heard from across empty fields: rooks and jackdaws calling far away, wind moving through distant trees, sparse.', { tier: 3 }),
  bed('woods-winter', 'A winter forest heard from across a snowy field: a low wind in distant pine trees, a single far-off crow now and then, cold and very still.', { tier: 3 }),
  bed('woods-night', 'A woodland at night heard from across a dark meadow: a very faint wind in far trees, a distant tawny owl once in a while, deep quiet.', { tier: 3 }),

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

  // The garden's own music: one palette (felt piano, kalimba, harp, warm
  // strings, bells), a key and a few voices for each season, two for the
  // night. Each piece is played now and then, with long rests between, the
  // way music comes and goes in a walk rather than playing over it.
  music(
    'garden-spring-1',
    100,
    'Gentle pastoral ambient piece for a garden on a spring morning. Kalimba plays a slow, simple, hopeful melody over soft felt piano chords, an airy alto flute answering now and then; light pizzicato strings enter halfway. G major, 72 BPM, sparse and spacious, warm natural room reverb, soft dynamics, no drums. Ends quietly on a held chord.',
    { tier: 3 },
  ),
  music(
    'garden-spring-2',
    100,
    'Delicate ambient piece for a spring afternoon in a garden. Harp arpeggios drift under a warm clarinet melody, with soft string pads swelling and receding like a breeze. D major, 66 BPM, unhurried, spacious and gentle, no percussion. Fades out softly.',
    { tier: 3 },
  ),
  music(
    'garden-summer-1',
    100,
    'Warm, lazy ambient piece for a summer afternoon under a tree. Fingerpicked nylon-string guitar with soft felt piano and a low cello drone, a few vibraphone notes like sunlight through leaves. C major, 70 BPM, relaxed and golden, intimate, no drums. Gentle ending.',
    { tier: 3 },
  ),
  music(
    'garden-summer-2',
    100,
    'Dreamy ambient piece for a still summer day by a pond. Vibraphone and soft hand chimes over slow warm string pads, a muted horn melody once in the middle. F major, 60 BPM, slow and shimmering, lots of space, no percussion. Fades to silence.',
    { tier: 3 },
  ),
  music(
    'garden-autumn-1',
    100,
    'Wistful ambient piece for an autumn afternoon as leaves fall. Solo cello sings a slow melody over soft felt piano, an oboe answers once. A minor moving to C major, 63 BPM, tender, reflective, warm and sparse. Ends softly.',
    { tier: 3 },
  ),
  music(
    'garden-autumn-2',
    100,
    'Quiet, nostalgic solo piano piece for a cool autumn day. Felt piano with gentle falling figures, a soft viola joining late, close and intimate. E minor, 58 BPM, very sparse, lots of silence between phrases. Quiet ending.',
    { tier: 3 },
  ),
  music(
    'garden-winter-1',
    100,
    'Crystalline ambient piece for a snowy winter garden. Celesta and music box play a slow, simple tune over a soft cold pad and glassy harmonics. D minor drifting to F major, 54 BPM, delicate, sparse and hushed, long reverb, no percussion. Fades away.',
    { tier: 3 },
  ),
  music(
    'garden-winter-2',
    100,
    'Very sparse, hushed solo felt piano for a still winter day under snow. A few slow notes and chords with long pauses, warm and close, soft pedal. B-flat major, 50 BPM, calm and tender. Ends on a single held note.',
    { tier: 3 },
  ),
  music(
    'garden-night-1',
    100,
    'Warm, slow ambient night piece for a garden under the stars. Soft evolving pads, a gentle felt piano playing a few notes, a distant warm French horn once. A-flat major, 52 BPM, peaceful and enveloping, deep reverb, no drums. Fades out slowly.',
    { tier: 3 },
  ),
  music(
    'garden-night-2',
    100,
    'Cool, mysterious ambient night piece for a moonlit garden. Glass bells and soft harmonics over low sustained strings, a faint wordless choir far away. F-sharp minor, 50 BPM, still and spacious, gentle, no percussion. Fades to silence.',
    { tier: 3 },
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
