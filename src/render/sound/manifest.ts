/**
 * Every sound in the garden: what it is, how it was asked for, and how loud
 * it sits in the mix.
 *
 * One list serves both ends. `scripts/sounds/generate.ts` walks it to make
 * the files with ElevenLabs (so the prompt that made a sound lives beside the
 * code that plays it), and the soundscape reads it to know what each file is.
 * It imports nothing, so the script can load it directly under Node.
 *
 * Files land in `public/sounds/`: `<id>.mp3` for a bed or a piece, and
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
  /** How many takes: a one-shot's pool, or a piece of music's versions. */
  takes?: number;
  /** How literally to follow the prompt, 0–1 (ElevenLabs' `prompt_influence`). */
  influence?: number;
  /** Where it sits in the mix relative to its layer's target loudness, in dB. */
  level?: number;
  /** 1: the first pass. 2: when there were credits for it. 3: placed sound, single doves. 4: the score, and the interface's instrument. */
  tier: 1 | 2 | 3 | 4;
  /** For a sound played as notes: the pitch of each take, in Hz, as measured. */
  pitch?: number[];
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

/** The score's shared voice, appended to every piece of it. */
const SCORE =
  'Bittersweet and grown-up, never cute or childlike: no kalimba, no music box, no glockenspiel, no ukulele, no whistling. Intimate close-miked instruments in a large, soft hall reverb, with a gentle tape warmth.';

