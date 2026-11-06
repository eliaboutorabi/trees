/**
 * Species presets. Each one is a real parametric L-system — the grammar shown
 * in the UI is the grammar that grows the tree, and every global it references
 * (`ANG`, `LEN`, `SHRINK`, `N`) is wired to a slider.
 */

export interface Palette {
  /** Deep colour in the bark crevices. */
  barkDark: number;
  /** Colour on the raised bark ridges. */
  barkLight: number;
  /** Smooth young-twig colour, blended in as branches get thin. */
  twig: number;
  moss: number;
  /** Birch-style horizontal dashes on the bark, 0–1. */
  lenticels?: number;
  leafBase: number;
  leafTip: number;
  /** Where leaves head as the `autumn` slider rises. */
  leafAutumn: number;
  blossom: number;
  /** Flower and fruit colours, if this species suggests any. */
  flowerColor?: number;
  flowerCore?: number;
  fruitColor?: number;
}

export interface PresetParams {
  iterations: number;
  /** `ANG` — base branching angle in degrees. */
  angle: number;
  /** `LEN` — base internode length. */
  step: number;
  /** `SHRINK` — per-generation contraction. */
  shrink: number;
  trunkRadius: number;
  /** Positive grows skyward, negative droops. */
  tropism: number;
  pipeExponent: number;
  leafScale: number;
  /** 0 broad · 1 needle cluster · 2 rounded blossom · 3 narrow lance. */
  leafShape: 0 | 1 | 2 | 3;
  /** How much this species moves in wind. */
  windiness: number;
  /** Fraction of ornament sites carrying a flower, 0–1. */
  flowerDensity?: number;
  /** Fraction of ornament sites carrying a fruit, 0–1. */
  fruitDensity?: number;
  /** Ornament scale, relative to what the leaf size implies. */
  flowerSize?: number;
  fruitSize?: number;
  /** 0 berry · 1 apple · 2 pine cone. A berry is a sphere; the others have an axis. */
  fruitShape?: 0 | 1 | 2;
}

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  axiom: string;
  rules: string;
  params: PresetParams;
  palette: Palette;
}

