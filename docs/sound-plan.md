# Arbor's soundscape — the plan

A sound layer for the garden, generated once with ElevenLabs, shipped as
files with the app, and played by a small Web Audio engine that follows the
scene exactly: every gain is driven by the same eased values the picture
uses, and every one-shot fires from the same event the picture shows.

Nothing here is generated yet. This is the list of what to make, how, and
how each sound is tied to the app. Mark it up and I will adjust before
spending any credits.

---

## 1. How the sounds are made

**Offline, never from the browser.** The site is static (GitHub Pages), so the
API key must never reach it. A script, `npm run sounds`, reads
`ELEVENLABS_API_KEY` from `.env.local` (git-ignored), walks a manifest
(`scripts/sounds/manifest.ts`), and writes each sound to `public/sounds/`.
It skips anything already made, so re-running only fills gaps; `--only <id>`
and `--takes N` remake one sound or make several candidates.

**Models** (current docs, read 20 Nov 2026):

- Sound effects: `POST /v1/sound-generation`, `model_id:
  eleven_text_to_sound_v3` (v2 is deprecated in March 2027). `duration_seconds`
  0.5–30, `prompt_influence` 0–1 (default 0.3), `loop: true` for seamless
  loops. Billed about 40 credits a second when a duration is given.
- Music: `POST /v1/music`, `model_id: music_v2_5`, `force_instrumental: true`,
  `music_length_ms` 3 s–5 min, or a `composition_plan` of timed sections
  (`/v1/music/plan` drafts one for free). Needs a paid plan (Starter or
  above). Prompts may not name artists or songs.

**Format.** MP3, 44.1 kHz: 128 kbps for music, 96 kbps for beds and
one-shots, which keeps the whole set to roughly 8–10 MB. Files load only when
sound is on and only when the scene needs them.

**Auditioning.** I cannot hear them, so for anything important the script
makes two or three takes, and a small dev-only *sound board* page lists every
sound with its takes side by side, play buttons and a "pick" for each. You
choose; the picks go into the manifest. That is also where you can tell me
"too loud", "too busy", "wrong bird".

**Levels.** Each file's loudness is measured when it is decoded (RMS) and
normalised to its layer's target, so a quiet rain take and a loud one sit at
the same level without anyone having to set gains by ear. The manifest then
only holds *relative* mix choices (birds a touch under the beds, and so on).

---

## 2. How they play

A `Soundscape` class (`src/render/sound/`), one per studio:

```
 beds ──┐
 life ──┤
 weather┤             ┌─► gentle compressor ─► master ─► out
 events ┼─► buses ────┤
 music ─┤  (ducking)  └─ music ducks beds and life by ~5 dB while it plays
 ui ────┘
```

- **Off by default.** A new pebble in the scene switches on the left — a
  speaker, struck through when off — turns it on. That click is also the user
  gesture browsers require before any audio can start. Remembered for next
  time; a return visit with sound on starts it at the first touch.
- **Beds** (long loops) are crossfade-looped by the engine — two copies
  overlapping by a second and a half at each wrap — so even a take whose seam
  is not perfect never clicks, and each starts at a random point so two beds
  never phase against each other.
- **One-shots** come in pools of 3–5 takes, never the same one twice running,
  with a few percent of random pitch and level, panned by where their source
  is on screen and quieter the further it is from the camera.
- **Following the picture.** Every frame the studio hands the soundscape a
  snapshot of the values it is already easing for the picture — night, rain,
  snow, cloud, wind, ice, the season's blend, growth, the pointer in the crown,
  the camera's distance to the pond and the tree — and gains chase them with
  the same time constants. So dusk falls in the ears exactly as on screen, and
  the rain fades in with the drops.
- **Events.** The studio, the birds, the ducks, the fish and the tree emit
  small events (a bird took off, a fish rose, an apple landed) and the
  soundscape answers each at the moment and place it happened.
- **Battery.** The audio context suspends with the tab hidden and while the
  Learn page covers the scene, as the renderer already does.

---

## 3. What to make

`id` · layer · length · loop · takes — **prompt** — what drives it.

### 3.1 Beds — the air of the place (looping, 30 s each)

The bed is the garden's air: always there, quiet, changing with the season
and the hour. Birds and insects that you would *notice* are not baked into the
beds — they are one-shots, so they can follow the actual flock and be counted.