const score = (id: string, seconds: number, prompt: string, extra: Partial<SoundSpec> = {}): SoundSpec =>
  music(id, seconds, `${prompt} ${SCORE}`, { tier: 4, ...extra });

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
  //
  // One score, all in D: Dorian, Aeolian, Lydian, major and minor for its
  // moods, so the moments, the garden's pieces and the interface's notes
  // (which are in D Dorian) never quarrel. One palette: felt piano, cello,
  // strings, glass harmonics, a distant horn, a large soft hall. Bittersweet
  // and grown-up throughout.

  // The sky's moments.
  score('music-nightfall', 14, 'Dusk falling over a garden. Felt piano plays three slow descending chords over a low cello and a distant string pad, warm and bittersweet, the last light going. D minor moving to B-flat major, 56 BPM. Ends on a soft held chord.'),
  score('music-daybreak', 14, 'First light over a garden. A soft string pad opens, felt piano plays a gentle rising phrase, a muted horn far away; tender, quietly hopeful, a little sad. D major add9, 60 BPM. Fades out.'),
  score('music-rainbow', 18, 'A rainbow appearing after rain. Slow shimmering string harmonics and glassy textures rise over warm felt piano chords: wonder with a lump in the throat, a moment you wish would last. D major moving to B minor, 62 BPM. Rises once, then fades into the reverb.'),
  score('music-aurora', 28, 'The aurora over a garden at night. Vast slow analogue pads evolving, a distant wordless choir, a low cello pedal, glass-like harmonics drifting; awe and solitude. D minor drifting to F major, 50 BPM. Fades out slowly.'),
  score('music-welcome', 22, 'An opening for a quiet garden. Felt piano alone at first, a slow, tender, memorable four-note motif; then a warm string pad and a cello join beneath. Intimate, bittersweet, inviting. D Dorian, 64 BPM. Ends softly on a suspended chord.'),
  score('music-tour', 90, 'A quiet underscore for being shown round a garden. A gentle repeating felt piano pattern, a soft string pad and an occasional cello line; steady, calm and slightly wistful, no big moments, even from start to end. D Dorian, 72 BPM.'),

  // What you change: a short piece when you settle on a season, a weather,
  // a new tree. Two takes of each, so a second visit is not the same.
  score('moment-spring', 18, 'A short musical moment for the arrival of spring. Felt piano plays a slow, tender rising phrase over a soft string pad, a solo cello answers with a warm line: light after a long winter, hopeful yet wistful. D Lydian, 66 BPM. Builds gently, then fades into the reverb.', { takes: 2 }),
  score('moment-summer', 18, 'A short musical moment for the height of summer. Slow warm swells of strings and a muted French horn under sparse felt piano chords, golden and nostalgic, like the end of a long afternoon you already miss. D major with suspended chords, 60 BPM. Fades into the reverb.', { takes: 2 }),
  score('moment-autumn', 18, 'A short musical moment for autumn arriving. A solo cello sings a slow falling melody over soft felt piano and a distant string pad, leaves letting go; reflective and tender. D Dorian, 58 BPM. Ends softly, unresolved.', { takes: 2 }),
  score('moment-winter', 18, 'A short musical moment for winter arriving. Sparse felt piano notes and glassy string harmonics over a deep, quiet low drone: cold air and stillness, solitary but warm at heart. D minor, 52 BPM. Fades into silence.', { takes: 2 }),
  score('moment-rain', 16, 'In the key of D minor (Aeolian), centred on D throughout. A short musical moment for rain beginning to fall. Soft repeated felt piano notes like the first drops, a low cello swell beneath, a grey hush; melancholy and comforting. D Aeolian, 64 BPM. Fades out.', { takes: 2 }),
  score('moment-snow', 16, 'In the key of D minor, centred on D throughout. A short musical moment for snow beginning to fall. Slow glassy harmonics and very soft high strings over a hushed pad, weightless and still, gently sorrowful. D minor add9, 50 BPM. Fades out.', { takes: 2 }),
  score('moment-clear', 16, 'A short musical moment for the sky clearing after rain. A warm string chord opens up, felt piano descends gently into a resolved major chord: relief, with a trace of sadness. D major, 62 BPM. Fades out.', { takes: 2 }),
  score('moment-tree', 16, 'A short musical moment for a young tree growing from the ground. A slow felt piano arpeggio rises over a deep cello note and a swelling string pad, patient and quietly moving, like years passing in seconds. D Dorian turning to D major, 70 BPM. Rises for the first eight seconds, then settles and fades.', { takes: 2 }),

  // The garden's own pieces, played now and then with long rests between.
  score('garden-spring-1', 100, 'In the key of D (Lydian), centred on D throughout. Slow piece for a spring morning in a garden. A tender, searching felt piano melody over a soft string quartet; a solo violin answers once, very quietly. D Lydian, 66 BPM, sparse and spacious. Ends quietly on a held chord.'),
  score('garden-spring-2', 100, 'Ambient piece for a spring afternoon in a garden. Warm strings swelling and receding like a breeze, sparse piano notes, a clarinet in its low register singing a simple bittersweet line. D major with suspended chords, 62 BPM. Fades out softly.'),
  score('garden-summer-1', 100, 'Slow piece for a hot summer afternoon under a tree. Fingerpicked nylon-string guitar and felt piano in quiet dialogue over a low cello drone, golden and nostalgic. D major, 68 BPM, intimate. Gentle ending.'),
  score('garden-summer-2', 100, 'In the key of D (Mixolydian), centred on D throughout. Dreamy, still piece for a summer day by a pond. Long soft string chords, a muted French horn melody once in the middle, gentle piano reflections: heat haze and memory. D Mixolydian, 58 BPM, lots of space. Fades to silence.'),
  score('garden-autumn-1', 100, 'Strictly in D Dorian: it begins on a D minor chord and ends on one, with D in the bass throughout. Wistful piece for an autumn afternoon as leaves fall. A solo cello melody over soft felt piano, an oboe answering once, distant strings. D Dorian, 60 BPM, tender and reflective. Ends softly.'),
  score('garden-autumn-2', 100, 'Quiet, nostalgic solo piano piece for a cool autumn day: felt piano with gentle falling figures, a soft viola joining late. D Aeolian, 56 BPM, very sparse, silence between phrases. Quiet ending.'),
  score('garden-winter-1', 100, 'Hushed piece for a winter garden under snow. Slow glassy string harmonics, a low warm pad, sparse felt piano: cold air and stillness, solitary but warm at heart. D minor, 50 BPM. Fades away.'),
  score('garden-winter-2', 100, 'Very sparse solo felt piano for a still winter day: a few slow notes and chords with long pauses, soft pedal, close and warm. D minor add9, 48 BPM, calm and tender. Ends on a single held note.'),
  score('garden-night-1', 100, 'Warm, slow piece for a garden at night under the stars. Soft evolving analogue pads, a gentle felt piano playing a few notes, a distant French horn once. D major add9, 52 BPM, peaceful and enveloping. Fades out slowly.'),
  score('garden-night-2', 100, 'Cool, mysterious piece for a moonlit garden. Low sustained strings, soft glassy harmonics, a faint wordless choir far away. D minor, 50 BPM, still and spacious. Fades to silence.'),

  // ------------------------------------------------------------- interface
  //
  // The interface plays the garden's instrument: a few real sounds, each
  // measured for its pitch (\`pitch\`, Hz, per take) so it can be played as
  // any note of D Dorian, through the same soft hall as the music.
  // (A third take of the felt note was a muddle of pitches and was dropped.)
  shot('ui-felt', 2, 1.8, 'One single clean note played softly on an upright piano with a felt mute, the D just above middle C, warm and round with a clear pitch, gentle attack and a natural decay, no other notes.', { tier: 4, influence: 0.75, pitch: [260.5, 261.8] }),
  shot('ui-glass', 2, 2.5, 'A single soft note struck on a small crystal singing bowl, pure, clear and gentle, ringing out.', { tier: 4, influence: 0.65, pitch: [300.8, 300.4] }),
  shot('ui-low', 2, 2, 'A single low note plucked softly on a cello, deep, warm and round, with a gentle resonant ring.', { tier: 4, influence: 0.65, pitch: [145.0, 145.0] }),
  shot('ui-tick', 3, 0.5, 'A tiny soft wooden tick, like one fine wooden bead tapping another, very short, dry and delicate.', { tier: 4 }),
  shot('ui-open', 2, 0.9, 'A soft airy swish of a sheet of heavy paper being lifted and opened, gentle and short.', { tier: 4 }),
  shot('ui-close', 2, 0.7, 'A soft muted fold of heavy paper settling down onto a table, short and gentle.', { tier: 4 }),
  shot('ui-shutter', 1, 0.6, 'The soft, muted mechanical shutter of a vintage film camera, one gentle click.', { tier: 4 }),
  // The L-system view: the garden drawn away to its bare structure, like a
  // lens coming into focus, and back; and the quiet room it is studied in.
  shot('xray-in', 2, 2.5, 'A soft, glassy, crystalline shimmer that sweeps gently upward and resolves into a clear high tone, like light passing through glass and a lens coming into focus; airy, precise and calm.', { tier: 4, level: -2 }),
  shot('xray-out', 2, 2, 'A soft glassy shimmer that sweeps gently downward and dissolves into warm air, like a lens letting go of its focus; calm and airy.', { tier: 4, level: -3 }),
  bed('xray-room', 'A very quiet, warm, airy room tone with a faint, slowly shifting high glassy shimmer far away; abstract, calm and still, like an empty observatory at night.', { tier: 4, seconds: 22, level: -4 }),
  shot('ui-whoosh', 2, 1.2, 'A soft gentle airy whoosh passing by, like a breath of wind, smooth and quiet.', { tier: 4 }),
];

/** The files a spec is played from. */
export function filesOf(spec: SoundSpec): string[] {
  if (spec.kind === 'shot' || (spec.kind === 'music' && (spec.takes ?? 1) > 1)) {
    return Array.from({ length: spec.takes ?? 1 }, (_, i) => `${spec.id}-${i + 1}.mp3`);
  }
  return [`${spec.id}.mp3`];
}

export const SOUND_BY_ID: Record<string, SoundSpec> = Object.fromEntries(SOUNDS.map((s) => [s.id, s]));
