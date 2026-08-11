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
- **Procedural everything.** Bark furrows, leaf blades, sky and ground are all
  generated — there is not a single texture file in the project.
- **Golden-hour lighting.** An analytic sky doubles as the environment map, so
  the tree picks up warm light from the sun side and cool sky bounce from the
  other. Leaves scatter light when the sun is behind them, which is most of what
  sells an evening canopy.

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
| `$` | Roll level with the horizon |
| `!(r)` | Set branch radius |
| `T(e)` | Set tropism for this branch — negative droops, positive reaches up |
| `[` `]` | Push / pop turtle state |
| `L(s)` `K(s)` | Place a leaf / a blossom |

Any other letter is a non-terminal: it draws nothing and just carries state
between generations.

Two things that are easy to get wrong:

- **Tropism cannot bend a vertical shoot.** It turns the heading about
  `heading × up`, which is zero when the shoot points straight up. Weeping
  shoots have to start well off vertical — see how the Willow preset pitches
  with `&(76)` before handing off to `T(-0.5)`.
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

The interesting seam is `treeGeometry.ts`, which bakes four attributes onto both
the branch and foliage meshes — `aOrigin`, `aCenter`, `aBirth`, `aFlex` — so a
single TSL vertex program in `materials/shared.ts` animates growth and wind for
both.

## Controls

Drag to orbit, scroll to zoom, space to regrow. The buttons under the timeline
regrow, reframe the camera, and save a PNG.
