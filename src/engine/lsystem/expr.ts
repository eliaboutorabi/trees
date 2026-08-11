/**
 * A tiny arithmetic expression compiler for parametric L-system rules.
 *
 * Supports numbers, variables, the usual arithmetic/comparison/logical
 * operators, and a handful of math builtins. Compiles once to a closure so
 * derivation stays fast even for hundreds of thousands of modules.
 */
import type { Rng } from '../../lib/rng';

export type EvalEnv = Record<string, number>;
export type Compiled = (env: EvalEnv, rng: Rng) => number;

type TokKind = 'num' | 'id' | 'op' | 'lparen' | 'rparen' | 'comma';
interface Tok {
  kind: TokKind;
  text: string;
  num?: number;
}

const OPERATORS = ['<=', '>=', '==', '!=', '&&', '||', '<', '>', '+', '-', '*', '/', '%', '^', '!'];

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      let j = i;
      while (j < src.length && ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')) j++;
      if ((src[j] === 'e' || src[j] === 'E') && /[0-9+-]/.test(src[j + 1] ?? '')) {
        j++;
        if (src[j] === '+' || src[j] === '-') j++;
        while (j < src.length && src[j] >= '0' && src[j] <= '9') j++;
      }
      const text = src.slice(i, j);
      const num = Number(text);
      if (!Number.isFinite(num)) throw new Error(`invalid number "${text}"`);
      toks.push({ kind: 'num', text, num });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z_0-9]/.test(src[j])) j++;
      toks.push({ kind: 'id', text: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '(') {
      toks.push({ kind: 'lparen', text: c });
      i++;
      continue;
    }
    if (c === ')') {
      toks.push({ kind: 'rparen', text: c });
      i++;
      continue;
    }
    if (c === ',') {
      toks.push({ kind: 'comma', text: c });
      i++;
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (!op) throw new Error(`unexpected character "${c}"`);
    toks.push({ kind: 'op', text: op });
    i += op.length;
  }
  return toks;
}

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp(e1 === e0 ? 0 : (x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

const FUNCTIONS: Record<string, { arity: number[]; fn: (args: number[], rng: Rng) => number }> = {
  rand: { arity: [0, 1, 2], fn: (a, rng) => (a.length === 0 ? rng() : a.length === 1 ? rng() * a[0] : a[0] + rng() * (a[1] - a[0])) },
  sin: { arity: [1], fn: (a) => Math.sin(a[0]) },
  cos: { arity: [1], fn: (a) => Math.cos(a[0]) },
  tan: { arity: [1], fn: (a) => Math.tan(a[0]) },
  abs: { arity: [1], fn: (a) => Math.abs(a[0]) },
  sqrt: { arity: [1], fn: (a) => Math.sqrt(Math.max(0, a[0])) },
  floor: { arity: [1], fn: (a) => Math.floor(a[0]) },
  ceil: { arity: [1], fn: (a) => Math.ceil(a[0]) },
  round: { arity: [1], fn: (a) => Math.round(a[0]) },
  sign: { arity: [1], fn: (a) => Math.sign(a[0]) },
  exp: { arity: [1], fn: (a) => Math.exp(a[0]) },
  log: { arity: [1], fn: (a) => Math.log(Math.max(1e-9, a[0])) },
  rad: { arity: [1], fn: (a) => (a[0] * Math.PI) / 180 },
  deg: { arity: [1], fn: (a) => (a[0] * 180) / Math.PI },
  min: { arity: [2], fn: (a) => Math.min(a[0], a[1]) },
  max: { arity: [2], fn: (a) => Math.max(a[0], a[1]) },
  pow: { arity: [2], fn: (a) => Math.pow(a[0], a[1]) },
  atan2: { arity: [2], fn: (a) => Math.atan2(a[0], a[1]) },
  step: { arity: [2], fn: (a) => (a[1] < a[0] ? 0 : 1) },
  clamp: { arity: [3], fn: (a) => clamp(a[0], a[1], a[2]) },
  mix: { arity: [3], fn: (a) => a[0] + (a[1] - a[0]) * a[2] },
  smoothstep: { arity: [3], fn: (a) => smoothstep(a[0], a[1], a[2]) },
};

const CONSTANTS: Record<string, number> = {
  PI: Math.PI,
  TAU: Math.PI * 2,
  E: Math.E,
  true: 1,
  false: 0,
};

class Parser {
  private pos = 0;
  private readonly toks: Tok[];
  private readonly src: string;

  constructor(toks: Tok[], src: string) {
    this.toks = toks;
    this.src = src;
  }

  parse(): Compiled {
    const node = this.parseOr();
    if (this.pos < this.toks.length) {
      throw new Error(`unexpected "${this.toks[this.pos].text}" in "${this.src}"`);
    }
    return node;
  }

  private peek(): Tok | undefined {
    return this.toks[this.pos];
  }

  private eatOp(...ops: string[]): string | null {
    const t = this.peek();
    if (t && t.kind === 'op' && ops.includes(t.text)) {
      this.pos++;
      return t.text;
    }
    return null;
  }

  private parseOr(): Compiled {
    let left = this.parseAnd();
    while (this.eatOp('||')) {
      const right = this.parseAnd();
      const l = left;
      left = (e, r) => (l(e, r) !== 0 || right(e, r) !== 0 ? 1 : 0);
    }
    return left;
  }

  private parseAnd(): Compiled {
    let left = this.parseComparison();
    while (this.eatOp('&&')) {
      const right = this.parseComparison();
      const l = left;
      left = (e, r) => (l(e, r) !== 0 && right(e, r) !== 0 ? 1 : 0);
    }
    return left;
  }

  private parseComparison(): Compiled {
    let left = this.parseAdditive();
    for (;;) {
      const op = this.eatOp('<=', '>=', '==', '!=', '<', '>');
      if (!op) break;
      const right = this.parseAdditive();
      const l = left;
      switch (op) {
        case '<': left = (e, r) => (l(e, r) < right(e, r) ? 1 : 0); break;
        case '>': left = (e, r) => (l(e, r) > right(e, r) ? 1 : 0); break;
        case '<=': left = (e, r) => (l(e, r) <= right(e, r) ? 1 : 0); break;
        case '>=': left = (e, r) => (l(e, r) >= right(e, r) ? 1 : 0); break;
        case '==': left = (e, r) => (l(e, r) === right(e, r) ? 1 : 0); break;
        default: left = (e, r) => (l(e, r) !== right(e, r) ? 1 : 0); break;
      }
    }
    return left;
  }

  private parseAdditive(): Compiled {
    let left = this.parseMultiplicative();
    for (;;) {
      const op = this.eatOp('+', '-');
      if (!op) break;
      const right = this.parseMultiplicative();
      const l = left;
      left = op === '+' ? (e, r) => l(e, r) + right(e, r) : (e, r) => l(e, r) - right(e, r);
    }
    return left;
  }

  private parseMultiplicative(): Compiled {
    let left = this.parseUnary();
    for (;;) {
      const op = this.eatOp('*', '/', '%');
      if (!op) break;
      const right = this.parseUnary();
      const l = left;
      if (op === '*') left = (e, r) => l(e, r) * right(e, r);
      else if (op === '/') left = (e, r) => { const d = right(e, r); return d === 0 ? 0 : l(e, r) / d; };
      else left = (e, r) => { const d = right(e, r); return d === 0 ? 0 : l(e, r) % d; };
    }
    return left;
  }

  private parseUnary(): Compiled {
    const op = this.eatOp('-', '+', '!');
    if (op === '-') {
      const operand = this.parseUnary();
      return (e, r) => -operand(e, r);
    }
    if (op === '+') return this.parseUnary();
    if (op === '!') {
      const operand = this.parseUnary();
      return (e, r) => (operand(e, r) === 0 ? 1 : 0);
    }
    return this.parsePower();
  }

  private parsePower(): Compiled {
    const base = this.parsePrimary();
    if (this.eatOp('^')) {
      const exp = this.parseUnary(); // right-associative
      return (e, r) => Math.pow(base(e, r), exp(e, r));
    }
    return base;
  }

  private parsePrimary(): Compiled {
    const t = this.peek();
    if (!t) throw new Error(`unexpected end of expression in "${this.src}"`);

    if (t.kind === 'num') {
      this.pos++;
      const v = t.num!;
      return () => v;
    }

    if (t.kind === 'lparen') {
      this.pos++;
      const inner = this.parseOr();
      if (this.peek()?.kind !== 'rparen') throw new Error(`missing ")" in "${this.src}"`);
      this.pos++;
      return inner;
    }

    if (t.kind === 'id') {
      this.pos++;
      const name = t.text;
      if (this.peek()?.kind === 'lparen') {
        this.pos++;
        const args: Compiled[] = [];
        if (this.peek()?.kind !== 'rparen') {
          for (;;) {
            args.push(this.parseOr());
            if (this.peek()?.kind === 'comma') {
              this.pos++;
              continue;
            }
            break;
          }
        }
        if (this.peek()?.kind !== 'rparen') throw new Error(`missing ")" after ${name}(… in "${this.src}"`);
        this.pos++;
        const def = FUNCTIONS[name];
        if (!def) throw new Error(`unknown function "${name}"`);
        if (!def.arity.includes(args.length)) {
          throw new Error(`${name}() takes ${def.arity.join(' or ')} argument(s), got ${args.length}`);
        }
        return (e, r) => def.fn(args.map((a) => a(e, r)), r);
      }
      if (name in CONSTANTS) {
        const v = CONSTANTS[name];
        return () => v;
      }
      return (e) => e[name] ?? 0;
    }

    throw new Error(`unexpected "${t.text}" in "${this.src}"`);
  }
}

export function compileExpr(src: string): Compiled {
  const trimmed = src.trim();
  if (!trimmed) throw new Error('empty expression');
  // Constant-fold the common case of a bare literal.
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber)) return () => asNumber;
  return new Parser(tokenize(trimmed), trimmed).parse();
}
