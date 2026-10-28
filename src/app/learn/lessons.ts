/**
 * The Learn page's course: how to write a tree, one idea at a time.
 *
 * Each lesson is a short read and a grammar to play with. They are in the
 * order the ideas build on each other — a turtle, a rule, a branch, a bud,
 * numbers, conditions, chance, depth, the sliders, gravity — and end on a
 * real tree from the garden, which by then uses nothing you have not seen.
 *
 * Body text is plain, with `code` in backticks and *emphasis* in stars.
 */
import { getPreset } from '../../engine';
import type { SketchLook, SketchSource } from './sketch';

export type Knob = 'angle' | 'step' | 'shrink' | 'tropism' | 'seed';

export interface Lesson {
  id: string;
  title: string;
  body: string[];
  source: SketchSource;
  /** Highest the generations control goes; none when the grammar has no rules. */
  maxIterations?: number;
  look: SketchLook;
  /** Leaf size on the board, in the drawing's own units. */
  leafScale?: number;
  /** Show the derived word: worth it while it is short enough to read. */
  showWord?: boolean;
  /** The controls under the drawing, besides generations. */
  knobs?: Knob[];
  /** Small things to change, to see what happens. */
  tries?: string[];
  /** Tree enough, and sized to suit, to plant in the garden. */
  plant?: boolean;
}

const base = { step: 1, shrink: 0.8, tropism: 0, seed: 7 };

const oak = getPreset('oak');

