# Arbor

A tree-growing studio built on parametric L-systems, rendered with the WebGPU
backend of three.js.

Everything on screen comes from a grammar. Pick a species, watch it grow from a
seed, then edit the production rules in the side panel and watch the tree change.

```bash
npm install
npm run dev
```

Needs a WebGPU-capable browser (recent Chrome, Edge or Safari).

## What it does

- **Real parametric L-systems.** Conditions, stochastic variants, arithmetic in
  the parameters. The grammar shown in the panel *is* the grammar that grows the
  tree — edit it and press Apply.
- **Growth is a GPU effect.** The mesh is built once at full size; each vertex is
  collapsed back toward the point it sprouts from and released as a growth
  wavefront sweeps outward from the root. Scrubbing the timeline costs nothing,
  and the shadows grow with the tree.
- **Wind is two nested rotations, never a translation.** See below — this is the
  part that is easy to get wrong.
- **Baked canopy occlusion.** Leaf area is splatted into a voxel grid and
  Beer–Lambert gives each leaf its sky visibility. Without it a canopy reads as
  one flat green mass however many leaves you throw at it.
- **Most controls are live.** Only the ones that change the derived word force a
  rebuild, and those wait for the Redraw button — see below.
- **Procedural everything.** Bark furrows, leaf blades, sky and ground are all
  generated — there is not a single texture file in the project.
- **Golden-hour lighting.** An analytic sky doubles as the environment map, so
  the tree picks up warm light from the sun side and cool sky bounce from the
  other. Leaves scatter light when the sun is behind them, which is most of what
  sells an evening canopy.

## How the wind works

Leaves visibly passing through each other is almost always a symptom, not the
problem. Collision detection between tens of thousands of leaf quads is not
affordable in real time, and it is not what fixes this. Three things are:

1. **Rotate, do not translate.** Branches bend by rotating about the tree's base,
   which preserves their length. Displacing vertices along a wind vector
   stretches the geometry instead of bending it.
2. **The bend weight must be smooth in space.** It is driven by height, not by
   distance along the branch. Height is continuous through space, so two pieces
   of geometry that are near each other always bend by nearly the same angle and
   cannot scissor apart. Arc length is *not* continuous in space — a twig tip and
   the limb it hangs from can share a location while being metres apart along the
   branch, and weighting by arc makes them tear through one another.
3. **Anchor leaf motion at the stem.** Each leaf turns about its own attachment
   point, so however hard the wind blows it can never travel further than its own
   length. A leaf must also inherit the same bend weight as the twig carrying it,
   or it slides along the branch and shears through its neighbours.

## Writing grammars

A production looks like this:

```
A(s) : s > 0.2 @ 0.6 -> F(LEN*s) [ +(ANG) A(s*SHRINK) ] -(ANG) A(s*SHRINK)
^------  ^-------- ^---            ^----------------------------------------
predecessor condition probability                    successor
```

The condition and probability are both optional, and `#` starts a comment.
Rules are tried top-down and **the first match wins** — so put your specific
cases above your fallbacks. The exception is stochastic variants: when the first
matching rule carries an `@probability`, every matching rule that declares one is
pooled and drawn from by weight.

### Globals

| Name | Meaning |
| --- | --- |
| `ANG` | Base branching angle, in degrees — the *Branch angle* slider |
| `LEN` | Base internode length — *Internode length* |
| `SHRINK` | Per-generation contraction — *Contraction* |
| `N` | Total generations — *Generations* |
| `n` | The current derivation step, counting from 0 |

`n >= N-1` is the idiom for "this is the last step" — it is how every preset
converts whatever apices are left into foliage.

Expressions support the usual arithmetic and comparisons plus `rand(a,b)`,
`sin`, `cos`, `min`, `max`, `pow`, `clamp`, `mix`, `smoothstep`, `rad` and
friends.

### Turtle alphabet

