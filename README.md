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
| Bark relief, moss, autumn, translucency | Shading only |
| Wind, sun, haze, exposure, bloom, DOF, grain | Shading and post only |
| **Redraw needed** | |
| Generations, branch angle, internode length, contraction, tropism, taper, seed, leaf shape, axiom and productions | Change the derived word or the leaf template |

Sky changes rebake a 1024×512 environment texture, so they are throttled rather
than run per frame.
