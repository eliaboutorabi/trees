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
  leafBase: number;
  leafTip: number;
  /** Where leaves head as the `autumn` slider rises. */
  leafAutumn: number;
  blossom: number;
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
  /** 0 broad leaf · 1 needle cluster · 2 rounded blossom. */
  leafShape: 0 | 1 | 2;
  /** How much this species moves in wind. */
  windiness: number;
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
    blurb: 'Weeping curtains of thin trailing shoots',
    axiom: '!(1)A(1)',
    rules: `# On the very last step there is no generation left to expand a V into
# shoots, so anything unresolved simply leafs out.
A(s) : n >= N-1 -> F(LEN*s)[&(76)L(0.9)][/(120)&(84)L(0.85)][/(240)&(70)L(0.9)]

# Structural crown
A(s) : s > 0.30 -> F(LEN*s)/(137.5)[&(ANG*rand(0.8,1.2))A(s*SHRINK*0.82)][/(150)&(ANG*rand(0.9,1.3))A(s*SHRINK*0.80)]A(s*SHRINK)

A(s) -> F(LEN*s)V(s)

# V drops a fan of trailing shoots. They must start well off vertical:
# tropism turns a shoot about heading × up, which is zero when the shoot
# points straight up — a vertical shoot would never feel gravity at all.
V(s) -> [&(76)T(-0.5)W(s*1.1)][/(120)&(84)T(-0.5)W(s*1.05)][/(240)&(70)T(-0.5)W(s*1.15)]

# The trailing shoot itself — T(-0.5) does all the weeping
W(s) : s > 0.05 -> F(LEN*s*1.1)[/(90)&(40)L(0.8)][/(250)&(38)L(0.75)]/(137.5)W(s*0.92)
W(s) -> [L(0.9)][/(120)L(0.8)]`,
    params: {
      iterations: 14,
      angle: 32,
      step: 1.0,
      shrink: 0.9,
      trunkRadius: 0.34,
      tropism: 0.1,
      pipeExponent: 2.5,
      leafScale: 0.105,
      leafShape: 0,
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