| Symbol | Effect |
| --- | --- |
| `F(len[, r])` | Move forward, drawing an internode |
| `f(len)` | Move forward without drawing |
| `+(a)` `-(a)` | Turn left / right |
| `&(a)` `^(a)` | Pitch down / up |
| `\(a)` `/(a)` | Roll left / right |
| `\|` | Turn 180° |
| `$` | Roll level with the horizon (see the tropism note below) |
| `!(r)` | Set branch radius |
| `T(e)` | Set tropism for this branch — negative droops, positive reaches up |
| `[` `]` | Push / pop turtle state |
| `L(s)` `K(s)` | Place a leaf / a blossom |

Any other letter is a non-terminal: it draws nothing and just carries state
between generations.

Two things that are easy to get wrong:

- **Tropism cannot bend a vertical shoot.** It turns the heading about
  `heading × up`, which is zero when the shoot points straight up. Weeping shoots
  have to start well off vertical, *and* off whatever roll the parent limb was
  carrying — the Willow preset uses `$` to level the frame against the horizon
  before pitching, because a plain pitch after a roll launches shoots sideways or
  skyward and they run out of generations before gravity can turn them over.
- **Rewriting is parallel, so shoot length costs generations, not branching.**
  A long hanging curtain needs many iterations after the symbol that starts it,
  regardless of how much structure came before.
- **Leaves dominate the module budget.** A bracketed leaf is ~4 modules and every
  one is copied into the word on every remaining generation, so leaf count sets
  derivation cost far more than branch count does.
- **A non-terminal produced on the last step never expands.** If a rule emits a
  helper symbol at `n >= N-1`, there is no generation left to rewrite it and it
  draws nothing. Emit the geometry directly in that rule instead.

Branch thickness is not taken from the grammar. Radii are recomputed bottom-up
with da Vinci's pipe model — a parent is as thick as its children combined —
which is what the *Taper* slider controls. `!(r)` still works, it just gets
overwritten by the pipe pass.

## Layout

```
src/
  engine/       the portable half — no renderer, camera, post, or UI
    lsystem/      expression compiler, parser, derivation, 3D turtle, presets
    materials/    bark, foliage, flowers, fruit, and the shared vertex program
    treeGeometry  meshing; occlusion  canopy light field
    tree.ts       the Tree class — meshes plus uniforms, nothing else
    index.ts      the entire public surface
  render/       this particular app: scene, sky, landscape, post, adaptive res
  app/          Svelte 5 UI
  lib/          rng, baked noise texture
```

`src/engine` depends on nothing above it. `src/render` is one application built
on top; `src/app` is one UI on top of that. Putting a tree in some other
three.js scene is:

```ts
import { Tree, getPreset } from './engine';

const tree = new Tree();
scene.add(tree.group);
tree.applyPreset(getPreset('oak'));
tree.setSun(sunDirection, sunColour);

// animation loop
tree.setGrowth(elapsed / 3);
```

Growth and wind are GPU-side, so `setGrowth` is a single uniform write and an
animating tree costs the same as a static one. A rebuild is only needed when the
*grammar* changes — `Tree.applyLook` covers the long list of things that do not,
from wind and autumn to flower colour.

The interesting seam is `treeGeometry.ts`, which bakes the same attributes onto
both the branch and foliage meshes so a single TSL vertex program in
`materials/shared.ts` animates growth and wind for both: `aOrigin` and `aCenter`
say where a vertex sprouts from and what it orbits, and `aParams` packs birth
time, bend weight, seed and occlusion.

Two rendering constraints worth knowing before you add to that list:

- **WebGPU only guarantees 8 vertex buffers.** One attribute per scalar needs 9
  and every pipeline fails to create — the mesh silently disappears while still
  casting a shadow, because the shadow pass binds fewer attributes. Hence the
  packed `aParams` vec4.
- **Tube winding must be counter-clockwise seen from outside.** The ring frame is
  right-handed with `normalB = tangent × normalA`; wind the quads the other way
  and every face normal points down the tube's axis, so the trunk renders
  inside-out with its near wall culled.