| id | when | prompt |
|---|---|---|
| `bed-spring-day` | spring, day | Open countryside meadow on a mild spring morning: soft breeze over young grass, very distant songbirds far across fields, faint bees, airy and fresh, no music, no voices. |
| `bed-summer-day` | summer, day | Warm summer afternoon in a grassy meadow: lazy insect hum, grasshoppers ticking in the long grass, a gentle warm breeze, distant and sleepy, no music, no voices. |
| `bed-autumn-day` | autumn, day | Cool autumn day in open fields: breeze stirring dry grass and fallen leaves skittering softly, distant rooks very far away, hollow and calm, no music, no voices. |
| `bed-winter-day` | winter, day | Snow-covered field on a still winter day: deep muffled hush, faint cold wind over snow, almost silent, a sense of space, no music, no voices. |
| `bed-spring-night` | spring, night | Spring night beside a small pond: chorus of frogs gently croaking, soft breeze, peaceful and dark, no music, no voices. |
| `bed-summer-night` | summer, night | Warm summer night in a meadow: steady chorus of crickets, a few frogs by a pond, still air, peaceful, no music, no voices. |
| `bed-autumn-night` | autumn, night | Cool autumn night: sparse slow crickets, light wind through grass, a distant dog very far away, quiet, no music, no voices. |
| `bed-winter-night` | winter, night | Freezing clear winter night over snow: near silence, faint high wind, crystalline cold stillness, no music, no voices. |

Driven by: the season's blend weights and `night`. A season change crossfades
over the same second and a half the colours take; dusk over the 1.3 s the sky
takes.

### 3.2 Wind and the tree's own voice (looping, 20–30 s)

| id | prompt | driven by |
|---|---|---|
| `wind-leaves` | A single broadleaf tree's leaves rustling softly in a light breeze, close, gentle swells, no music. | wind × leafiness; swells with the shader's own gust clock, so the sound surges when the crown visibly sways |
| `wind-gale` | Strong gusty wind through a large leafy tree, leaves roaring and branches creaking in surges, no music. | wind above ~1.4 |
| `wind-bare` | Cold wind through bare winter branches, faint whistling and the creak of twigs, sparse, no music. | wind × bareness (winter, or leaves culled) |
| `wind-pine` | Wind sighing through the needles of a tall pine tree, soft whooshing hiss rising and falling, no music. | replaces `wind-leaves` for the pine |
| `rustle-hand` | Hands brushing slowly through the leaves of a small tree, continuous close rustling, no music. | the pointer in the crown: hover strength × how fast it moves (the same numbers that part the leaves) |
| `rustle-twigs` | Fingers brushing through dry bare twigs, delicate dry clicking and scratching, no music. | the same, on a bare tree |

### 3.3 Weather (looping, 30 s)

| id | prompt | driven by |
|---|---|---|
| `rain-light` | Gentle light rain falling on leaves and grass in the countryside, soft and even, no thunder, no music. | rainfall, low |
| `rain-heavy` | Steady heavy rain on a leafy tree and a meadow, dense pattering and dripping, no thunder, no music. | rainfall, high |
| `rain-pond` | Rain pattering on the surface of a small pond, close, many little plinks and drips, no music. | rainfall × nearness to the pond |
| `snowfall` | Snow falling in the countryside: soft muffled hush with a faint whisper of flakes and light wind, very quiet, no music. | snowfall |
| `thunder-far` *(one-shot ×3, 8 s)* | Distant thunder rolling slowly far away over hills, low and soft. | only in heavy rain under a closed sky, rarely — far enough off that no flash is missed |

### 3.4 The pond (looping, plus one-shots)

| id | type | prompt | driven by |
|---|---|---|---|
| `pond-water` | loop 30 s | Gentle water lapping at the reedy edge of a small calm pond, soft trickles, intimate, no music. | camera's nearness to the pond; silent when frozen |
| `fish-plop` | ×4, 1.5 s | A small fish rising to the surface of a calm pond, a soft gulp and tiny plop. | exactly when a fish breaks the surface and its ring starts, panned to it |
| `duck-dabble` | ×3, 2 s | A duck up-ending to feed in a shallow pond, soft splash and water dripping. | the hen tipping up |
| `duck-paddle` | loop 15 s | A duck paddling slowly across calm water, faint soft swishing. | ducks moving, near the camera |
| `ice-sing` | ×4, 3 s | A frozen lake making its eerie singing sound: a high descending ping and twang of ice under tension. | rarely, on a frozen pond |
| `ice-creak` | ×3, 3 s | Thin pond ice creaking and cracking softly as it freezes. | the pond freezing over (as the ice rises) |

