# Arbor

**A tree you grow from a sentence.**

Arbor is a tree-growing studio built on parametric L-systems and rendered with
three.js on WebGPU. You pick a species and it grows from a seed. You rewrite its
grammar and the tree rearranges itself. You shake its crown and the doves leave.
Everything on screen, down to the bark furrows and the stars, is generated.
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

### Act III: meshes, off the main thread

The skeleton becomes:

- tubes of bark;
- leaf blades with their outline baked into the geometry (no alpha test);
- a lobed root flare;
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

A dozen doves of four kinds live on the tree:

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
| `F(len[, r])` | Move forward, drawing an internode |
| `f(len)` | Move forward without drawing |
| `+(a)` `-(a)` | Turn left / right |
| `&(a)` `^(a)` | Pitch down / up |
| `\(a)` `/(a)` | Roll left / right |
| `\|` | Turn 180° |
| `$` | Roll level with the horizon |
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
    lsystem/    expression compiler, parser, derivation, 3D turtle, presets
    materials/  bark, foliage, flowers, fruit, and the shared vertex program
    build.ts    grammar → buffers, pure data (runs in build.worker.ts)
    tree.ts     the Tree class: meshes plus uniforms, nothing else
    index.ts    the entire public surface
  render/   this app: studio, sky, aurora, landscape, meadow, birds, weather, post
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