- **The same applies to the terrain**, and it fails much more quietly there. The
  polar grid's radius grows with the ring index and its angle with the sector
  index, so emitting `(a, b, a+1)` spans +x then +z and gives a face normal of
  `x̂ × ẑ = -ŷ`. Every triangle faces the floor, backface culling removes the
  whole near field, and what you see instead is the sky's below-horizon haze
  colour through the hole — a plausible-looking brown wash that is easy to
  mistake for bad art direction. Only the distant hills survive, because the
  parts that rise above eye level present their backfaces to the camera.

### Two ways frame-time measurement lies

Both of these produced confident, wrong conclusions here before being caught.

**The vsync floor.** With vsync on, the median frame interval cannot go below
one refresh period, so anything already inside budget measures as exactly
16.67ms. Removing the sky, the shadow map and then *every mesh in the scene* all
read 16.6-16.8ms — which looks like "the scene pass costs 16.6ms" and actually
means "the scene pass is free and we are hitting vsync". The fix is to push the
load above the floor before differencing: pinning the pixel ratio to 3 makes
every pass 2.25x more expensive and the differences reappear. Timestamp queries
would be better, but `resolveTimestampsAsync` returns nothing unless the browser
exposes the WebGPU `timestamp-query` feature, which it often does not.

**First-sample warm-up.** The first configuration in a sequence measures slow —
pipeline compilation, cache warming, the resize that preceded it. Reading a
shadow-map probe top to bottom said 2048 cost 2.5ms more than 1024. Running the
same sizes alternating A/B/A/B/A said 2048 gives 22.4 / 19.9 / 20.5 and 1024
gives 19.9 / 20.4 — no difference at all, with the entire effect living in the
first sample. Always alternate, and always re-measure the starting
configuration at the end.

The practical upshot for this scene: geometry is free, the shadow map size does
not matter, and post-processing is the only cost worth attacking. Grass density
is set high on exactly that evidence.

### The post chain was 40% of the frame

Profiling each effect by toggling it and watching the median frame interval, at
a pinned 2x device pixel ratio:

| effect | cost |
| --- | --- |
| depth of field | 11.1ms |
| bloom | 3.2ms |
| FXAA | 2.5ms |
| film grain | free |

Depth of field alone was more than the tree, the terrain and everything else
combined. Almost all of it is two 64-tap bokeh gathers, which three runs at half
the input resolution. Bokeh is low-frequency by construction, so those run at a
quarter here instead: the sample *step* stays keyed to the full-resolution texel
size, so the blur keeps exactly the same radius on screen and only its sampling
density drops. The circle-of-confusion pass and the composite stay at full
resolution, so everything in focus stays sharp — only the parts that are meant
to be blurred are computed coarsely. `setSize` is public and recomputed from the
input texture every frame, so overriding it on the instance is enough; no fork.

FXAA is now skipped above 1.75x device pixel ratio. At that density the browser's
own downscale is already supersampling several times over, and FXAA has nothing
left to find — it costs 2.5ms and returns a slightly softer image. The antialias
control therefore means "smooth the edges if that needs doing", and the renderer
decides whether it does. The adaptive controller revisits that decision whenever
it changes resolution, since it is part of the same budget.

Together: 27.4ms to 22.2ms at 2x, with no visible difference.

### The sky is hand-tuned on purpose

A Preetham single-scattering sky was built and then reverted. Recording why, so
it is not attempted again without new information.

The model itself works — the port produced a correct blue zenith at (0.09, 0.29,
0.80) and a bright neutral horizon band, and deriving the directional light's
colour from the same extinction term is a genuinely better idea than two
hand-picked constants kept in sync by eye. Three things went wrong in practice:

- **Preetham's `0.04` exposure assumes a tone-mapped background.** Here the sky
  is also the image-based light, and at that scale the horizon sits at a
  radiance of 2.6 — enough ambient to bleach the scene and flatten the key light
  out of it.
- **Mie is the whiteness, Rayleigh is the blue.** The default ratio gives a
  milky sky at every sun angle: physically defensible, visually flat.
- **17 degrees is not golden hour.** Golden hour is roughly 0-6 degrees, and the
  painted gradient simply declared the light warm at any elevation. The physical
  model correctly renders 17 degrees as mid-morning — and at 6 degrees, where it
  should shine, `sunIntensity` has fallen to 9% of its peak, so the sky goes dim
  while the separately-computed directional light does not, and the two
  disagree in the opposite direction from before.