export const PRESETS: Preset[] = [
  {
    id: 'oak',
    name: 'Oak',
    blurb: 'Sturdy trunk, wide gnarled crown',
    // A clear bole under the crown, as an oak grown in the open has.
    axiom: '!(1)F(LEN*0.55)A(1)',
    rules: `# Terminal generation: the last apex becomes a leafy shoot rather than
# a single rosette, so leaves spread along the twig instead of bunching
A(s) : n >= N-1 -> F(LEN*s*0.4)[&(38)L(1.15)]/(137.5)F(LEN*s*0.3)[&(30)L(1.0)]/(137.5)F(LEN*s*0.3)[&(42)L(1.1)]/(137.5)[&(25)L(0.95)][/(150)&(34)L(1.05)]

# Outer crown: same fork, but leafing out as it runs
A(s) : s > 0.16 && s < 0.52 -> F(LEN*s)[&(52)L(0.85)][/(180)&(46)L(0.8)]/(137.5)[&(ANG*rand(0.75,1.25))A(s*SHRINK*0.90)][/(155)&(ANG*rand(0.8,1.3))A(s*SHRINK*0.88)]^(rand(1,7))A(s*SHRINK*0.84)

# Structural limbs, still too thick to carry leaves. The leader gives way
# to them, as it does on an oak grown in the open, so the crown spreads
# wider than the tree is tall
A(s) : s > 0.16 -> F(LEN*s)/(137.5)[&(ANG*rand(0.75,1.25))A(s*SHRINK*0.90)][/(155)&(ANG*rand(0.8,1.3))A(s*SHRINK*0.88)]^(rand(1,7))A(s*SHRINK*0.84)

# Too thin to branch again
A(s) -> F(LEN*s*0.8)[L(1.1)][/(120)&(30)L(1.0)][/(240)^(20)L(1.05)]`,
    params: {
      iterations: 10,
      angle: 52,
      step: 1.85,
      shrink: 0.88,
      trunkRadius: 0.36,
      tropism: 0,
      pipeExponent: 2.3,
      leafScale: 0.155,
      leafShape: 0,
      windiness: 1,
    },
    palette: {
      barkDark: 0x1b1410,
      barkLight: 0x6d5a45,
      twig: 0x6b6141,
      moss: 0x4d5c2e,
      leafBase: 0x2f5320,
      leafTip: 0x86a83c,
      leafAutumn: 0xc06a1e,
      blossom: 0xf2d7c4,
    },
  },
  {
    id: 'willow',
    name: 'Willow',
    blurb: 'Climbing limbs veiled in long hanging whips',
    axiom: '!(1)F(LEN*0.8)A(1)',
    rules: `# Salix babylonica, from winter photographs, when the structure shows.
# The wood is an ordinary broadleaf's: a trunk that climbs well into the
# crown throwing limbs that ascend and spread, and splits near the top into
# co-dominant stems. Nothing in the framework weeps. What weeps are the
# whips: long, fine, unbranched shoots hanging from every branch of the
# outer crown, a veil over the whole tree.

# The trunk climbs, throwing a limb at each node, and divides near the top
A(s) : s > 0.6 -> F(LEN*s)/(rand(115,165))[&(ANG*rand(1.0,1.3))B(s*0.74)]^(rand(2,7))A(s*0.8)
A(s) -> /(rand(0,90))[&(ANG*rand(0.45,0.65))B(s*0.92)][/(180)&(ANG*rand(0.45,0.65))B(s*0.88)]

# Limbs ascend and spread, forking as they go and bending at each fork the
# way willow wood does. The outer ones shed whips from every node.
B(s) : s > 0.4 -> F(LEN*s)/(137.5)[&(ANG*rand(0.8,1.2))B(s*0.64)]+(rand(-12,12))^(rand(0,8))B(s*0.9)
B(s) : s > 0.14 -> F(LEN*s)[V][/(180)&(55)L(0.9)]/(137.5)[&(ANG*rand(0.8,1.2))B(s*0.62)]+(rand(-12,12))^(rand(0,8))B(s*0.85)
B(s) -> [V][/(180)V]

# A whip leaves rising, as new growth does, and its own weight turns it
# over within a step or two and hangs it plumb
V -> [$+(rand(-60,60))&(rand(15,45))T(-2.2)W(0)]

# Fine, unbranched, and crowded with leaves all the way down, so each one
# hangs as a feathery rope. The second argument to F fixes its width, in
# ordinary tips, so the pipe model cannot swell it.
W(j) : j < 11 -> F(LEN*0.26, 1.3)[/(40)&(20)L(0.9)][/(160)&(16)L(0.85)][/(280)&(22)L(0.8)]/(137.5)W(j+1)
W(j) -> L(0.7)`,
    params: {
      iterations: 28,
      angle: 56,
      step: 1.3,
      shrink: 0.9,
      trunkRadius: 0.38,
      tropism: 0,
      // Willow wood tapers hard: limbs that start as thick as a leg end in
      // twigs no thicker than the whips they carry.
      pipeExponent: 1.6,
      leafScale: 0.17,
      leafShape: 3,
      windiness: 1.5,
    },
    palette: {
      // Willow bark is grey-brown and deeply ridged, lighter than an oak's.
      barkDark: 0x2a251d,
      barkLight: 0x847a64,
      twig: 0x9a8f58,
      moss: 0x4a5a2c,
      // Fresh and light, yellow-green where the light comes through.
      leafBase: 0x5b8a34,
      leafTip: 0xc2d872,
      leafAutumn: 0xd0a72e,
      blossom: 0xeee0c0,
    },
  },
  {
    id: 'pine',
    name: 'Pine',
    blurb: 'Conical, four-branch whorls, needle sprays',
    // The lowest whorls are long gone on a grown pine: a bare trunk first.
    axiom: '!(1)F(LEN*1.1)A(1)',
    rules: `A(s) : n >= N-1 -> F(LEN*s)[L(0.6)][/(120)L(0.6)][/(240)L(0.6)]

# A whorl of five near-horizontal limbs, then the leader carries on up
A(s) : s > 0.18 -> F(LEN*s)[&(ANG)B(s*0.55)]/(72)[&(ANG)B(s*0.55)]/(72)[&(ANG)B(s*0.55)]/(72)[&(ANG)B(s*0.55)]/(72)[&(ANG)B(s*0.55)]/(40)A(s*SHRINK)

A(s) -> F(LEN*s)[L(0.7)][/(120)L(0.65)][/(240)L(0.7)]

# Near the trunk a limb throws secondary branchlets; further out it just runs.
# Forking only while s is high bounds the growth - fork at every step and the
# module count doubles per generation.
B(s) : s > 0.24 -> F(LEN*s*0.8)[/(50)&(52)L(0.75)][/(140)&(46)L(0.7)][/(230)&(56)L(0.75)][/(320)&(42)L(0.7)][/(85)&(58)B(s*0.5)][/(265)&(54)B(s*0.44)]&(3)B(s*0.88)

B(s) : s > 0.05 -> F(LEN*s*0.8)[/(50)&(52)L(0.75)][/(140)&(46)L(0.7)][/(230)&(56)L(0.75)][/(320)&(42)L(0.7)]&(3)B(s*0.86)
B(s) -> [L(0.8)][/(120)L(0.75)][/(240)L(0.8)]`,
    params: {
      iterations: 14,
      angle: 68,
      step: 1.037,
      shrink: 0.93,
      trunkRadius: 0.3,
      tropism: 0.016,
      pipeExponent: 3.0,
      leafScale: 0.32,
      leafShape: 1,
      windiness: 0.55,
      // Cones hang from the older wood, never thickly.
      fruitDensity: 0.3,
      fruitSize: 0.62,
      fruitShape: 2,
},
    palette: {
      barkDark: 0x1e120c,
      barkLight: 0x76472d,
      twig: 0x5c4a30,
      moss: 0x3f5230,
      leafBase: 0x1c3a2a,
      leafTip: 0x4f7a44,
      leafAutumn: 0x6b7f3a,
      blossom: 0xd8cfae,
      fruitColor: 0x7a512b,
},
  },
  {
    id: 'birch',
    name: 'Birch',
    blurb: 'Slender and upright, sparse airy canopy',
    axiom: '!(1)F(LEN*0.6)A(1)',
    rules: `A(s) : n >= N-1 -> F(LEN*s)[L(1.0)][/(96)&(30)L(0.9)][/(192)^(22)L(0.95)][/(288)&(26)L(0.85)]

# Thin shoots leaf out along their length
A(s) : s > 0.12 && s < 0.42 -> F(LEN*s)[&(56)L(0.85)][/(180)&(50)L(0.8)]/(137.5)[&(ANG*rand(0.7,1.25))A(s*SHRINK*0.80)]^(rand(0,5))A(s*SHRINK*0.96)

# A single alternating side shoot per node keeps the crown open
A(s) : s > 0.12 -> F(LEN*s)/(137.5)[&(ANG*rand(0.7,1.25))A(s*SHRINK*0.80)]^(rand(0,5))A(s*SHRINK*0.96)

A(s) -> F(LEN*s*0.9)[L(0.95)][/(120)&(28)L(0.9)][/(240)^(18)L(0.85)]`,
    params: {
      iterations: 12,
      angle: 36,
      step: 1.22,
      shrink: 0.9,
      trunkRadius: 0.22,
      tropism: 0.085,
      pipeExponent: 2.4,
      leafScale: 0.13,
      leafShape: 0,
      windiness: 1.25,
    },
    palette: {
      barkDark: 0x3b342c,
      barkLight: 0xe4ded0,
      twig: 0x8a7c5e,
      moss: 0x5c6a34,
      lenticels: 1,
      leafBase: 0x4a7526,
      leafTip: 0xb2cc4e,
      leafAutumn: 0xe8b23a,
      blossom: 0xf0e6cf,
    },
  },
  {
    id: 'sakura',
    name: 'Sakura',
    blurb: 'Low spreading limbs under a cloud of blossom',
    axiom: '!(1)F(LEN*0.25)A(1)',
    rules: `A(s) : n >= N-1 -> F(LEN*s)[K(1.1)][/(72)&(26)K(1.0)][/(144)^(20)K(1.05)][/(216)&(30)K(0.95)][/(288)^(16)K(1.0)]

# Outer twigs are smothered in blossom
A(s) : s > 0.17 && s < 0.5 -> F(LEN*s)[&(50)K(0.95)][/(180)&(44)K(0.9)]/(137.5)[&(ANG*rand(0.9,1.4))A(s*SHRINK*0.90)][/(165)&(ANG*rand(0.9,1.4))A(s*SHRINK*0.88)]^(rand(2,10))A(s*SHRINK*0.84)

A(s) : s > 0.17 -> F(LEN*s)/(137.5)[&(ANG*rand(0.9,1.4))A(s*SHRINK*0.90)][/(165)&(ANG*rand(0.9,1.4))A(s*SHRINK*0.88)]^(rand(2,10))A(s*SHRINK*0.84)

A(s) -> F(LEN*s*0.8)[K(1.0)][/(90)&(28)L(0.6)][/(200)^(20)K(0.9)]`,
    params: {
      iterations: 10,
      angle: 50,
      step: 1.6,
      shrink: 0.87,
      trunkRadius: 0.36,
      tropism: -0.016,
      pipeExponent: 2.2,
      leafScale: 0.14,
      leafShape: 2,
      windiness: 1.15,
      // The grammar already smothers the twigs in K blossom, so the ornament
      // layer only adds a scatter of later, brighter flowers on top.
      flowerDensity: 0.35,
      flowerSize: 1.15,
    },
    palette: {
      barkDark: 0x1d1413,
      barkLight: 0x634a43,
      twig: 0x6d4f48,
      moss: 0x53602f,
      leafBase: 0x3f6a2c,
      leafTip: 0x8fb04a,
      leafAutumn: 0xd9707f,
      blossom: 0xffd7e4,
      flowerColor: 0xffe3ee,
      flowerCore: 0xe8a2b4,
      fruitColor: 0x8e1f36,
    },
  },
  {
    id: 'apple',
    name: 'Apple',
    blurb: 'Low open orchard crown, heavy with fruit',
    axiom: '!(1)A(1)',
    rules: `# An orchard tree is pruned, not wild: a short trunk that forks early into a
# few scaffold limbs, then an open vase-shaped crown with the fruiting wood
# out at the edges where the light is. The wide first fork is the whole look.

A(s) : n >= N-1 -> F(LEN*s*0.5)[&(40)L(1.05)]/(137.5)F(LEN*s*0.35)[&(32)L(1.0)][/(160)&(44)L(0.95)]/(137.5)[&(26)L(1.05)]

# Fruiting wood: short, twiggy, and leafing out as it goes
A(s) : s > 0.15 && s < 0.46 -> F(LEN*s*0.9)[&(58)L(0.9)][/(175)&(50)L(0.85)]/(137.5)[&(ANG*rand(0.85,1.3))A(s*SHRINK*0.86)][/(150)&(ANG*rand(0.9,1.35))A(s*SHRINK*0.84)]^(rand(3,11))A(s*SHRINK*0.86)

# Scaffold limbs sweep out and up, leaving the middle of the crown open
A(s) : s > 0.15 -> F(LEN*s)/(137.5)[&(ANG*rand(0.9,1.25))A(s*SHRINK*0.90)][/(148)&(ANG*rand(0.95,1.3))A(s*SHRINK*0.88)]^(rand(2,8))A(s*SHRINK*0.86)

A(s) -> F(LEN*s*0.7)[L(1.0)][/(115)&(34)L(0.95)][/(235)^(22)L(1.0)]`,
    params: {
      iterations: 10,
      angle: 58,
      step: 1.4,
      shrink: 0.86,
      trunkRadius: 0.26,
      tropism: 0.025,
      pipeExponent: 2.2,
      leafScale: 0.18,
      leafShape: 0,
      windiness: 1,
      // The orchard grammar is deliberately open, so it carries far fewer
      // leaves than the oak — the same fruit density reads as a much heavier
      // crop here and has to come down to match.
      fruitDensity: 0.22,
      // An apple is a good deal larger than the leaf beside it; a berry is not.
      fruitSize: 0.72,
      fruitShape: 1,
    },
    palette: {
      barkDark: 0x241a13,
      barkLight: 0x7a6349,
      twig: 0x6f5b3c,
      moss: 0x51602c,
      leafBase: 0x2c5321,
      leafTip: 0x7ea23a,
      leafAutumn: 0xc8871f,
      blossom: 0xfbe4ea,
      flowerColor: 0xfdeef2,
      flowerCore: 0xf0c25a,
      fruitColor: 0xa32617,
    },
  },
  {
    id: 'rowan',
    name: 'Rowan',
    blurb: 'Upright and airy, hung with orange berries',
    axiom: '!(1)F(LEN*0.45)A(1)',
    rules: `# Sorbus aucuparia: a slender, steeply ascending tree with an open oval
# crown. Narrow branch angles and a strong upward tropism are what keep it
# from spreading into an oak.

A(s) : n >= N-1 -> F(LEN*s*0.45)[&(30)L(0.95)][/(150)&(36)L(0.9)]/(137.5)F(LEN*s*0.35)[&(24)L(0.95)][/(170)&(32)L(0.85)]

A(s) : s > 0.14 && s < 0.5 -> F(LEN*s)[&(46)L(0.85)][/(185)&(40)L(0.8)]/(137.5)[&(ANG*rand(0.8,1.25))A(s*SHRINK*0.82)][/(160)&(ANG*rand(0.85,1.3))A(s*SHRINK*0.80)]^(rand(2,7))A(s*SHRINK*0.86)

A(s) : s > 0.14 -> F(LEN*s)/(137.5)[&(ANG*rand(0.8,1.25))A(s*SHRINK*0.82)][/(160)&(ANG*rand(0.85,1.3))A(s*SHRINK*0.80)]^(rand(1,6))A(s*SHRINK*0.88)

A(s) -> F(LEN*s*0.8)[L(0.9)][/(125)&(26)L(0.85)][/(245)^(18)L(0.9)]`,
    params: {
      iterations: 11,
      angle: 38,
      step: 1.5,
      shrink: 0.88,
      trunkRadius: 0.2,
      tropism: 0.077,
      pipeExponent: 2.4,
      leafScale: 0.11,
      leafShape: 3,
      windiness: 1.2,
      fruitDensity: 0.55,
      fruitSize: 0.5,
    },
    palette: {
      barkDark: 0x2a241d,
      barkLight: 0x8e8676,
      twig: 0x7d7355,
      moss: 0x55622f,
      leafBase: 0x335b28,
      leafTip: 0x7fa63f,
      leafAutumn: 0xcf6a24,
      blossom: 0xf6f2e0,
      flowerColor: 0xfaf6e6,
      flowerCore: 0xe6d38a,
      fruitColor: 0xe1541a,
    },
  },
  {
    id: 'baobab',
    name: 'Baobab',
    blurb: 'Colossal trunk, stubby crown of thick limbs',
    // A baobab is mostly trunk: a great bottle with the crown on top.
    axiom: '!(1)F(LEN*0.8)A(1)',
    rules: `A(s) : n >= N-1 -> F(LEN*s)[L(0.8)][/(72)&(30)L(0.75)][/(144)^(20)L(0.8)][/(216)&(26)L(0.7)][/(288)^(16)L(0.75)]

# Stubby outer twigs carry the whole canopy
A(s) : s > 0.10 && s < 0.42 -> F(LEN*s)[&(54)L(0.7)][/(180)&(48)L(0.65)]/(137.5)[&(ANG*rand(0.8,1.3))A(s*SHRINK*0.80)][/(140)&(ANG*rand(0.8,1.3))A(s*SHRINK*0.78)]A(s*SHRINK*0.82)

A(s) : s > 0.10 -> F(LEN*s)/(137.5)[&(ANG*rand(0.8,1.3))A(s*SHRINK*0.80)][/(140)&(ANG*rand(0.8,1.3))A(s*SHRINK*0.78)][/(260)&(ANG*rand(0.9,1.2))A(s*SHRINK*0.76)]A(s*SHRINK*0.82)

A(s) -> F(LEN*s*0.7)[L(0.75)][/(120)&(28)L(0.7)][/(240)^(18)L(0.8)]`,
    params: {
      iterations: 12,
      angle: 46,
      step: 1.7,
      shrink: 0.88,
      trunkRadius: 0.62,
      tropism: 0.036,
      pipeExponent: 1.85,
      leafScale: 0.13,
      leafShape: 0,
      windiness: 0.7,
    },
    palette: {
      barkDark: 0x352a1f,
      barkLight: 0x9d876c,
      twig: 0x8d7a55,
      moss: 0x6a6a33,
      leafBase: 0x3d5c22,
      leafTip: 0x8fa63a,
      leafAutumn: 0xbf7a22,
      blossom: 0xf4ead2,
    },
  },
  {
    id: 'bush',
    name: 'Textbook bush',
    blurb: 'The classic 3D bush from The Algorithmic Beauty of Plants',
    axiom: 'A',
    rules: `# Prusinkiewicz & Lindenmayer, figure 1.25 — parameterless, all turtle
A -> [&(ANG)F L !A]/(94.74)[&(ANG)F L !A]/(132.63)[&(ANG)F L !A]
F -> S/(180)F
S -> F L`,
    params: {
      iterations: 7,
      angle: 45,
      step: 0.19,
      shrink: 0.9,
      trunkRadius: 0.2,
      tropism: 0.06,
      pipeExponent: 2.4,
      leafScale: 0.1,
      leafShape: 0,
      windiness: 1.4,
    },
    palette: {
      barkDark: 0x1f1810,
      barkLight: 0x655637,
      twig: 0x6f7038,
      moss: 0x50612c,
      leafBase: 0x2f6124,
      leafTip: 0x9cc247,
      leafAutumn: 0xcf8a24,
      blossom: 0xf0e2c6,
    },
  },
];

export const DEFAULT_PRESET_ID = 'oak';

export function getPreset(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}