export const LESSONS: Lesson[] = [
  {
    id: 'turtle',
    title: 'A turtle with a pen',
    body: [
      'Every tree in the garden is drawn by a turtle holding a pen. It reads a line of symbols, left to right, and does what each one says.',
      '`F` means *walk forward one step, drawing*. `+` means *turn left* by the angle, and `-` means *turn right*. So the line below says: two steps, turn, two steps, turn — four times over.',
    ],
    source: { ...base, axiom: 'FF+FF+FF+FF', rules: '# No rules yet: the turtle simply walks the start.', iterations: 0, angle: 90 },
    look: 'line',
    knobs: ['angle'],
    tries: ['Set the angle to 60 and add two more `FF+`.', 'What does `F+F-F` draw?', 'Add a lone `F` in a corner: `FF+FFF+FF+FF`.'],
  },
  {
    id: 'rewriting',
    title: 'One rule, everywhere at once',
    body: [
      'A drawing that never changes is just a drawing. What makes this an L-system is a *rule*: `F -> F+F-F-F+F` means *wherever there is an F, put all of this instead*.',
      'Every `F` is replaced at the same moment — that is one *generation*. Then it happens again, to the new, longer word. Step the generations under the drawing and watch the word below it: five times longer every time, the same bend at every scale.',
    ],
    source: { ...base, axiom: 'F', rules: 'F -> F+F-F-F+F', iterations: 3, angle: 90 },
    maxIterations: 5,
    look: 'line',
    showWord: true,
    knobs: ['angle'],
    tries: ['Turn the angle down to 80°, then 60°.', 'Make the bump stick out the other way: `F -> F-F+F+F-F`.', 'Try `F -> F+F--F+F` at 60° — a snowflake edge.'],
  },
  {
    id: 'branches',
    title: 'Branches',
    body: [
      'Here is the idea that makes plants possible. `[` tells the turtle to *remember where it is and which way it faces*; `]` sends it straight back there.',
      'Between the two it can wander off and draw a side branch, then carry on as if nothing had happened. One rule with two pairs of brackets, and something like a weed comes up.',
    ],
    source: { ...base, axiom: 'F', rules: 'F -> F[+F]F[-F]F', iterations: 4, angle: 25.7 },
    maxIterations: 5,
    look: 'tree',
    showWord: true,
    knobs: ['angle'],
    tries: ['Delete the `[-F]` branch: it leans the whole way over.', 'Add a third: `F -> F[+F]F[-F][F]`.', 'Push the angle past 60°.'],
  },
  {
    id: 'buds',
    title: 'Buds: symbols that draw nothing',
    body: [
      'Not every symbol draws. A letter the turtle does not know — `X` here — is a *bud*. It is invisible, but rules still rewrite it, so it is where growth happens.',
      'Two rules now, and both apply every generation: the buds branch, and `F -> FF` makes the old wood longer, as a real stem lengthens while the tips grow on.',
    ],
    source: { ...base, axiom: 'X', rules: 'X -> F+[[X]-X]-F[-FX]+X\nF -> FF', iterations: 5, angle: 25 },
    maxIterations: 6,
    look: 'tree',
    knobs: ['angle'],
    tries: ['Remove the `F -> FF` rule: the stem stops lengthening.', 'Swap every `+` and `-` in the first rule.', 'Change the start to `X+X`.'],
  },
  {
    id: 'parameters',
    title: 'Numbers in symbols',
    body: [
      'Symbols can carry numbers. `F(2)` walks two steps, `+(35)` turns 35°. And a rule can name the numbers it is given: `A(s)` receives one and calls it `s`, so its right-hand side can do arithmetic with it.',
      'Here every branch is 70% as long as the one it grew from — which is most of what makes a tree look like a tree rather than a fractal.',
    ],
    source: { ...base, axiom: 'A(4)', rules: 'A(s) -> F(s)[+(35)A(s*0.7)][-(35)A(s*0.7)]', iterations: 7, angle: 35 },
    maxIterations: 10,
    look: 'tree',
    tries: ['Make the sides differ: `A(s*0.6)` on one, `A(s*0.8)` on the other.', 'Turn left 20° and right 45°.', 'Add a leader that carries on: put `A(s*0.8)` at the very end.'],
  },
  {
    id: 'conditions',
    title: 'Conditions, and leaves',
    body: [
      'Write `: condition` after a rule\'s left side and it only applies while that is true. Rules are tried top to bottom and the *first match wins* — so the special case goes first, and the fallback last.',
      'This shoot keeps branching while it is longer than half a step. After that the second rule takes over and turns it into a leaf, `L`. The tree now knows when it is finished: add generations and nothing changes.',
    ],
    source: { ...base, axiom: 'A(4)', rules: 'A(s) : s > 0.5 -> F(s)[+(30)A(s*0.75)][-(30)A(s*0.75)]\nA(s) -> L(1)', iterations: 10, angle: 30 },
    maxIterations: 12,
    look: 'tree',
    tries: ['Change `0.5` to `1`: a younger tree.', 'Use `K(1)` instead of `L(1)` — blossom.', 'Leaves in threes: `A(s) -> [+(40)L(1)][-(40)L(1)]L(1)`.'],
    plant: true,
  },
  {
    id: 'chance',
    title: 'A little chance',
    body: [
      'Real trees never repeat themselves. Give rules a weight with `@` and, where several match, one is picked at random each time, in proportion to its weight. Here a shoot forks six times in ten and sends out a single side shoot otherwise.',
      '`rand(a, b)` picks a number between `a` and `b`, so no two angles are the same either. Roll the dice under the drawing for another tree from the same rules.',
    ],
    source: {
      ...base,
      axiom: 'A(4)',
      rules:
        'A(s) : s > 0.5 @ 0.6 -> F(s)[+(rand(20,45))A(s*0.75)][-(rand(20,45))A(s*0.75)]\nA(s) : s > 0.5 @ 0.4 -> F(s)[+(rand(20,40))A(s*0.7)]A(s*0.85)\nA(s) -> L(1)',
      iterations: 12,
      angle: 30,
    },
    maxIterations: 14,
    look: 'tree',
    knobs: ['seed'],
    tries: ['Weigh the single shoot more: swap `0.6` and `0.4`.', 'Widen the angles to `rand(10,70)`.'],
    plant: true,
  },
  {
    id: 'depth',
    title: 'Off the page',
    body: [
      'So far the turtle has lived on a flat sheet. Four more symbols lift it off: `&` pitches it down, `^` up, and `/` and `\\` roll it about its own heading.',
      'Rolling by 137.5° between branches — the *golden angle* — is how real plants spread their shoots, so that no branch sits right above another and every one gets light. Drag the drawing to turn it.',
    ],
    source: {
      ...base,
      axiom: 'A(3)',
      rules: 'A(s) : s > 0.5 -> F(s)/(137.5)[&(40)A(s*0.72)]/(137.5)[&(40)A(s*0.72)]A(s*0.8)\nA(s) -> L(1)',
      iterations: 14,
      angle: 40,
    },
    maxIterations: 16,
    look: 'tree',
    tries: ['Roll 90° instead of 137.5°: the branches stack up in flat rows.', 'Pitch the branches further: `&(70)`.', 'Lean the leader a little: `^(5)A(s*0.8)`.'],
    plant: true,
  },
  {
    id: 'globals',
    title: 'The sliders are names',
    body: [
      'A grammar can read the tree\'s sliders by name: `ANG` is the branch angle, `LEN` the length of a step, `SHRINK` how much each generation contracts, `N` the number of generations and `n` the one being rewritten now.',
      'Write a rule in those names and it becomes a whole family of trees — move the sliders under the drawing. `n >= N-1` means *this is the last generation*: it is how every tree in the garden turns its last buds into leaves.',
    ],
    source: {
      ...base,
      axiom: 'A(1)',
      rules: 'A(s) : n >= N-1 -> L(1)\nA(s) -> F(LEN*s)/(137.5)[&(ANG)A(s*SHRINK)]/(137.5)[&(ANG)A(s*SHRINK)]A(s*SHRINK)',
      iterations: 7,
      angle: 38,
      step: 1.6,
      shrink: 0.8,
    },
    maxIterations: 8,
    look: 'tree',
    knobs: ['angle', 'step', 'shrink'],
    tries: ['Give the leader its own pace: `A(s*SHRINK*1.1)` at the end.', 'Vary the angle: `&(ANG*rand(0.7,1.3))`.'],
    plant: true,
  },
  {
    id: 'gravity',
    title: 'Gravity',
    body: [
      'A long branch sags under its own weight, or reaches for the light. `T(e)` sets that for a branch: below zero it droops, above it lifts, a little more with every step the turtle takes. The Tropism slider sets it for every branch that does not say.',
      'Gravity cannot bend a shoot that points straight up — there is no sideways for it to pull — so these weeping shoots set off at 55° before `T(-0.28)` takes them down.',
    ],
    source: {
      ...base,
      axiom: 'A(2.5)',
      rules:
        'A(s) : s > 0.55 -> F(s)/(137.5)[&(55)B(s*0.75)]/(137.5)[&(55)B(s*0.75)]A(s*0.82)\nA(s) -> L(1)\nB(s) : s > 0.2 -> T(-0.28)F(s*0.7)[&(40)L(0.8)]B(s*0.88)\nB(s) -> L(1)',
      iterations: 26,
      angle: 40,
    },
    maxIterations: 30,
    look: 'tree',
    knobs: ['tropism'],
    tries: ['Make it reach instead: `T(0.2)`.', 'Start the shoots steeper, `&(20)`, and watch them take longer to turn.', 'Drag the Tropism slider: the trunk and limbs follow it.'],
    plant: true,
  },
  {
    id: 'oak',
    title: 'A real tree',
    body: [
      'That is the whole language. The oak in the garden is written in nothing else: four rules, tried in order — leaves on the last generation, a leafy outer crown, bare structural limbs, and a fallback for twigs too thin to branch again.',
      'Read it top to bottom; you know every symbol in it now. Then change something, and plant it in the garden.',
    ],
    source: {
      axiom: oak.axiom,
      rules: oak.rules,
      iterations: 9,
      angle: oak.params.angle,
      step: oak.params.step,
      shrink: oak.params.shrink,
      tropism: oak.params.tropism,
      seed: 1337,
    },
    maxIterations: 10,
    look: 'tree',
    leafScale: 0.2,
    knobs: ['angle', 'shrink', 'seed'],
    tries: ['Find the `137.5` rolls, and change them.', 'Open the crown: raise `ANG`.', 'Give it blossom: change one `L` to a `K`.'],
    plant: true,
  },
];

/** Lesson prose to HTML: escaped, with `code` and *emphasis*. */
export function prose(text: string, code: (src: string) => string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .split(/(`[^`]+`)/)
    .map((part) =>
      part.startsWith('`') && part.endsWith('`')
        ? `<code>${code(part.slice(1, -1))}</code>`
        : escape(part).replace(/\*([^*]+)\*/g, '<em>$1</em>'),
    )
    .join('');
}