Fixing all three is possible; it means deriving the light intensity from the
same model and re-tuning the whole look around a lower default sun. That is a
larger change than it looks, and four attempts did not beat the gradient it was
replacing, so the gradient stays.

### The sky was a 128ms CPU bake, and two bakes cannot agree

The sky used to be baked into a 1024x512 equirectangular half-float texture in
JavaScript, once per change of sun position. That measured at **128ms of blocked
main thread**, so nudging the sun slider stalled the app for eight frames and
felt exactly like triggering a rebuild — with the sky arriving late while the
shadows had already moved.

It also had a subtler failure. Baking the same gradient twice — once at full
size with the sun disc for the background, once small and disc-free for the
environment — means two copies of the formula that have to agree, and a CPU bake
has to invert three's own equirect sampling (`u = atan2(dir.z, dir.x)/2pi + 0.5`,
`v = asin(dir.y)/pi + 0.5`) exactly. A single negated `x` mirrors the entire sky
about the X axis. Nothing looks broken: the gradient is smooth, the horizon warm,
the disc round. But the directional light is placed from the same azimuth
*without* the mirror, so the painted sun drifts from the light casting the
shadows — 20 degrees at an oblique azimuth, close to 180 with the sun due east or
west. It reads as "the shadows are wrong" when the shadows were the only part
that was right.

Both problems have the same fix. The gradient is now a TSL node used directly as
`scene.backgroundNode`, and the *same node* is rendered into a 96px cube map on
the GPU for image-based lighting (`CubeCamera.update` flags the texture, so three
refilters the PMREM by itself). Moving the sun costs **0.2ms** — a handful of
uniform writes — and the sky you see and the sky that lights the tree cannot
disagree, because they are the same expression.

The one thing the two skies still differ on is the sun disc, and that difference
is deliberate. The disc carries about 26x the radiance around it so that it
blooms; leave it in the environment and a specular lobe at any real roughness
integrates a wide cone of it and smears it over everything. A fruit with a black
albedo still rendering as a grey ball is what originally located that.

Verify by aiming: point the camera straight down `sunDir` from several azimuths
and find the brightest pixel. It should land in the centre of frame every time —
currently within one pixel at 40, 140, 250 and 330 degrees.

### The sun's colour is derived, not chosen

Sun colour and brightness come from atmospheric extinction rather than from two
hand-picked constants: Kasten–Young air mass, Rayleigh optical depth per channel
(`0.0088 * lambda^-4.15`), plus an aerosol term the haze slider drives. A low sun
reddens and dims because its light crosses 38 atmospheres, not because a `lerp`
says so — and the sky, the disc and the key light cannot drift apart, because all
three read the same function.

Two adjustments are needed to make it usable, both documented in `sky.ts`. Full
extinction over-reddens, because it models only light removed from the beam and
not light scattered back into it; transmittance is raised to the power 0.75 to
stand in for the missing multiple scattering. And colour is normalised separately
from brightness: physically they fall together, but a light that is both nearly
black *and* deep red is no use, so the hue is normalised to its brightest channel
and the dimming applied on its own gentler curve.

This is a smaller change than the full Preetham sky recorded above, and it works
because it only replaces the *light*, leaving the tuned gradient alone.

### Two things that cost more than they look like

**Per-pixel fractal noise, on anything that fills the screen.** The terrain
material started out evaluating roughly thirty octaves of 3D fbm per fragment,
which measured at 12ms of a 32ms frame. Halving the octave count bought 3ms;
baking the same fields into a tileable, mipmapped RGBA texture and sampling it
three times took the draw to 1.7ms. Mipmapping is the second, quieter win —
procedural noise has no derivatives the hardware can use, so it shimmers as soon
as its features fall below a pixel, while a texture averages itself down for
free. The cost is tiling, which `noiseTexture.ts` expects callers to break by
mixing two samples at incommensurate world scales.