### 3.5 Creatures (one-shots)

| id | takes | length | prompt | driven by |
|---|---|---|---|---|
| `dove-coo` | 5 | 3 s | A collared dove cooing softly from a tree, three gentle notes. | perched doves, by day; rate grows with how many are perched |
| `dove-takeoff` | 3 | 2 s | Several pigeons taking off at once from a tree, a clatter of wings. | the flock flushed (a rustled crown, the Shoo button), at the moment they go |
| `dove-wheel` | 2 | 4 s | A small flock of doves flying past overhead, steady whistling wingbeats passing by. | the flock wheeling round the tree |
| `dove-land` | 3 | 1.5 s | A single pigeon landing in a tree branch with a flutter of wings and a rustle of leaves. | each bird settling on a perch |
| `songbird-spring` | 5 | 4 s | A blackbird singing a short melodious phrase from a nearby tree in spring. | spring days, a few a minute |
| `songbird-summer` | 4 | 4 s | A wren singing a bright rapid trill from the hedge on a summer day. | summer days |
| `songbird-autumn` | 3 | 4 s | A robin singing its thin wistful autumn song, a short phrase. | autumn days |
| `chickadee` | 4 | 2 s | A chickadee calling "chick-a-dee-dee-dee", clear and close, in winter. | winter: the chickadee hopping on the snowy stones, when it hops |
| `duck-quack` | 4 | 1.5 s | A female mallard duck quacking softly a few times on a pond. | the hen, now and then |
| `drake-call` | 2 | 1.5 s | A male mallard drake's low raspy quiet call on a pond. | the drake, when he is about |
| `duckling-peep` | 3 | 2 s | Tiny ducklings peeping softly as they paddle after their mother. | spring, while there are ducklings |
| `bee-flyby` | 3 | 3 s | A bumblebee buzzing past close by and away. | spring and summer days, rarely |
| `crow-far` | 2 | 3 s | A crow cawing in the distance across autumn fields. | autumn and winter days, rarely |
| `geese-far` | 1 | 6 s | A skein of wild geese honking far overhead, passing. | autumn, once in a long while |
| `owl-hoot` | 3 | 4 s | A tawny owl hooting softly in the night, far off. | night, not summer, now and then |

### 3.6 The tree

The growth sound is the one I care most about. It is not a clip played when
growth starts — it is a texture whose loudness follows **how fast the tree is
actually growing this instant**, so it swells as the bud is dragged up,
stops when the hand stops, and keeps exact time whatever the growth speed
slider says. Shrinking plays the same texture *reversed*.

| id | type | prompt | driven by |
|---|---|---|---|
| `grow-texture` | loop 12 s | Magical organic growth: soft creaking of living wood stretching, leaves unfurling and rustling, gentle crackle of sprouting, a faint rising airy shimmer, no music, no voices. | the rate of growth: loudness and a touch of pitch; reversed when shrinking |
| `grow-seed` | ×2, 2 s | A seed dropped into soft soil with a soft earthy thump, then a tiny bright sprout sparkle. | a new seed (R), and the start of a replay |
| `grow-bloom` | ×2, 3 s | Leaves settling into place on a tree with a soft rustle and a gentle magical shimmer resolving. | growth reaching 100% |
| `tree-sink` | ×1, 3 s | A small tree sinking back into the earth: soft rustling withdrawal and a low earthy whoosh. | changing species, as the old tree goes back into the ground |
| `leaf-fall` | ×4, 3 s | A few dry leaves falling from a tree and landing softly on grass. | leaves let go (autumn, a shaken crown), the rate following how many fall |
| `apple-thud` | ×3, 1 s | An apple dropping from a tree onto soft grass, a dull thud and small roll. | each apple's actual landing — its fall time is known when it is knocked |
| `berry-patter` | ×2, 1 s | Small berries dropping into grass, light soft patter. | berries landing |
| `cone-thud` | ×2, 1 s | A pine cone falling onto the ground, a woody tap and bounce. | cones landing |

