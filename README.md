# Arbor

**A tree you grow from a sentence.**

Arbor is a tree-growing studio built on parametric L-systems and rendered with
three.js on WebGPU. You pick a species and it grows from a seed. You rewrite its
grammar and the tree rearranges itself. You shake its crown and the doves leave; turn the
sound on and you hear them go. Everything on screen, down to the bark furrows
and the stars, is generated.
There isn't a single texture file in the project.

**Try it:** [eliaboutorabi.github.io/trees](https://eliaboutorabi.github.io/trees/)
— needs a WebGPU browser (recent Chrome, Edge or Safari).

```bash
npm install
npm run dev
```

This README is a tour of how it works, and of the many ways it didn't work
first. If you only read one section, read
[The hall of things that lied](#the-hall-of-things-that-lied). If you'd
rather learn to *write* trees, open the Grammar card and press **Learn to write
a tree** (see [The Learn page](#the-learn-page)).

---

## A tree in five acts

```
 grammar ──► word ──► skeleton ──► meshes ──► motion ──► pixels
   text      string    turtle     worker      GPU       post chain
```

### Act I: a sentence

A tree starts as a few lines like this:

```
A(s) : s > 0.2 @ 0.6 -> F(LEN*s) [ +(ANG) A(s*SHRINK) ] -(ANG) A(s*SHRINK)
```

It reads: *"A shoot of size `s`, if it is still bigger than 0.2, has a 60%
chance to grow an internode, then split into two smaller shoots at the branch
angle."*

Every symbol in the word is rewritten in parallel, generation after
generation, until a few characters have become tens of thousands. The language
is a real parametric L-system:

- conditions;
- stochastic variants;
- arithmetic in the parameters, compiled once rather than re-parsed per module.

The grammar you edit in the Grammar card *is* the grammar that grows the tree.
There's no hidden second model. See [Writing grammars](#writing-grammars).

### Act II: a turtle walks it

A 3D turtle reads the finished word left to right. `F` draws an internode, `+`
turns, `[` remembers where it was and `]` goes back. Tropism bends each shoot
toward the sky or the ground as it goes.

Branch thickness isn't taken from the grammar. Radii are recomputed bottom-up
with **da Vinci's pipe model**: a limb is as thick as its children combined. The
*Taper* slider is the exponent.

The pipe model only changes a radius where a branch leaves, so on its own a
clear trunk comes out as a post, as thick at head height as at the ground. So
each node is also thickened by how much tree there is beyond it: the longest
path out to a tip, as a fraction of the whole tree's. Every year's growth is a
new sheath laid over everything below it, so the oldest wood carries the most
rings. Every path still thins steadily outward, and no child is ever thicker
than its parent.

### Act III: meshes, off the main thread

The skeleton becomes:

- tubes of bark, drawn through their nodes as smooth curves;
- leaf blades with their outline baked into the geometry (no alpha test);
- the foot of the tree: flare, buttresses and roots as one surface (see
  [How the roots work](#how-the-roots-work));
- flower and fruit sites;
- a list of **perches**: real twigs, thick enough to grip and level enough to
  sit on, toward the outer crown where birds actually sit.

A leaf-area voxel grid and Beer–Lambert give each leaf how much sky it can see.
Without that a canopy reads as one flat green mass, however many leaves you
throw at it.

All of this is a few hundred milliseconds of pure arithmetic (650 ms for the
pine). On the main thread it froze the wind, the birds and the camera every
time you changed species. So it runs in a **worker**
([`engine/build.ts`](src/engine/build.ts)): parameters in, buffers out,
*transferred* rather than copied. The main thread only wraps the buffers in
meshes.

### Act IV: everything moves, and the CPU barely notices

The mesh is built once, **fully grown**. Then one TSL vertex program
([`materials/shared.ts`](src/engine/materials/shared.ts)), shared by bark and
leaves, does the rest:

- **Growth** is a wavefront. Each vertex knows its birth time and the point it
  sprouts from. Until the wavefront reaches it, it is collapsed back onto that
  point. Scrubbing growth is one uniform write, and the shadows grow with the
  tree.
- **Wind** is two nested rotations, never a translation. See
  [How the wind works](#how-the-wind-works).
- **Your pointer** parts the canopy. Nothing is ever "selected"; see
  [Hovering the canopy](#hovering-the-canopy).
- **Birds** sitting in the crown push the leaves aside so you can see them (see
  [Making room for doves](#making-room-for-doves)).
- **Leaves fall** in autumn on a queue of release times. They drop at
  terminal velocity (about 1 m/s, ±30%, so a shower doesn't fall as a sheet),
  drift with the wind, settle in the grass, and shrink away when the tree
  regrows.

An animating tree costs the CPU the same as a still one: a handful of uniform
writes a frame.

### Act V: pixels

```
 shadow map ─┐
 sky ────────┼─► scene pass (4× MSAA) ─► bloom ─► depth of field ─► grade ─► grain
 aurora ─────┘
```

Edges come from the GPU's multisampling, not from a filter at the end. FXAA
guessed at edges from the finished picture. On a grass blade one pixel wide it
couldn't tell an edge from detail, so the whole meadow crawled whenever the
camera moved. Four real samples per pixel hold still.

The depth of field is home-made and has a story of its own:
[The flowers that twinkled](#the-flowers-that-twinkled).

---

## How the wind works

Leaves visibly passing through each other is almost always a symptom, not the
problem. Collision detection between tens of thousands of leaves isn't
affordable in real time, and it isn't what fixes this. Three things are:

1. **Rotate, don't translate.** Branches bend by rotating about the tree's base,
   which preserves their length. Pushing vertices along a wind vector stretches
   the geometry instead of bending it.
2. **The bend weight must be smooth in space.** It is driven by *height*, not by
   distance along the branch. Height is continuous, so two pieces of geometry
   near each other always bend by nearly the same angle and can't scissor apart.
   Arc length is *not* continuous in space: a twig tip and the limb it hangs
   from can share a location while being metres apart along the branch, and
   weighting by arc makes them tear through one another.
3. **Anchor leaf motion at the stem.** Each leaf turns about its own attachment
   point, so however hard the wind blows it can never travel further than its
   own length. It also inherits the bend weight of the twig carrying it, or it
   slides along the branch and shears through its neighbours.

Gusts change speed without lurching because the sway runs on an
**integrated** phase. The host adds `windSpeed × dt` each frame. Swaying on
`time × speed` instead makes every branch jump to another point in its swing
the instant the speed changes.

Rule 2 has one exception, and the willow found it. Weight by height and a
shoot hanging from six metres to one gets a one-metre weight at its tip: the
branch sways while the tip stands still, a curtain pinned to the lawn and
waving from the bottom like weed in a current. So a node never bends less than
the wood it hangs from, and anything below where it began to fall carries a
**pendulum length** ([`sway.ts`](src/engine/sway.ts)). The shader blows it
downwind by that length times its support's lean, and lets it wander across
the wind on a slow beat phased by *place*, so a shoot and the leaves on it
(same place, different seeds) keep time. The pendulum rides in the same float
as the bend weight, in the even integers, because all eight vertex buffers
WebGPU guarantees are already taken.

## How the roots work

Roots used to be tubes: eight-sided pipes poking out of a cone-shaped flare.
That gets every part of a root wrong at once. A tube has an underside, a round
end and a seam where it meets the trunk, and it lies on the lawn like a
dropped log. Look at a real tree in grass and the roots are the ground's own
relief: rounded ridges that swell out of the trunk, run a metre or two and
sink back under the soil.

So in [`roots.ts`](src/engine/roots.ts) they're a **heightfield**. Each root is
a meandering path that carries a crest height and a width. The crest is high
where it leaves the trunk and falls as `h₀ − (h₀ + dive)·tᵖ`, with `p` chosen
so it hugs the ground for a while before going under. Big roots fork, small
ones fill the gaps, and the field is their smooth maximum. That's what lets a
fork part from its parent as one swelling, not two ridges crossing.

The trunk's foot and that field are a single sheet, swept column by column
round the trunk: down the wall, round a fillet, out along the field until it's
well under the soil. The fillet is the exact zero set of a quadratic smooth
minimum of the two surfaces it joins, so it meets both with matching slope.
Over a root's crest it's wide and climbs the trunk, which is the buttress.
Between roots it's tight and happens underground, and the trunk simply enters
the soil. The sheet's first row *is* the trunk tube's last ring, so there's no
gap to hide. The bark's grain runs on down the profile, so it follows the
trunk into each root. Where wood meets soil it darkens and takes the soil's
colour.

## Hovering the canopy

Move the pointer over the tree and the foliage near it parts, turns on its
stems and brightens slightly. The trunk ignores you.

The instinct is to raycast for the leaf under the cursor. That is wrong twice
over:

- Growth and wind both move the geometry in the vertex shader, so the triangles
  a CPU raycast tests aren't the ones on screen.
- Picking a *surface* makes the response snap from leaf to leaf as the cursor
  crosses gaps.

So the pointer contributes one world-space point, and the response falls off
smoothly with distance from it. Thousands of leaves each answer a little, and
the effect slides across the crown. Three details make it hold together:

- **Weigh at the leaf's pivot, not at the vertex**, so a leaf moves as one
  rigid piece and stays on its twig.
- **Put the pivot through the wind rotation first**, or a gusting canopy
  responds where it *used* to be.
- **Take stiffness from the distance to the branch axis.** That is the branch
  radius, so twigs stir and the trunk doesn't, with no extra attribute.

Aim at the closest approach to the *trunk axis*, not a bounding sphere. A
bounding sphere is mostly air, and on an oak it put the target a full crown
radius outside the leaves. Ease the point and strength with an exponential
chase, so the response takes the same wall-clock time at 30 fps as at 144.

Rustle hard and it becomes a shake: fruit drops, autumn leaves let go, and the
doves go up.

## Making room for doves

Doves of four kinds live on the tree, a dozen unless you say otherwise (see
[The Wildlife card](#the-wildlife-card)):

- sitting on real perches and swaying with the twig under them;
- walking and pecking in the meadow;
- crossing between branches on Catmull–Rom flight paths;
- wheeling round the crown together when you startle them.

On the wing a dove beats in short runs and glides on wings held in a shallow V.
It banks into turns and fans its wings to brake as it lands. On a branch it
folds them and turns its head in small quick jerks.

The whole flock is **one draw call**. The birds are merged into a single mesh,
each vertex tagged with its bird and body part. Each bird's position, attitude,
wing pose and head pose are four `vec4`s in uniform arrays that the vertex
shader reads.

There's a catch. A crown is a shell of leaves right out to its edge, so any bird
on a twig is hidden by foliage from everywhere. Real birds deal with that by
pushing into the leaves, and these do too. Each perched bird is a **guest**: a
capsule from its seat out toward open air, inside which leaves fold back toward
their stems. The loop runs only over the guests actually there, because it
executes for every leaf vertex in the shadow pass as well as the picture.

## The Wildlife card

The dock's Wildlife card is the garden's field guide. Each creature has:

- **a portrait** that moves while the card is open: the dove's wing beats from
  the shoulder, the butterfly's wings close and open, the duck rides a slow
  swell;
- **a line saying what it's up to**, so a slider set to twelve with nothing in
  sight explains itself ("Gone to roost — back at first light", "Not in winter
  — they come back with the flowers", "Gone while the pond is frozen — a robin
  comes instead");
- **how many and how big**, as picture sliders side by side: up to 24 doves,
  60 butterflies and 6 ducklings on the pond (see [The pond](#the-pond)).

The doves also get a **Shoo** button, which puts them up to wheel round the tree.

None of it rebuilds anything.

- **Doves.** The whole flock of 24 is built once, and a population says how
  many come. One no longer wanted flies off from wherever it is; new ones
  arrive over the next few seconds, one after another, rather than landing in a
  block. A bigger bird opens a bigger window in the leaves, but not in
  proportion: its body grows, the twig it sits on doesn't.
- **Butterflies.** All sixty are baked into the meadow, each with its place in
  the line, and a count uniform walks along it on the GPU. One past the count
  shrinks away about its own middle. The count moves about eight a second, so a
  big change has them come out, or go, one after another. Species are dealt out
  in turn along the same line, so any number is as varied as it can be. The
  place in the line rides in the spare lane of an attribute that was a `vec3`,
  because the mesh already uses seven of WebGPU's eight buffers.

The wildlife settings belong to the garden, not the tree: they stay put when
you change species or season, and they travel in a shared link.

## The pond

A small one, a few strides across, to the right of the tree and a little
behind it, its near end tucked behind the trunk. It's the most game-like corner
of the garden and the one most made of tricks.

**One outline, many jobs.** The pond is an ellipse whose edge wanders on three
slow harmonics, so it is kidney-shaped. As a function
([`pondShape.ts`](src/render/pondShape.ts)), that outline:

- carves the hollow into the ground: a bank down to just under the water, then
  on to the bed;
- keeps grass, tussocks, flowers and stones out of the water;
- sends the doves round it rather than through it;
- turns the bank to mud, wet and dark toward the water;
- tells the water how deep it is at every point.

That last one makes the shore. The water fades out over its last few
centimetres of depth, worked out from the outline rather than read back from a
depth buffer. So the edge is a soft wet line along the bank, however coarse the
ground mesh under it.

**The mirror** ([`reflection.ts`](src/render/reflection.ts)). A second camera,
reflected through the water, renders the scene into a small texture, and the
water lays it over itself where the ripples push it. A planar mirror is exact
for a flat pond, and it costs about half a millisecond, for four reasons:

- it runs at half the screen's resolution;
- grass, flowers and rain are hidden for the pass;
- there's no sky in it, since the water's own lighting already reflects the
  sky, so the pass clears to transparent and only lays on what stands in front;
- it's skipped entirely while the pond is out of view.

One physics lesson the pond teaches: **a reflection only shows in water between
you and the thing**. From the opening view the pond is behind the tree, so it
mirrors the hills; walk round it and the tree stands in it.

**The year on the water** ([`pondSurface.ts`](src/render/pondSurface.ts)):

| Season | On the water |
| --- | --- |
| Spring | Lily pads come up one raft at a time; a few flower |
| Summer | Every pad out, with pink water lilies open on them |
| Autumn | Pads brown, flowers gone; the tree's own leaves wander on slow currents |
| Winter | Frozen from the bank inward: frosted white at the rim, dark clear ice in the middle, long cracks, snow drifting on |

What floats drifts by the pond's own clock, which stops while it is frozen. A
leaf the ice catches stays caught, and moves on from the same place when it
thaws.

**Rain** pocks the surface with rings, on two offset grids of cells, each with
its own clock, so they never fall in step.

**The bank** ([`pondShore.ts`](src/render/pondShore.ts)) has ten boulders,
mossy where they face the sky, dark where they're wet, and capped with snow in
winter. Reeds and cattails stand in the shallows. They go to straw-gold in
autumn and stay up through the snow, as reeds do where the grass is buried.

**The creatures** ([`pondLife.ts`](src/render/pondLife.ts)):

- **Mallards.** A pair in spring with just-hatched ducklings, the hen and her
  half-grown brood in summer, the pair again in autumn. The hen paddles a loop
  and stops now and then to up-end and dabble. The ducklings follow her actual
  wake, a little further back each, so they bunch up when she stops and string
  out when she sets off. Every duck trails a V in the water at nineteen and a
  half degrees either side, as wakes do on any water.
- **A robin.** When the ice closes, the ducks slip under the water rather than
  vanishing on the surface, and a robin comes to hop between the snowy tops of
  the stones.
- **Red fish** ([`pondFish.ts`](src/render/pondFish.ts)): goldfish and a few
  red-and-white koi. They have no meshes. A fish under the surface is only
  ever seen *through* it, so the water's own shader draws them. The view ray
  bends as it enters the water (Snell's law, through the rippled surface, so
  they shimmer as ripples pass), then carries on down to each fish's depth.
  That's why a fish slides against the surface as you walk round the pond,
  and why the glare of a glancing view hides it. Each sends a wave down its
  body as it swims and lays a soft shadow on the bed, along the sun's
  bent ray. They wander, school loosely, dart and glide, shy from a passing
  duck, and now and then rise to kiss the surface, leaving a ring. Hold the
  pointer over the water and they come and mill about under it. Under the
  ice they sink to the bottom and barely move till spring.

The whole pond — water, mirror, bank, lilies and ducks — costs about 1.2 ms a
frame.

## The world around the tree

**The sky is one expression, used twice.** It is a TSL node drawn as the
background *and* rendered into a 96 px cube map for image-based lighting. The
sky you see and the sky lighting the tree can't disagree, because they are the
same code. It used to be a 128 ms CPU bake. That was slow, and once it was also
mirrored. See [the hall](#the-hall-of-things-that-lied).

**The sun's colour is derived, not chosen.** It comes from atmospheric
extinction:

- Kasten–Young air mass;
- Rayleigh optical depth per channel (`0.0088 · λ^-4.15`);
- an aerosol term driven by the haze slider.

A low sun reddens because its light crosses 38 atmospheres, not because a
`lerp` says so. Full extinction over-reddens (it models light *removed* from the
beam, not light scattered back in), so transmittance is raised to 0.75 to stand
in for multiple scattering.

**The rainbow is real geometry:**

- centred on the antisolar point;
- primary bow at 40.6–42.4°, violet inside;
- secondary at 50–53.6° with its colours reversed;
- the sky brighter inside the primary;
- Alexander's dark band between the two.

That means there is no rainbow with the sun above 42°, which is true and
occasionally disappointing.

**At night the rainbow button becomes an aurora**, because a rainbow by
moonlight is mostly theory. The aurora is a stack of slices through warped
"triangle" noise. Its colour follows altitude as the real one does:

| Altitude | Colour | Source |
| --- | --- | --- |
| Lower edge | Magenta fringe | Nitrogen |
| Body | Green | Oxygen, 557.7 nm |
| Top | Red | Oxygen, 630 nm |

It is drawn at half resolution into its own texture, blurred, and laid over
the sky. Sharp, every fold of the noise looked like a pattern; soft, it reads as
light in thin air. It is also the most expensive shader in the scene, so it is
compiled in the background the first time you ask for it.

**Night** also brings:

- a moon with seas and a darker limb;
- stars hashed into cells on the sphere, twinkling slowly and thinning toward
  the horizon;
- the faint band of the Milky Way;
- 140 fireflies, every one animated entirely on the GPU.

**The ground** is a polar grid that bunches vertices near the tree, with real
terrain relief. A flat disc makes an orbit look like a turntable; hills give
the eye a silhouette to move *against*. The near field is dense with things
that make parallax:

- grass clumps;
- tussocks;
- wildflowers that sway on the same wind uniforms as the tree;
- butterflies that land on the *actual* flowers, because the scatter that
  places the meadow hands its positions to their flight paths;
- a distant treeline: three silhouettes clumped into stands that follow the
  land, because a uniform scatter of identical shapes reads as an orchard at
  best and as wallpaper at worst.

Grass works because of two tricks from games:

- **Blade normals point up, not out.** A true blade normal is nearly
  horizontal, faces away from a low sun, and renders black.
- **Darkness comes from the root**, as one gradient multiply that fakes
  self-shadowing in the clump.

**Weather and seasons.**

- *Snow* is a GPU-only mesh. Each flake's horizontal drift is driven by the same
  `fract` that wraps its fall, so it returns to its own column the instant it
  respawns. Drive drift off `time` instead and the snowfall slowly walks off
  the scene.
- *Rain* soaks every surface in seconds and takes far longer to dry.
- *Seasons* aren't a dimmer on summer. Each is a full table of light, ground,
  foliage, weather and wildlife
  ([`render/season.ts`](src/render/season.ts)). A winter sun is low *and* weak
  *and* its sky is brighter than its beam; an autumn one is strong, very low and
  very warm. Interpolating between a "summer" and a "winter" number would give
  neither.

## How the garden sounds

The speaker at the bottom of the left column turns the sound on (it is off
until asked for, then remembered). Hover it and a little mixer comes out:
how loud in all, and each part on its own. What you hear is the scene, not a
soundtrack over it, and **every sound comes from where it is**: the ears are
the camera's, so turning round the tree turns the garden round you.

- **The air of the place**: eight beds, one per season by day and by night
  (the muffled hush of snow, a summer night's stillness), crossfaded on the
  same eased values the picture uses, so dusk falls in the ears as it falls on
  the screen. Over them, the places, each heard from where it is: frogs in
  the pond's reeds as the light goes, insects in patches of long grass by day
  and crickets by night, and the distant woods with the season's birds, or
  an owl's quiet.
- **The wind in the tree**: leaves, bare twigs, pine needles, and a gale over
  the top. Which one you hear depends on how much of the crown is in leaf and
  whether it is a conifer. The level swells with the gust computed from the
  *same three sines the crown sways to*, so the sound rises as you see the
  branches bend.
- **Weather and water**: light and heavy rain, rain on the pond, falling snow,
  far thunder in a downpour under heavy cloud. The pond laps louder the nearer
  the camera stands, goes silent when it freezes, and creaks as the ice closes
  over.
- **Creatures**: doves coo from the crown, a dove is heard braking in just
  before it is on its twig, and a flock clatters up when you shake it. A
  fish's rise is a plop at its ring, the hen dabbles, ducklings peep, the
  winter robin calls from the stones. A bumblebee goes past from one ear to
  the other, geese cross high overhead in autumn, and songbirds, crows and
  an owl keep their seasons and hours, each from somewhere.
- **The tree**: growing has a sound that runs as fast as the growth and plays
  backwards when it shrinks, so scrubbing the stem scrubs the sound. A seed
  goes in, the crown settles, an old tree sinks. A hand moving through the
  leaves rustles them. Fruit you knock down **lands when it lands**: the tree
  reports how long each fall takes from the same constants its material
  draws the fall with, and the thud is scheduled for that moment, apple, berry
  or cone by the fruit's shape.
- **A score, all in D.** Every piece is in one voice: felt piano, cello,
  strings, glass harmonics, a distant horn, a large soft hall. It's
  bittersweet and grown-up, never cute, and in D through its moods: Dorian
  for the wistful, Aeolian for rain, Lydian for spring, major for summer,
  minor for winter and dusk.
  - **Change something and a little music comes in**: a season arriving,
    rain, snow, a clearing sky, a different tree growing. It waits until
    you've settled, so flicking through four seasons gives one piece, for
    the one you stopped on. When changes come together (winter brings
    snow), the one that matters most is heard.
  - **The sky's moments** (dusk, dawn, a rainbow, the aurora) have music
    of their own, and so do the welcome and the full tour.
  - **The garden's own pieces** come and go between them: two per season
    and two for the night, now and then, with long rests, the way music
    comes and goes on a walk rather than playing over it.
- **The interface is an instrument.** Every gesture is a quiet note of the
  same D, through a soft hall:
  - a row of choices is a scale, so choosing is playing;
  - a switch rises a third coming on and falls going off;
  - a slider ticks as it travels and settles on the note of where it
    stopped;
  - a card comes up with paper and its own note, so running the pointer
    along the dock is an arpeggio;
  - the tour climbs the scale a step at a time.

### The engine

[`render/sound/soundscape.ts`](src/render/sound/soundscape.ts) is a small Web
Audio graph: buses for the air, the weather, the tree, the creatures, music
and the interface, through a gentle compressor. The studio does two things for
it. Each frame it fills in a snapshot of what it is already easing for the
picture. And everything that *happens* in the scene, a dove leaving a twig, a
fish rising, a fruit let go, is reported through one small event channel
([`render/events.ts`](src/render/events.ts)) with where it happened. The
creatures know nothing about sound; they just say what they did. Where it
happened becomes a pan (which side of the view it is on, behind the camera
included) and a level (how far it is, relative to the point the camera is
looking at).

- **Places, and ears.** The studio tells the engine where the crown, the
  pond, four patches of grass and three stands of the far treeline are, and
  every frame where the camera is and which way it looks
  ([`sound/space.ts`](src/render/sound/space.ts)). A long sound plays from a
  place's points through a pan, a level for its distance, and a gentle
  low-pass for whatever is behind you: the cheapest front-from-back cue
  there is, and cheap is the point, since these never stop. One-shots,
  which are short, get the browser's HRTF panner, and a few travel along a
  path while they play, their level swelling as they pass.
- **One sound from several places.** A loop played from three points round
  the crown starts each copy somewhere else in the file. The copies don't
  line up, so they're heard as one wide sound rather than one sound three
  times, and each is turned down so together they are as loud as one.
- **Loops cross over themselves.** A long sound plays from a random point and
  crossfades into a fresh copy a second and a half before it ends, equal-power.
  A take whose seam isn't perfect never clicks, and two beds never phase.
- **One-shots come in pools.** Several takes per sound, never the same one
  twice running, each a few percent off in pitch and level, stored mono since
  they are panned anyway. A burst of the same event, a whole flock going up in
  the same half second, is one sound, not twelve.
- **Handfuls, not every leaf.** Autumn sheds a few leaves a second all day.
  A count that leaks away over a second only speaks past half a dozen, so the
  trickle stays quiet and a gust or a hand in the crown is heard.
- **Your levels, and what's happening.** Each layer passes through your
  level for it, then through the ducking under music, then the compressor.
  The mixer's meters tap each layer after both, and only while it is open.
- **Nothing is fetched until sound is on**, a long sound's audio is let go a
  minute after it falls silent, and the context suspends in a hidden tab. The
  loops are fed on a clock of their own, so they carry on, quieter, under the
  Learn page while the scene is paused.

### The interface's instrument

[`sound/ui-voice.ts`](src/render/sound/ui-voice.ts) plays a handful of
recorded-sounding sounds as notes: a felt piano note, a small glass bowl, a
low cello string. Each was measured once for its pitch, from its strongest
partials, and the pitch is written beside its prompt in the manifest. Any
of them can then be retuned exactly to any degree of D Dorian. A note that
would land more than about an octave from where the sound rings is folded
by an octave instead: the same note, without turning a bowl thin or a
piano into a toy.

[`app/sonic.ts`](src/app/sonic.ts) is the interface's side. Components call
it for what only they know: a card's place in the dock, a tour step, a
picture saved. Everything else is heard by one listener on the page:
sliders moving and let go, choices in a row (tiles, segments, colours),
switches. A control added later is heard without being told to.

The interface's layer goes through a hall made rather than recorded: two
channels of noise dying over three and a half seconds, darker as they die,
after a short pre-delay. That is what gives a single quiet note somewhere
to be.

### Where the sounds came from

Every sound was made with [ElevenLabs](https://elevenlabs.io): Sound Effects
v3 for the beds and one-shots (asked for as seamless loops where they loop),
and the Music model for the cues and the garden's pieces.
[`render/sound/manifest.ts`](src/render/sound/manifest.ts) lists each one with
the prompt that made it, its length, its number of takes and its place in the
mix, so the prompt lives beside the code that plays it.
[`scripts/sounds/generate.ts`](scripts/sounds/generate.ts) walks that list:

```bash
npm run sounds -- --dry                  # what would be made, and roughly what it costs
npm run sounds -- --only fish-plop --force
npm run sounds -- --tier all --process   # re-level everything from the cache, free
```

It reads `ELEVENLABS_API_KEY` from `.env.local` (git-ignored) and keeps what
comes back untouched in `.sound-cache/`. It trims one-shots so they sound the
instant they're triggered, measures each file's loudness (EBU R128) and brings
it to its layer's level with a plain gain. A compressor would disturb a loop's
seam. On the dev server, [`/sounds.html`](sounds.html) is a board of every
sound and take with its prompt, for listening through them.

### Things the sounds taught

- **You can check a sound you can't hear.** Spectrograms show a loop that is
  three seconds of silence before it starts (the first growth sound was, and
  growth only lasts three seconds), a bed with a loud landmark that would come
  round every twenty, or music that isn't in the key it was asked for. Steady
  tones turned up at 16–20 kHz in most takes: measured, they sat 40–50 dB under
  the content, so they were left alone.
- **The slider's middle is not the default.** The wind runs to 1.5 and a
  summer breeze is 0.35, so the first mapping, which treated 1 as an ordinary
  breeze, put the tree's voice at a third of what it should have been.
- **A realistic flock is a racket.** The doves come and go between grass and
  twigs all day. A flutter for every landing was one a second. Now each dove
  has a voice of its own, most of them quiet, and is heard braking into the
  crown rather than arriving on the grass. Only a flock put up by a hand
  gets the clatter, and it gets it once.
- **The first mix was too loud, everywhere.** Everything now sits 6 dB under
  it, the mixer lets each part go quieter still, and fish, ducklings and
  doves were all thinned out.
- **Ask for a key, then check it.** Music asked for in D mostly came back
  in D, but not always: rain in A and in G sharp, a spring piece in E,
  autumn twice in F sharp minor. Each piece's average chroma, correlated
  with the major and minor key profiles, says which key it is really in.
  The strays were made again with the key named first, and the last one
  with "begins and ends on a D minor chord, D in the bass throughout".
- **Measure a note before you tune it.** A felt piano note asked for "in
  the middle register" came back as a thump with a stray 1.4 kHz ring.
  Asked for by name ("the D just above middle C") it came back as a C,
  but a clean one, which is all that tuning needs.
- **Two at a time.** The plan allows two requests in flight. The script
  waits and retries when told it is asking too fast.

## Changing your mind, smoothly

Nothing snaps:

- sun, haze, night, seasons, wind bearing and the rainbow all ease toward their
  targets each frame;
- the camera glides;
- the UI's colours are registered CSS `@property` values, so even an icon's tint
  animates.

Rebuilding the tree is the hard case. It has two answers:

- **Morph.** Branch angle, internode length and droop don't change the
  derivation: same branches, same leaves, same order, only placed differently.
  The two meshes match vertex for vertex, so the old shape is handed to the GPU
  as a **morph target** and every vertex travels to its new home. three keeps
  morph targets in a texture rather than vertex buffers, which matters because
  the leaf mesh already uses seven of WebGPU's eight.
- **Dissolve.** When the structure really changes (more generations, a new
  species), the meshes can't be matched. The old tree dissolves out by a
  stipple while the new one dissolves in. The new one was built in the worker
  meanwhile, so the wind never stops.

## The interface

The UI aims at a game rather than a settings panel:

- **a dock of pebbles** along the bottom, each opening a card;
- **a column of scene switches** on the left (orbit, focus blur,
  rainbow/aurora, night);
- **a growth stem** on the right that you drag up to grow the tree and down to
  ungrow it.

Two pieces are hand-made:

- **Hand-drawn glyphs** ([`glyphs.ts`](src/app/components/glyphs.ts)). Every
  icon is strokes on a 24×24 grid, inked like a field notebook: curves slightly
  uneven, nothing quite mirrored, a soft colour wash under the line.
- **Hand-cut cards** ([`paper.ts`](src/app/components/paper.ts)). Each card's
  outline is a rounded rectangle whose four corners are each rounded
  differently, with slow uneven waves along the sides. It is used as a CSS mask.
  It is drawn at the card's real pixel size, because the first version stretched
  a 100×100 path to fit and squeezed some corners into points. A string seed
  keeps each card the same shape every time it opens.

One trap worth knowing: **a parent's `opacity` kills `backdrop-filter` in its
children.** Opacity below 1 makes the parent a backdrop root, so a frosted card
fading in rendered unfrosted for its first frames, then *snapped* frosted. The
cards fade their layers individually through a registered `--fade` property
instead.

### Welcome, the tour, and the map

A first visit opens a small paper card over the garden
([`Welcome.svelte`](src/app/Welcome.svelte)). A sapling draws itself on it,
trunk first and then branch by branch the way the turtle grows a tree, and
leafs out. It says what this is and who made it, and offers to **Show me
around**.

The tour ([`tour/`](src/app/tour)) dims the scene and walks through every
part of the app with a spotlight and a card beside it. It covers the top row,
the scene switches, the growth stem, every card in the dock (opened as it is
described) and what the tree and the pond do when touched. Some details:

- **The spotlight is one box with an enormous shadow.** The shadow is the dim,
  so moving to the next part is a single eased slide of position and size. Its
  ring breathes so the eye finds it.
- **What's under the spotlight still works.** A transparent layer holds the
  rest of the scene still, clipped with an even-odd polygon so the spotlit
  window lets the pointer through. You can try the switch you're reading about.
- **Targets are named, not positioned.** Each step points at a `data-tour`
  attribute on the element itself and measures it every frame, so a card
  rising into place is followed while it moves. The tree and the pond aren't
  elements, so the studio projects their bounds through the camera
  (`screenBox`) and the spotlight lands on them in the scene.
- **It's told in chapters.** Every part can be played on its own. A small
  warm **?** opens the tour at exactly that part: in the heading of every dock
  card, and on the glassy labels along the top, down the left and on the
  growth stem. A folded-map button at the top lays every part out as a plot to
  pick from, with a banner to take the whole walk.
- **The whole walk plays itself.** Each stop stays for about twice its reading
  time, a fine line filling under the words. Resting the pointer on the card
  holds it, and the arrow keys and Esc work throughout.

---

## Performance, or: it was never the tree

The app felt slow, so we measured. Every intuition about why was wrong.

**The battery.** On a MacBook below 20% charge, the GPU is throttled roughly
3–4×. The same build that holds 60 fps at four times the screen's pixel count
on mains power drops to the low 20s at native resolution on battery. Arbor
notices: on battery and under a fifth of it, it caps itself at 30 fps and 1.5×
density.

**The frosted glass.** This was the biggest single cost in the frame, and it
isn't WebGPU at all. The browser re-blurs the moving 3D picture behind every
`backdrop-filter` element, **every frame, one element at a time**. It does that
at the display's full density, whatever resolution the 3D picture is rendered
at. That's why the resolution governor's drops barely helped.

There were 34 frosted elements on screen, costing about **15 ms a frame**
throttled: more than the grass, the tree or the depth of field.

- The ten dock pebbles were 14 ms of that, and their own colour covers almost
  all of their frost. They're unfrosted now; side by side, nobody can tell.
- Fourteen more were *invisible* tooltips. An invisible frost still costs a
  blur a frame, so they are now frosted only while they show.

**The sky worked out everything, everywhere.** Every pixel of sky was computing
stars, the Milky Way, the moon's seas, a cloud layer and a rainbow: by day,
under a clear sky, multiplied by zero. These are now TSL `If` branches on
uniforms. A uniform is the same for the whole frame, so skipping costs nothing.
Sky-only frame rate went from 12.7 to 24 fps.

**The aurora was drawn at full resolution.** It now runs for a quarter of the
pixels (see above), and its frame cost dropped from halving the frame rate to
noise.

**The resolution governor** works in 2.5-second spells:

- below about 40 fps it steps the render scale down;
- if a step didn't make frames faster, it puts the resolution back and waits 90
  s before trying again — the GPU wasn't the bottleneck, so a softer picture
  buys nothing;
- multisampling goes last.

**Smaller wins:**

- Depth of field gathers its fields straight at half resolution.
- The leaves loop only over perched birds, not all sixteen guest slots.
- The shadow map is redrawn at most 30 times a second. It doesn't depend on the
  view, so turning the camera never needs a new one.

Profiling aids: with the dev server running, add `?profile` to the URL for GPU
timestamp queries, then call `arbor.gpuTime()` and `arbor.gpuPasses()` from the
console.

### How frame-time measurement lies

Each of these produced a confident, wrong conclusion here before it was caught.

**The vsync floor.** Anything already inside budget measures as exactly
16.67 ms. Removing the sky, the shadow map and then *every mesh in the scene*
all read 16.6–16.8 ms. That looks like "the scene pass costs 16.6 ms" and
actually means "the scene pass is free and we're hitting vsync".

- Push the load above the floor before differencing: pin the pixel ratio to 3
  or 4.
- Below 30 fps, readings are quantised to whole vsync periods too.

**First-sample warm-up.** The first configuration in a sequence measures slow
(pipeline compiles, cache warming, the resize before it). A shadow-map test read
top to bottom said 2048 cost 2.5 ms more than 1024. Alternating A/B/A/B said it
cost nothing. **Always alternate, and re-measure the baseline at the end.**

**The GPU changes speed under you.** A throttled laptop drifts between states
mid-test. Interleave baselines; never compare numbers taken minutes apart.

**Hidden tabs.** A background tab's `requestAnimationFrame` runs at about 1 Hz.
If your "before" build reads 1 fps, check `document.visibilityState` before
celebrating.

**Timestamp queries on Apple GPUs.** Per-pass timestamps overlap: the passes of
a 60 fps frame summed to 40 ms. Use them for totals, not for blame.

---

## The hall of things that lied

Bugs that look right in code review and are wrong on screen. Every entry was a
real afternoon.

**`bumpMap()` on a procedural height does nothing.** three's `bumpMap()` takes
its height samples by re-evaluating the node with the UV overridden, a trick
only a `TextureNode` responds to. Hand it a computed expression and all three
samples come back identical: the gradient is exactly zero and the normal is
untouched. The bark relief slider moved a uniform that couldn't reach a single
pixel; 0 and 40 rendered byte-identical frames.

The fix is `proceduralBump()`, which takes the gradient from screen-space
derivatives of the height *value* and applies Mikkelsen's surface-gradient
construction. Budget a ×20 multiplier before furrows read as depth.

**`specularIntensityNode` is read by nothing.** It exists, accepts a node, and
`setupSpecular` ignores it in favour of the plain scalar. A fruit "fixed" this
way went on rendering a mirrored rim through two rounds of tuning. Assume any
`somethingNode` is inert until a measurement says otherwise.

**The fruit was salmon, and it wasn't the albedo.** Setting
`scene.environmentIntensity` to zero made the same fruit deep red instantly. A
smooth sphere reflects the *whole* sky, and Fresnel takes reflectance to 1 at
the rim. On a berry a dozen pixels across, that rim is most of what you see.

- An apple masked out of the frame went from `rgb(47, 4, 2)` with no
  image-based lighting to `rgb(116, 47, 37)` with it.
- Saturation is destroyed by the *dark* channels, which the achromatic sky
  floods.
- Roughness doesn't help: it sharpens the reflection but doesn't shrink it.
- `specularIntensity` does, because it scales F90.

**Apples that were cherries.** With the silhouette right (wider than tall, deep
stem well, five faint lobes), one uniform red skin still read as *cherry*. An
apple's red is never uniform: a yellow-green ground the red only partly covers,
irregular stripes stem to calyx, pale freckles. The stripes need *high*
harmonics (nine bands around a fruit is a pumpkin), and they must wander, or it
reads as a melon.

**WebGPU guarantees only 8 vertex buffers.** One attribute per scalar needed 9.
Every pipeline failed to create, and the mesh vanished *while still casting a
shadow*, because the shadow pass binds fewer attributes. Hence the packed
`aParams` vec4, and morph targets in a texture.

**The terrain faced the floor.** The polar grid's radius grows with ring index
and angle with sector index. Emitting `(a, b, a+1)` gives a face normal of
`x̂ × ẑ = −ŷ`, so backface culling removed the whole near field. What showed
through the hole was the sky's below-horizon haze: a plausible brown wash, easy
to mistake for bad art direction. (The bark tubes had the same disease and
rendered inside-out.)

**The mirrored sky.** A CPU bake must invert three's equirect sampling exactly,
and a single negated `x` mirrors the sky about the X axis. Nothing looks broken
— the gradient is smooth, the disc round — but the light casting the shadows
was placed *without* the mirror. The painted sun drifted up to 180° from the
light. It read as "the shadows are wrong" when the shadows were the only thing
that was right.

**A row of ghosts on the hill.** Distant trees get upward-leaning normals so a
low sun doesn't turn them black, the same trick as the grass. But then any
specular lobe, even a fully rough one, throws a glancing sheen straight at a
camera looking toward the light. Facing the sunset, or the moon, the whole
treeline lit up pale. Woodland at that distance has no shine to give, so it is
diffuse-only.

**Haze mixed into the albedo** makes distant things *brighter* the hazier they
are, because lighting multiplies it afterwards. A distant treeline done that way
glowed white against its own hills. Fog belongs on the shaded output.

**TSL loop counters shadow each other.** In a nested `Loop`, a value derived
from the outer counter is re-emitted as an expression where it's used. Inside
the inner loop, `i` now means the *inner* `i`, so every aurora slice came out at
the same height. Pin outer-loop values with `.toVar()`.

**A leaf is one leaf.** Each floating leaf's drift — its home, its current,
its phase — was drawn at random *per corner* rather than per leaf. Every corner
wandered off on its own, and the pond filled with orange triangles metres
across. They showed even in summer, when every leaf is scaled to nothing,
because four corners at four different centres still make a triangle however
small each corner's leaf is.

**Count after you unindex.** The pond's stones got one tint per vertex,
counted before the geometry was unindexed: 920 tints for 5,400 drawn vertices.
WebGPU doesn't draw a mesh wrong in that case; it rejects the whole command
buffer, and the entire frame went black.

### The flowers that twinkled

three's bokeh depth of field gathers 64 taps per pixel at a fraction of the
resolution, then dilates the result, keeping the *brightest* of 16 neighbours.
Fine for a soft background, fatal for a meadow:

- a white flower two pixels across is caught by a tap in one frame and missed
  in the next;
- when it's caught, the dilation blows it up into a blob.

Every out-of-focus flower twinkled on and off as the camera moved, and it was
exactly the part of the picture that looked broken.

Arbor's version ([`render/dof.ts`](src/render/dof.ts)) gives up the bokeh disc
for stability:

- It blurs down a small pyramid with separable Gaussians. Each half-resolution
  texel's bilinear read averages the four pixels it covers, so every pixel is
  counted and a small bright thing contributes its true small share in every
  frame.
- The near and far fields are blurred with their own premultiplied weights, so
  the sharp tree never smears into the background, and a blurred stalk in front
  softens over whatever is behind it, as a lens does.
- The far field only ever goes slightly past the first level. Blurred all the
  way, the mountains became smudges and the place lost its sense of where it
  was.

### The sky is hand-tuned on purpose

A Preetham single-scattering sky was built and reverted. The model worked, but:

- its exposure assumes a tone-mapped background, and here the sky is also the
  ambient light, so it bleached the scene;
- its Mie term is milky at every sun angle;
- it correctly renders 17° as mid-morning, not golden hour.

Four attempts didn't beat the hand-tuned gradient. The *light* is physical (see
above); the *gradient* stays painted. Recorded so nobody tries again without new
information.

---

## The L-system view

The pebble at the top of the left column, or the <kbd>L</kbd> key, puts the
garden away and leaves the tree as its grammar drew it. A band of light
sweeps the screen, the page changes under its brightest moment, and the
tree grows back in from the root, every `F` a segment. What means nothing
without the garden (seasons, weather, creatures, light, wind, focus blur,
the rainbow) is laid aside, dimmed, and says why on hover. Species, shape
and grammar stay, and the view follows them. It has a day page and a
night one: paper and ink by day, candle gold through sea-glass to lavender
by night.

- **Colour is depth**: how many brackets deep the turtle was when it drew
  the segment, from the trunk out to the tips.
- **The ladder of rewrites** stands where the growth stem does. Pick a rung
  to see the tree as it stood after that many rewrites, or play them all
  and watch the derivation happen.
- **Pick a branch** (thicker limbs win among twigs) and it, and everything
  grown from it, lights up: that is the bracketed group it is written in.
  The page of notes on the left shows that group with the module that drew
  your segment lit, measures the segment (its depth, its length, the angle
  it leaves its parent at), and tells **how this branch grew**: its
  ancestor at every step, back to the axiom, with the production that
  rewrote it each time. Over the tree, the branch is called out with its
  symbols, its first segments marked `F` and the angle at its fork drawn
  in, as in a figure in a paper.
- **The grammar** is typeset: italic letters, each family of symbols in
  the Grammar card's colours, conditions as mathematics, the constants,
  and a legend of only the symbols this tree uses. The rules a picked
  branch was made by are lit.
- **The rewriting** is a list, one row per step, each with a small drawing
  of the tree at that step to the scale of the finished one, the word's
  beginning and its size. With a branch picked, each row shows that
  branch's ancestor instead.

### How it knows

The derivation can keep its history as it goes (same rewriting, same
random draws): every word from the axiom on, and for each module the one
it was rewritten from and the production that did it
([`lsystem/derive.ts`](src/engine/lsystem/derive.ts)). The turtle records
which module drew each segment. Together they are an `Anatomy`
([`lsystem/anatomy.ts`](src/engine/lsystem/anatomy.ts)), held on a worker
([`anatomy.worker.ts`](src/engine/anatomy.worker.ts)), which keeps the
whole history (the willow's last word alone is 179,075 modules) and sends
the page only what it is about to show. Walked again with the garden's
own settings, its last step is the garden's tree to the last digit, node
for node, for every species: that was checked before anything was drawn.

The drawing ([`render/xray.ts`](src/render/xray.ts)) is two merged meshes,
tubes and beads, where every vertex knows where its segment starts. That
is what lets a tree grow in along its own paths with one uniform, and a
picked branch swell. It is shaded as a diagram, not a material: one soft
light and a rim, inked by day and glowing by night, with the fog off.

Things it taught:

- **A bright page blooms.** The first day page came out grey. Not fog, as
  first suspected, but the glow: its threshold sits in the mid-tones, so
  the paper itself bloomed into everything drawn on it. By day the view
  has no glow at all.
- **Don't switch a light's shadow off.** Turning the sun's shadows off for
  the view released its shadow map, and turning them back on then failed
  every frame. They stay on, and are simply never asked to redraw.
- **A mark can hide what it marks.** The `F` on a picked twig sat exactly
  over the twig. Marks now go beside their segment, and only where it is
  long enough on screen to carry one; a breathing ring finds the rest.
- **Pointing at a limb through twigs means the limb.** Nearest-to-the-ray
  picked twigs every time. Thickness now counts, and *Step out* climbs from
  a twig to the branch it grows from.

## The Learn page

The Grammar card has a **Learn to write a tree** button. It opens a short
course: eleven lessons scrolling down the left, each a few sentences and a
grammar you can edit, and a drawing board on the right. The board draws
whichever lesson you are reading, grows it in as you arrive, and follows as
you type.

The lessons build one idea at a time:

1. A turtle with a pen: `FF+FF+FF+FF` is a square.
2. One rule, rewriting everything at once: a Koch curve, with its word shown
   growing five times longer each generation.
3. Branches: `[` and `]`.
4. Buds: symbols that draw nothing and still grow.
5. Numbers in symbols: `A(s)` and arithmetic.
6. Conditions, and the first match wins; leaves.
7. Chance: weighted rules and `rand()`, with dice.
8. Off the page: pitch, roll and the golden angle.
9. The sliders as names: `ANG`, `LEN`, `SHRINK`, `N`, `n`.
10. Gravity: tropism, and why it can't bend a vertical shoot.
11. The oak from the garden, which by then uses nothing you haven't met.

From lesson 6 on, any tree on the board can be **planted in the garden**: the
standing tree grows back into the ground and the lesson's grows out in its
place, waiting in the Grammar card for you to keep going.

The board isn't the garden's renderer. A lesson wants to show what a grammar
*says* (the turtle's path, the branching, where the leaves go), and a lit,
shaded, wind-blown tree buries that. So the same engine builds the same
skeleton ([`buildTree`](src/engine/lsystem/index.ts), asked to hand back the
derived word too), and a 2D canvas draws it as ink on paper
([`learn/sketch.ts`](src/app/learn/sketch.ts)):

- a line per internode, thick as the pipe model makes it;
- an almond of green per leaf;
- drawn in along the branches by distance from the root, the same wavefront
  the garden grows by.

A grammar that leaves the page turns slowly and can be dragged round. Lines
are batched by thickness and depth, so the 14,000-leaf oak turns at 60 fps.

Three details:

- **Depth is judged on the wood alone.** Leaves are set at a random twist, so
  their tips leave the page even on a tree drawn flat. Counted in, they made
  every flat lesson spin.
- **The growing front runs past the last tip.** Leaves sit exactly at the
  farthest arc, so a front that stopped there never quite reached them, and
  the leaves never appeared.
- **The garden stops drawing while the course is open.** It's covered
  completely, so the board gets the GPU (and a laptop its battery) to itself.

## Writing grammars

```
A(s) : s > 0.2 @ 0.6 -> F(LEN*s) [ +(ANG) A(s*SHRINK) ] -(ANG) A(s*SHRINK)
^------  ^-------- ^---            ^----------------------------------------
predecessor condition probability                    successor
```

The condition and probability are optional, and `#` starts a comment. Rules are
tried top-down and **the first match wins**, so put specific cases above
fallbacks. The exception is stochastic variants: when the first matching rule
carries an `@probability`, every matching rule that declares one is pooled and
drawn from by weight.

### Globals

| Name | Meaning |
| --- | --- |
| `ANG` | Base branching angle, in degrees (*Branch angle*) |
| `LEN` | Base internode length (*Internode length*) |
| `SHRINK` | Per-generation contraction (*Contraction*) |
| `N` | Total generations (*Generations*) |
| `n` | The current derivation step, counting from 0 |

`n >= N-1` is the idiom for "this is the last step". It's how every preset turns
whatever apices are left into foliage. Expressions support arithmetic and
comparisons plus `rand(a,b)`, `sin`, `cos`, `min`, `max`, `pow`, `clamp`, `mix`,
`smoothstep`, `rad` and friends.

### Turtle alphabet

| Symbol | Effect |
| --- | --- |
| `F(len[, w])` | Move forward, drawing an internode. A width `w`, in units of an ordinary tip, is kept as given |
| `f(len)` | Move forward without drawing |
| `+(a)` `-(a)` | Turn left / right |
| `&(a)` `^(a)` | Pitch down / up |
| `\(a)` `/(a)` | Roll left / right |
| `\|` | Turn 180° |
| `$` | Roll level with the horizon; after it `&` tilts toward the sky and `^` toward the ground |
| `!(r)` | Set branch radius (overwritten by the pipe model) |
| `T(e)` | Set tropism for this branch: negative droops, positive reaches up |
| `[` `]` | Push / pop turtle state |
| `L(s)` `K(s)` | Place a leaf / a blossom |

Any other letter is a non-terminal: it draws nothing and carries state between
generations.

### Things grammars teach you the hard way

- **Tropism can't bend a vertical shoot.** It turns about `heading × up`, which
  is zero when the shoot points straight up. Weeping shoots must start off
  vertical *and* off the parent's roll. The Willow uses `$` to level the frame
  before pitching; otherwise shoots launch sideways or skyward and run out of
  generations before gravity turns them over.
- **A frame has to be right-handed.** `$` once built its levelled frame as
  (left, heading, up) with `up = heading × left`, which is a mirror image. No
  rotation can represent that, so the quaternion recovered from it pointed the
  turtle somewhere arbitrary. Half the willow's branches climbed when told to
  arch over, and the rest dived. It's `left × heading` now.
- **The pipe model makes ropes of twigs.** Radii are normalised to the trunk,
  so only ratios survive, and with a few hundred tips the finest twig is still
  a twelfth of the trunk's girth. Scaling the tips down changes nothing,
  because the ratio is all that's left. So `F(len, w)` keeps its width but
  still counts as an ordinary tip toward the wood that carries it. That's how
  the willow hangs a thousand shoots as fine as string.
- **Nothing grows into the soil.** A tree's turtle stops a branch that grows
  down to the ground, so a curtain ends at the grass, not under it.
- **Rewriting is parallel, so length costs generations.** A long hanging
  curtain needs many iterations after the symbol that starts it, however much
  structure came before.
- **Leaves dominate the budget.** A bracketed leaf is about 4 modules, copied
  into the word on every remaining generation.
- **A non-terminal born on the last step never expands.** Emit the geometry
  directly in that rule instead.

## Using the engine elsewhere

```
src/
  engine/   the portable half: no renderer, camera, post or UI
    lsystem/    expression compiler, parser, derivation, 3D turtle, presets, anatomy
    materials/  bark, foliage, flowers, fruit, and the shared vertex program
    build.ts    grammar → buffers, pure data (runs in build.worker.ts)
    tree.ts     the Tree class: meshes plus uniforms, nothing else
    index.ts    the entire public surface
  render/   this app: studio, sky, aurora, landscape, meadow, birds, pond, weather, post, xray
    sound/      the soundscape, and the manifest of every sound and its prompt
  app/      Svelte 5 UI: dock, cards, glyphs, hand-cut paper
    learn/    the Learn page: lessons, and the ink-on-paper drawing board
  lib/      rng, baked noise texture
```

`src/engine` depends on nothing above it. Putting a tree in another three.js
scene is:

```ts
import { Tree, getPreset } from './engine';

const tree = new Tree();
scene.add(tree.group);
tree.applyPreset(getPreset('oak'));
tree.setSun(sunDirection, sunColour);

// animation loop
tree.setGrowth(elapsed / 3);
```

Presets: oak, willow, pine, birch, sakura, apple, rowan, baobab, bush.

`setGrowth` is a single uniform write. A rebuild is only needed when the
*grammar* changes. `Tree.applyLook` covers everything that doesn't, from wind
and autumn to flower colour.

## Using the app

Drag to orbit, scroll to zoom. <kbd>R</kbd> redraws; <kbd>Space</kbd> replays
the growth. Top right: reframe, save a picture, copy a link, start over, and
the source.

**Live vs. redraw.** Most controls apply to the mesh already on screen. The few
that change the derived word wait for **Redraw** rather than rebuilding as you
drag:

| Live | How |
| --- | --- |
| Trunk radius, leaf size | Vertices rescaled about their pivot against what the mesh was baked at |
| Foliage density | Leaves whose hash exceeds the threshold collapse to a point in the vertex shader |
| Flowers and fruit: amount, size, colour, ripeness, blush, wax, gloss | Sites baked at rebuild, culled by rank on the GPU |
| Bark relief, moss, autumn, translucency, wind, light, weather, season, look | Uniforms and post only |
| **Redraw needed** | |
| Generations, branch angle, internode length, contraction, tropism, taper, seed, leaf shape, grammar | They change the derived word (angle, length and droop then *morph* rather than dissolve) |

Flowers and fruit are ranked in **hash order** rather than placement order.
Low density then scatters a few through the whole crown instead of clustering
them on whichever branch was built first, and raising the slider only ever adds.

**Sharing.** The link button copies a URL holding the preset id plus only the
fields that differ from its defaults. An untouched oak is fifteen characters.
It's deliberately uncompressed: `CompressionStream` is async, and an async
decode would delay the first tree on every visit to save bytes in a rare case.
Incoming links are untrusted input: unknown keys are dropped, mistyped values
ignored, and an unknown preset rejects the whole token.