**`bumpMap()` on a procedural height field, which fails silently.** three's
`bumpMap()` takes its three height samples by re-evaluating the node with the UV
context overridden — a trick only a `TextureNode` responds to. Hand it a computed
expression and all three samples come back identical, the gradient is exactly
zero, and it returns the untouched normal. The bark relief slider moved a uniform
that could not reach a single pixel: 0 and 40 produced byte-identical frames, and
the fault is invisible in a code review because the call site looks correct.

For a procedural height field the gradient has to be taken directly, from
screen-space derivatives of the height *value* — `proceduralBump()` in
`engine/materials/shared.ts`, which then applies Mikkelsen's surface-gradient
construction so the perturbation stays independent of any UV parameterisation.
Worth knowing before writing another one: a screen-space height gradient is a
small number, so it takes a multiplier around 20x before furrows read as depth
rather than as a faint sheen.

**Aerial perspective mixed into an albedo.** Haze belongs on the *shaded
output*, not on the base colour: mix it into the albedo and the lighting
multiplies it afterwards, so the hazier something is meant to be, the brighter
it renders. A distant treeline done that way glows white against the hills it is
standing on. `scene.fogNode` is applied after lighting, which is where it has to
go — and putting it there also means every material shares one depth cue instead
of some using scene fog and others rolling their own.

### Flowers and fruit

Neither is part of the grammar. Both are baked onto a subset of the leaf
attachment points at rebuild time and then culled on the GPU, so any species can
carry them and every control is live. Each site gets a rank in `[0, 1)` assigned
in hash order, and an ornament whose rank exceeds the density uniform collapses
to a point. Hash order rather than placement order matters: it means a low
density scatters a few flowers through the whole crown instead of clustering
them on whichever branch was built first, and raising the slider only ever adds.

The rank doubles as the per-ornament random seed, so one scalar drives both the
culling and the colour and size variation — a crown of identically coloured
berries reads as plastic.

**Berries are spheres; apples are not.** A sphere does not read as an apple and
no amount of shading rescues it — what the eye recognises is the silhouette.
Four things carry it, all geometry: wider than tall with the widest point *above*
the equator, a deep stem well, a shallower calyx basin opposite it, and five
faint lobes from the carpels inside. The stalk rides in the same mesh, tagged
with a UV outside [0, 1] so the shader can give it bark colour — a dozen
triangles do not justify a second draw call.

The wells are the fiddly part. Subtracting a Gaussian from `y` only makes a dent
if it is *steeper* than the sphere's own curvature; a wide, gentle one is
absorbed into the profile and does nothing. The first attempt used a width of
0.62 and carved a well 0.02 radii deep, which is to say none. Rings also have to
be spaced by `(1 - cos(pi v)) / 2` rather than uniformly, or barely one sample
lands inside the well and it renders as a notch.

An apple also has a top and a bottom, so unlike a berry it cannot inherit
whatever rotation the leaf beside it happened to get. Fruit shapes with an axis
are placed upright, with a random spin and a few degrees of lean.

**Shape is only half of it.** With the silhouette right and the colour finally
red, the fruit read as *cherries* — because a cherry is a uniform, saturated,
glossy red ball, and one skin colour paints exactly that. What makes an apple
recognisable is that its red is never uniform: a yellow-green ground the red only
partly covers, irregular striping running stem to calyx, and pale lenticel
freckles scattered over the skin. Two calibration notes, both learned the hard
way: the stripes need *high* integer harmonics — nine bands around a fruit is
pumpkin ribbing, not apple striping — and they have to wander along their length,
or the fruit reads as a melon. Red also has to stay the base with the ground
showing through it, never the reverse.

**Why fruit renders pale, and what actually fixes it.** Pick a saturated red and
the fruit still comes out salmon. It is tempting to chase the albedo, and that is
the wrong end: bisecting it by setting `scene.environmentIntensity` to zero makes
the same fruit deep red instantly. The diffuse half of image-based lighting is
multiplied by the albedo, so a `(0.75, 0, 0)` skin can only ever come back red —
it has to be the specular half. A smooth sphere reflects the *entire* sky, and
Fresnel takes reflectance to 1 at the rim, which on a berry a dozen pixels across
is most of what you can see.