### 3.7 Music — the sky's moments and the welcome

Eleven Music, instrumental, short, and all from one palette (the garden's:
warm, acoustic, a little magical) so they sound like one score. Beds and
creatures duck ~5 dB under them and come back as they fade.

| id | length | prompt (summary) | plays |
|---|---|---|---|
| `music-rainbow` | 16 s | Hopeful, gentle wonder. Harp glissando into celesta and a warm, slow string swell, D major, 70 BPM, airy hall reverb, no percussion. Rises once and fades out. Instrumental only. | as the camera turns to find the rainbow |
| `music-aurora` | 28 s | Ethereal, vast night. Slow evolving analogue pads, soft wordless choir, glassy bell tones, F♯ minor drifting to A major, 56 BPM, long shimmering reverb, no drums. Fades out. | as the camera turns up to the aurora |
| `music-nightfall` | 12 s | Dusk. Solo felt piano, three soft descending chords, low cello under, warm and close, 60 BPM, then silence. | the Night switch |
| `music-daybreak` | 12 s | Morning. Fingerpicked acoustic guitar harmonics and a light wooden flute rising, G major, 84 BPM, bright and fresh. | the Day switch (with the dawn birds) |
| `music-welcome` | 24 s | Cosy, whimsical picture-book garden. Kalimba and soft piano, light pizzicato, G major, 92 BPM, warm and playful, gentle ending. | the welcome card, as the sapling grows |
| `music-tour` | 75 s | Unobtrusive, curious underscore. Soft marimba ostinato, brushed bells, low warm strings, C major, 80 BPM, steady and light, no big moments. Built to loop. | quietly under the tour while it plays itself |
| `music-season-*` ×4 | 8 s each | A brief "postcard" per season, same palette: spring (flute and pizzicato, light), summer (warm acoustic guitar), autumn (cello and piano, wistful), winter (celesta and sleigh-bell shimmer, crystalline). | choosing a season — optional, to judge once heard |

### 3.8 Interface (one-shots, very quiet)

Barely there: the interface should feel like smooth stones and paper, not
like an app beeping.

| id | takes | prompt | on |
|---|---|---|---|
| `ui-pebble` | 3 | A small smooth river pebble tapped softly on another, a single gentle click. | dock and switch buttons |
| `ui-card` | 2 | A sheet of thick paper slid softly across a wooden table. | a card opening |
| `ui-toggle-on` / `-off` | 1 each | A soft wooden pop, rising / falling slightly. | switches |
| `ui-ask` | 2 | A tiny wooden wind chime, one soft note. | a "?" |
| `ui-tour-step` | 2 | A soft page turn in a small notebook. | each tour step |
| `ui-shutter` | 1 | A soft vintage camera shutter click. | Save a picture |
| `ui-copied` | 1 | Two soft rising marimba notes. | link copied |

---

## 4. Budget

About **75 sound-effect files** (~620 s of audio in all; beds are most of it)
and **10 music cues** (~3.5 min). At 40 credits a second, one take of every
effect is ~25,000 credits; two takes of the beds and the important one-shots
roughly doubles that. Music is about 3.5 minutes a pass, inside a Creator
plan's allowance with room for retakes. Free-plan music has no API, so the
music needs Starter or above; on a free plan I would make the musical
moments with the sound-effects model instead, which v3 handles reasonably,
up to 30 s.

## 5. Build order

1. Generation script, manifest, and the sound board for auditioning takes.
2. Engine, the sound switch on the left, the beds (season × hour, weather,
   wind, pond), following the eased scene values.
3. Creatures: birds, ducks, fish, the chickadee, insects, the owl.
4. The tree: growth texture following the growth rate, seed, bloom, sinking,
   rustle under the pointer, falling leaves and fruit landing on time.
5. Music for the sky's moments, the welcome and the tour, with ducking.
6. Interface sounds, very quiet; a volume slider in the Look card; a stop in
   the tour for the sound switch; the README.

Each step is its own commit, and each one is playable before the next.

## 6. Questions for you

- Which ElevenLabs plan is the key on? (Decides the music.)
- Sound on by default after the first visit's welcome, or always off until
  switched on? (Plan above: off until switched on, then remembered.)
- Any sounds you definitely want or definitely don't (thunder, interface
  clicks, music under the tour)?
