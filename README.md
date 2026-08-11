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
  lsystem/      grammar: expression compiler, parser, derivation, turtle, presets
  render/       three.js: geometry building, TSL materials, sky, post, scene
  app/          Svelte 5 UI
```

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

### Background and environment are not the same texture

The procedural sky carries a sun disc at up to 30x the radiance of the sky
around it, so that it blooms. Using that same texture as `scene.environment`
puts all of that energy into the IBL: a specular lobe at any real roughness
integrates a wide cone of the environment, and the disc smears across it. The
symptom is subtle and scene-wide — everything picks up a pale wash, and it is
easy to blame the albedo. A fruit with a black albedo still rendered as a grey
ball, which is what finally located it.

So the sky bakes twice: a full-size background with the disc, and a small
disc-free environment. Everything else — the canopy, the treeline, the fruit —
got its colour back for free.

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

### Live vs. redraw

Only the controls marked ↻ re-derive the grammar; everything else applies
immediately to the mesh already on screen. Changing one of the marked controls
lights up the **Redraw** button rather than rebuilding as you drag.

| Live | How |
| --- | --- |
| Trunk radius, leaf size | Vertices are rescaled about their pivot by a uniform ratio against what the mesh was baked at |
| Foliage density | Leaves whose hash exceeds the threshold collapse to a point in the vertex shader |
| Flower and fruit amount, size, colour, gloss | Ornament sites are baked at rebuild and culled by rank in the vertex shader |
| Bark relief, moss, autumn, translucency | Shading only |
| Wind, sun, haze, exposure, bloom, DOF, grain | Shading and post only |
| **Redraw needed** | |
| Generations, branch angle, internode length, contraction, tropism, taper, seed, leaf shape, axiom and productions | Change the derived word or the leaf template |

Sky changes rebake a 1024×512 environment texture, so they are throttled rather
than run per frame.