Saturation is destroyed by the channels that are *dark*, not by the one that is
bright. Measured on a single apple masked out of the frame: with image-based
lighting off it renders `rgb(47, 4, 2)`, a deep red; with it back on, the same
fruit is `rgb(116, 47, 37)`. The sky's reflection is nearly achromatic, so it is
invisible against red and decisive against the other two. A photograph of a real
apple survives this because the apple reflects a structured world — mostly the
dark leaves around it, with sky in a small highlight; ours reflects a smooth,
uniformly bright sky over its whole upper hemisphere, because that is all the
environment map holds.

Roughness is not the lever. Lowering it sharpens the reflection but does not
shrink it; the sphere still faces every part of the sky. `specularIntensity` is,
because it scales F0 *and* F90 — and F90 is the one that matters, since a
dielectric reflects ~4% head-on and ~100% at grazing.

**And the obvious way to set it does nothing.**
`MeshPhysicalNodeMaterial.specularIntensityNode` exists, accepts a node, and is
read by nothing in three: `setupSpecular` uses `materialSpecularIntensity`, a
`materialReference` to the plain scalar. Assigning the node silently leaves the
material at its default 1.0, so an apparently-fixed fruit went on rendering with
a fully mirrored rim through two rounds of tuning. This is the same failure as
`bumpMap()` on a procedural height field — a node property that reads correctly
at the call site and cannot reach a pixel — and it is worth assuming any
`somethingNode` is inert until a measurement says otherwise. `Tree.applyLook`
writes the scalar. With it genuinely applied, one masked apple went from
`g/r 0.60, b/r 0.52` — dusty salmon — to `g/r 0.35, b/r 0.24`, which is where a
photographed red apple sits, and the gloss slider finally spans matte to shiny
instead of doing nothing at all.

Two art terms were quietly making it worse and are now sliders rather than
constants: the unripe green, which was hard-coded far enough up that a pure red
went olive on its shaded half, and the pale wax bloom, which is lovely on an
apple and poison on a berry.

### Hovering the canopy

Move the pointer over the tree and the foliage and thin branches near it part,
turn on their stems and brighten very slightly. The trunk ignores you.

The instinct is to raycast for the leaf under the cursor and highlight it. That
is wrong twice over. Growth and wind both move this geometry in the vertex
shader, so the triangles a CPU raycast tests are not the triangles on screen;
and picking a *surface* makes the response snap from leaf to leaf as the cursor
crosses gaps in the canopy, which is exactly the discrete, weird feel worth
avoiding.

So nothing is ever selected. The pointer contributes one world-space point, and
`hoverAt` falls off smoothly with distance from it — thousands of leaves each
answer a little, and the response slides across the crown instead of jumping.
Three details make it hold together:

- **Evaluate the weight at a vertex's pivot, not at the vertex.** Neighbouring
  geometry then shares almost the same weight, which keeps a leaf rigid and
  keeps it attached to its twig. Same reasoning as the wind.
- **Put the pivot through the wind rotation first.** Comparing the rest pivot
  leaves a gusting canopy responding where it used to be — most of a leaf's
  length away on a windy preset.
- **Take compliance from the vertex's distance to its own strand axis**, which
  is the branch radius there. Twigs stir, the trunk does not, and no extra
  attribute is needed to tell them apart.

Aiming it is its own problem. Intersecting a bounding sphere — the obvious first
try — leaves the influence in empty air beside the crown whenever the cursor is
off centre, because that sphere is mostly not tree; measured on an oak, the
target landed a full canopy-radius outside the foliage. Measuring closest
approach to the *trunk axis* instead lands it inside the canopy wherever the
cursor is, and covers the trunk for free. Both the point and the strength are
then eased with an exponential chase, which is frame-rate independent — the
response takes the same wall-clock time at 30fps as at 144.

### Roots

