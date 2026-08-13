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
    axiom: '!(1)A(1)',
    rules: `# Terminal generation: the last apex becomes a leafy shoot rather than
# a single rosette, so leaves spread along the twig instead of bunching
A(s) : n >= N-1 -> F(LEN*s*0.4)[&(38)L(1.15)]/(137.5)F(LEN*s*0.3)[&(30)L(1.0)]/(137.5)F(LEN*s*0.3)[&(42)L(1.1)]/(137.5)[&(25)L(0.95)][/(150)&(34)L(1.05)]

# Outer crown: same fork, but leafing out as it runs
A(s) : s > 0.16 && s < 0.52 -> F(LEN*s)[&(52)L(0.85)][/(180)&(46)L(0.8)]/(137.5)[&(ANG*rand(0.75,1.25))A(s*SHRINK*0.80)][/(155)&(ANG*rand(0.8,1.3))A(s*SHRINK*0.78)]^(rand(1,7))A(s*SHRINK)

# Structural limbs, still too thick to carry leaves
A(s) : s > 0.16 -> F(LEN*s)/(137.5)[&(ANG*rand(0.75,1.25))A(s*SHRINK*0.80)][/(155)&(ANG*rand(0.8,1.3))A(s*SHRINK*0.78)]^(rand(1,7))A(s*SHRINK)

# Too thin to branch again
A(s) -> F(LEN*s*0.8)[L(1.1)][/(120)&(30)L(1.0)][/(240)^(20)L(1.05)]`,
    params: {
      iterations: 10,
      angle: 34,
      step: 1.15,
      shrink: 0.88,
      trunkRadius: 0.32,
      tropism: 0.05,
      pipeExponent: 2.3,
      leafScale: 0.14,
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
    blurb: 'Broad dome hung with long trailing shoots',
    axiom: '!(1)A(1)',
    rules: `# Salix babylonica: a stout trunk under a broad dome, spread roughly equal
# to height, hung with unbranched shoots 50-70% of the tree's height that
# sweep down to near ground level. The shoots are the whole silhouette, so
# nearly every generation is spent making them long rather than branchy.

# Anything unresolved on the last step just leafs out — a V here would have no
# generation left to expand into a shoot.
A(s) : n >= N-1 -> F(LEN*s)[&(76)L(0.8)][/(140)&(84)L(0.75)][/(250)&(70)L(0.8)]

# Trunk, then an open framework of ascending scaffolds. A wide angle is what
# gets the spread out to match the height.
A(s) : s > 0.36 -> F(LEN*s)/(137.5)[&(ANG*rand(0.85,1.15))A(s*SHRINK*0.86)][/(158)&(ANG*rand(0.9,1.2))A(s*SHRINK*0.84)]$&(5)A(s*SHRINK*0.94)

A(s) -> C(s, 0)

# The scaffold has to CLIMB before it sheds anything. A shoot hangs a fixed
# length, so one dropped low simply runs into the ground — the height gained
# here is what the curtain hangs from. After $ the frame is levelled, so & now
# tilts toward the sky and ^ toward the ground.
C(s, k) : k < 6 -> F(LEN*s*1.15)$&(rand(9,17))+(rand(-26,26))C(s*0.95, k+1)

# Only the outer, highest reach of the scaffold arches over and weeps.
C(s, k) : k < 9 -> F(LEN*s*1.05)$^(rand(4,11))+(rand(-24,24))[V(s)]C(s*0.93, k+1)
C(s, k) -> V(s)

# A curtain. The $ levels the frame against the horizon first, so the pitch
# after it is measured from the ground rather than from whatever roll the limb
# was carrying — otherwise shoots launch sideways and run out of generations
# before gravity turns them over. Straight down is the stable point of the
# tropism, so a strong T settles the shoot to vertical and holds it there.
V(s) -> [$^(108)T(-1.7)W(s, 0)]

# The shoot itself: unbranched, leafy the whole way, and a decay near 1 so it
# keeps running for every generation it is given.
W(s, j) : j < 14 -> F(LEN*s*1.1)[/(70)L(0.95)][/(190)L(0.9)][/(300)L(0.95)]/(137.5)W(s*0.99, j+1)
W(s, j) -> L(0.85)`,
    params: {
      iterations: 22,
      angle: 62,
      step: 0.92,
      shrink: 0.9,
      trunkRadius: 0.26,
      tropism: 0.05,
      pipeExponent: 2.6,
      leafScale: 0.19,
      leafShape: 3,
      windiness: 1.5,
    },
    palette: {
      barkDark: 0x1c1811,
      barkLight: 0x655a41,
      twig: 0x7d7a46,
      moss: 0x4a5a2c,
      leafBase: 0x466a2b,
      leafTip: 0xa8bd5a,
      leafAutumn: 0xd0a72e,
      blossom: 0xeee0c0,
    },
  },
  {
    id: 'pine',
    name: 'Pine',
    blurb: 'Conical, four-branch whorls, needle sprays',
    axiom: '!(1)A(1)',
    rules: `A(s) : n >= N-1 -> F(LEN*s)[L(0.6)][/(120)L(0.6)][/(240)L(0.6)]

# A whorl of five near-horizontal limbs, then the leader carries on up
A(s) : s > 0.18 -> F(LEN*s)[&(ANG)B(s*0.55)]/(72)[&(ANG)B(s*0.55)]/(72)[&(ANG)B(s*0.55)]/(72)[&(ANG)B(s*0.55)]/(72)[&(ANG)B(s*0.55)]/(40)A(s*SHRINK)

A(s) -> F(LEN*s)[L(0.7)][/(120)L(0.65)][/(240)L(0.7)]

# Limbs never fork — they run outward clothed in needle sprays the whole way
B(s) : s > 0.05 -> F(LEN*s*0.8)[/(50)&(52)L(0.75)][/(140)&(46)L(0.7)][/(230)&(56)L(0.75)][/(320)&(42)L(0.7)]&(3)B(s*0.86)
B(s) -> [L(0.8)][/(120)L(0.75)][/(240)L(0.8)]`,
    params: {
      iterations: 14,
      angle: 68,
      step: 0.85,
      shrink: 0.93,
      trunkRadius: 0.3,
      tropism: 0.02,
      pipeExponent: 3.0,
      leafScale: 0.32,
      leafShape: 1,
      windiness: 0.55,
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
    },
  },
  {
    id: 'birch',
    name: 'Birch',
    blurb: 'Slender and upright, sparse airy canopy',
    axiom: '!(1)A(1)',
    rules: `A(s) : n >= N-1 -> F(LEN*s)[L(1.0)][/(96)&(30)L(0.9)][/(192)^(22)L(0.95)][/(288)&(26)L(0.85)]

# Thin shoots leaf out along their length
A(s) : s > 0.12 && s < 0.42 -> F(LEN*s)[&(56)L(0.85)][/(180)&(50)L(0.8)]/(137.5)[&(ANG*rand(0.7,1.25))A(s*SHRINK*0.72)]^(rand(0,5))A(s*SHRINK)

# A single alternating side shoot per node keeps the crown open
A(s) : s > 0.12 -> F(LEN*s)/(137.5)[&(ANG*rand(0.7,1.25))A(s*SHRINK*0.72)]^(rand(0,5))A(s*SHRINK)

A(s) -> F(LEN*s*0.9)[L(0.95)][/(120)&(28)L(0.9)][/(240)^(18)L(0.85)]`,
    params: {
      iterations: 12,
      angle: 28,
      step: 1.0,
      shrink: 0.9,
      trunkRadius: 0.22,
      tropism: 0.14,
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
    axiom: '!(1)A(1)',
    rules: `A(s) : n >= N-1 -> F(LEN*s)[K(1.1)][/(72)&(26)K(1.0)][/(144)^(20)K(1.05)][/(216)&(30)K(0.95)][/(288)^(16)K(1.0)]

# Outer twigs are smothered in blossom
A(s) : s > 0.17 && s < 0.5 -> F(LEN*s)[&(50)K(0.95)][/(180)&(44)K(0.9)]/(137.5)[&(ANG*rand(0.9,1.4))A(s*SHRINK*0.76)][/(165)&(ANG*rand(0.9,1.4))A(s*SHRINK*0.74)]^(rand(2,10))A(s*SHRINK*0.97)

A(s) : s > 0.17 -> F(LEN*s)/(137.5)[&(ANG*rand(0.9,1.4))A(s*SHRINK*0.76)][/(165)&(ANG*rand(0.9,1.4))A(s*SHRINK*0.74)]^(rand(2,10))A(s*SHRINK*0.97)

A(s) -> F(LEN*s*0.8)[K(1.0)][/(90)&(28)L(0.6)][/(200)^(20)K(0.9)]`,
    params: {
      iterations: 10,
      angle: 42,
      step: 1.05,
      shrink: 0.87,
      trunkRadius: 0.36,
      tropism: -0.02,
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
A(s) : s > 0.15 && s < 0.46 -> F(LEN*s*0.9)[&(58)L(0.9)][/(175)&(50)L(0.85)]/(137.5)[&(ANG*rand(0.85,1.3))A(s*SHRINK*0.74)][/(150)&(ANG*rand(0.9,1.35))A(s*SHRINK*0.72)]^(rand(3,11))A(s*SHRINK*0.93)

# Scaffold limbs sweep out and up, leaving the middle of the crown open
A(s) : s > 0.15 -> F(LEN*s)/(137.5)[&(ANG*rand(0.9,1.25))A(s*SHRINK*0.80)][/(148)&(ANG*rand(0.95,1.3))A(s*SHRINK*0.78)]^(rand(2,8))A(s*SHRINK*0.96)

A(s) -> F(LEN*s*0.7)[L(1.0)][/(115)&(34)L(0.95)][/(235)^(22)L(1.0)]`,
    params: {
      iterations: 10,
      angle: 46,
      step: 1.0,
      shrink: 0.86,
      trunkRadius: 0.26,
      tropism: 0.03,
      pipeExponent: 2.2,
      leafScale: 0.165,
      leafShape: 0,
      windiness: 1,
      // The orchard grammar is deliberately open, so it carries far fewer
      // leaves than the oak — the same fruit density reads as a much heavier
      // crop here and has to come down to match.
      fruitDensity: 0.22,
      // An apple is a good deal larger than the leaf beside it; a berry is not.
      fruitSize: 0.75,
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
      fruitColor: 0x8f1d13,
    },
  },
  {
    id: 'rowan',
    name: 'Rowan',
    blurb: 'Upright and airy, hung with orange berries',
    axiom: '!(1)A(1)',
    rules: `# Sorbus aucuparia: a slender, steeply ascending tree with an open oval
# crown. Narrow branch angles and a strong upward tropism are what keep it
# from spreading into an oak.

A(s) : n >= N-1 -> F(LEN*s*0.45)[&(30)L(0.95)][/(150)&(36)L(0.9)]/(137.5)F(LEN*s*0.35)[&(24)L(0.95)][/(170)&(32)L(0.85)]

A(s) : s > 0.14 && s < 0.5 -> F(LEN*s)[&(46)L(0.85)][/(185)&(40)L(0.8)]/(137.5)[&(ANG*rand(0.8,1.25))A(s*SHRINK*0.78)][/(160)&(ANG*rand(0.85,1.3))A(s*SHRINK*0.76)]^(rand(2,7))A(s*SHRINK*0.95)

A(s) : s > 0.14 -> F(LEN*s)/(137.5)[&(ANG*rand(0.8,1.25))A(s*SHRINK*0.78)][/(160)&(ANG*rand(0.85,1.3))A(s*SHRINK*0.76)]^(rand(1,6))A(s*SHRINK*0.97)

A(s) -> F(LEN*s*0.8)[L(0.9)][/(125)&(26)L(0.85)][/(245)^(18)L(0.9)]`,
    params: {
      iterations: 11,
      angle: 30,
      step: 1.0,
      shrink: 0.88,
      trunkRadius: 0.2,
      tropism: 0.13,
      pipeExponent: 2.4,
      leafScale: 0.1,
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
    axiom: '!(1)A(1)',
    rules: `A(s) : n >= N-1 -> F(LEN*s)[L(0.8)][/(72)&(30)L(0.75)][/(144)^(20)L(0.8)][/(216)&(26)L(0.7)][/(288)^(16)L(0.75)]

# Stubby outer twigs carry the whole canopy
A(s) : s > 0.10 && s < 0.42 -> F(LEN*s)[&(54)L(0.7)][/(180)&(48)L(0.65)]/(137.5)[&(ANG*rand(0.8,1.3))A(s*SHRINK*0.70)][/(140)&(ANG*rand(0.8,1.3))A(s*SHRINK*0.68)]A(s*SHRINK*0.95)

A(s) : s > 0.10 -> F(LEN*s)/(137.5)[&(ANG*rand(0.8,1.3))A(s*SHRINK*0.70)][/(140)&(ANG*rand(0.8,1.3))A(s*SHRINK*0.68)][/(260)&(ANG*rand(0.9,1.2))A(s*SHRINK*0.66)]A(s*SHRINK*0.95)

A(s) -> F(LEN*s*0.7)[L(0.75)][/(120)&(28)L(0.7)][/(240)^(18)L(0.8)]`,
    params: {
      iterations: 12,
      angle: 38,
      step: 1.1,
      shrink: 0.88,
      trunkRadius: 0.62,
      tropism: 0.08,
      pipeExponent: 1.85,
      leafScale: 0.115,
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