A trunk that meets the ground at a right angle reads as a post pushed into the
soil, and bark detail does not rescue it — the tell is the silhouette. So the
base flares, and the flare is *lobed*: each swelling is a major lateral root
pushing the trunk outward before it leaves. Flare and roots come from one plan
in `engine/roots.ts`, because they are the same structure above and below the
soil line; each root leaves from *inside* its own bulge, so the join is buried
in solid wood and cannot show a seam. Roots ride in the wood buffer, so the
whole tree is still one draw call.

Three things went wrong before it looked right, and all three are about rates
rather than sizes:

- **Leaving from high on the flare and sinking gently** gives a mangrove on
  stilts — the tree stands on arches with daylight underneath.
- **Sinking gently from low down** is worse: the roots lie along the grass like
  logs, because a tube whose *centre* is just below zero still has its whole
  upper half above ground. The root has to be properly buried within a segment
  or two of crossing.
- **Travelling outward too fast** — anything below about `t^0.7` — defeats both
  fixes, because the root covers most of its reach before the dive has taken it
  anywhere. What should show is a hump about a trunk-radius wide, arching out of
  the flare and straight back under. The remaining reach happens underground,
  where it is free.

Growth timing matters as much as shape. Born early, as they first were, the
roots snap to full reach while the trunk is still a sliver, so the tree spends
its youth as a starfish around a hollow centre and then grows a trunk up through
the middle of it. Birth is now delayed and spread along each root, so it extends
ring by ring, pushed outward while the trunk thickens.

### Grass

Two tricks from game foliage rendering do nearly all the work, both in
`materials/groundCover.ts`:

- **Blade normals point up, not out.** A blade's true surface normal is nearly
  horizontal, and at golden hour a horizontal normal faces away from a low sun
  and renders black. Real grass reads as a lit surface because the eye takes its
  shading from the ground it covers, so the normals are bent most of the way
  toward vertical.
- **Darkness comes from the root.** Grass self-shadows: the base of a clump is
  in near-total occlusion and only the tips are lit. A vertical gradient down
  each blade fakes the whole effect for one multiply.

Clumps also have to be small and dense enough to merge into texture. A tuft you
can pick out individually reads as a weed, not as a field.

## Controls

Drag to orbit, scroll to zoom. <kbd>R</kbd> redraws, <kbd>space</kbd> replays the
growth animation. The buttons under the timeline redraw, replay, reframe the
camera, and save a PNG.

### Sharing

The link button in the transport bar copies a URL that reproduces exactly what
is on screen. What goes in it is the preset id plus only the fields that differ
from that preset's defaults — an untouched Oak is fifteen characters, an Oak
with a new seed and more wind is under eighty, and only someone who has actually
rewritten the productions pays for carrying them.

It is deliberately uncompressed. `CompressionStream` would shrink an edited
grammar considerably, but it is asynchronous, and an async decode means the app
cannot build its first tree until a promise settles. A long URL in the rare case
beats a slower start in every case.

Incoming links are treated as untrusted input: unknown keys are dropped rather
than merged, values whose type does not match the default are ignored, and an
unrecognised preset id rejects the whole token rather than silently falling back
to a different tree.

### Live vs. redraw

Only the controls marked ↻ re-derive the grammar; everything else applies
immediately to the mesh already on screen. Changing one of the marked controls
lights up the **Redraw** button rather than rebuilding as you drag.

| Live | How |
| --- | --- |
| Trunk radius, leaf size | Vertices are rescaled about their pivot by a uniform ratio against what the mesh was baked at |
| Foliage density | Leaves whose hash exceeds the threshold collapse to a point in the vertex shader |
| Flower and fruit amount, size, colour, ripeness, blush, wax, gloss | Ornament sites are baked at rebuild and culled by rank in the vertex shader |
| Bark relief, moss, autumn, translucency | Shading only |
| Wind, sun position and strength, sky light, haze, exposure, bloom, DOF, grain | Shading and post only |
| **Redraw needed** | |
| Generations, branch angle, internode length, contraction, tropism, taper, seed, leaf shape, axiom and productions | Change the derived word or the leaf template |

Nothing here is throttled. Moving the sun costs 0.2ms — uniform writes plus a
96px cube render for the environment — so the whole panel responds on the next
frame.
