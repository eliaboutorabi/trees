/**
 * Parsing for the L-system source text: modules, axioms and productions.
 *
 * Production syntax:
 *
 *   A(t, r) : t > 0 @ 0.6 -> F(r) [ +(25) A(t-1, r*0.7) ] -(25) A(t-1, r*0.8)
 *   ^-------  ^-------- ^-----    ^--------------------------------------------
 *   predecessor  condition  probability                       successor
 *
 * The condition and probability are both optional. `#` starts a comment.
 */
import { compileExpr, type Compiled, type EvalEnv } from './expr';

/** A module is one symbol plus its numeric parameters, e.g. `F(0.8, 0.05)`. */
export interface Module {
  s: string;
  p: number[];
}

export interface ModuleTemplate {
  s: string;
  args: Compiled[];
}

export interface Production {
  pred: string;
  params: string[];
  cond: Compiled | null;
  prob: Compiled | null;
  succ: ModuleTemplate[];
  /** Original source line, kept for display and error messages. */
  src: string;
}

/** Turtle symbols that carry no alphabetic name. */
export const TURTLE_SYMBOLS = '+-&^\\/|[]!$~%';

function isSymbolChar(c: string): boolean {
  return /[A-Za-z]/.test(c) || TURTLE_SYMBOLS.includes(c);
}

/** Split `a, b*(c,d)` on top-level commas only. */
function splitArgs(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(src.slice(start, i));
      start = i + 1;
    }
  }
  out.push(src.slice(start));
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Parse a word like `F(1)[+(25)A(3)]` into module templates. */
export function parseModuleTemplates(src: string): ModuleTemplate[] {
  const out: ModuleTemplate[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (!isSymbolChar(c)) throw new Error(`unexpected character "${c}"`);
    i++;
    let args: Compiled[] = [];
    // `[` and `]` never take parameters — a following "(" belongs to the next module.
    if (c !== '[' && c !== ']' && src[i] === '(') {
      let depth = 0;
      let j = i;
      for (; j < src.length; j++) {
        if (src[j] === '(') depth++;
        else if (src[j] === ')') {
          depth--;
          if (depth === 0) break;
        }
      }
      if (depth !== 0) throw new Error(`unbalanced "(" after "${c}"`);
      args = splitArgs(src.slice(i + 1, j)).map(compileExpr);
      i = j + 1;
    }
    out.push({ s: c, args });
  }
  return out;
}

/** Parse an axiom — a word whose parameters must be constant expressions. */
export function parseAxiom(src: string, globals: EvalEnv): Module[] {
  const templates = parseModuleTemplates(src);
  const rng = () => 0.5;
  return templates.map((t) => ({ s: t.s, p: t.args.map((a) => a(globals, rng)) }));
}

/** Find `idx` of `needle` in `src` that is not nested inside parentheses. */
function indexOfTopLevel(src: string, needle: string, from = 0): number {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && src.startsWith(needle, i)) return i;
  }
  return -1;
}

export function parseProduction(line: string): Production {
  const arrow = indexOfTopLevel(line, '->');
  if (arrow < 0) throw new Error('missing "->"');
  let lhs = line.slice(0, arrow).trim();
  const rhs = line.slice(arrow + 2).trim();

  let prob: Compiled | null = null;
  const at = indexOfTopLevel(lhs, '@');
  if (at >= 0) {
    prob = compileExpr(lhs.slice(at + 1));
    lhs = lhs.slice(0, at).trim();
  }

  let cond: Compiled | null = null;
  const colon = indexOfTopLevel(lhs, ':');
  if (colon >= 0) {
    cond = compileExpr(lhs.slice(colon + 1));
    lhs = lhs.slice(0, colon).trim();
  }

  if (!lhs) throw new Error('missing predecessor');
  const pred = lhs[0];
  if (!isSymbolChar(pred)) throw new Error(`"${pred}" is not a valid symbol`);

  let params: string[] = [];
  const rest = lhs.slice(1).trim();
  if (rest) {
    if (!rest.startsWith('(') || !rest.endsWith(')')) {
      throw new Error(`expected "(params)" after "${pred}", got "${rest}"`);
    }
    params = splitArgs(rest.slice(1, -1));
    for (const p of params) {
      if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(p)) throw new Error(`"${p}" is not a valid parameter name`);
    }
  }

  return { pred, params, cond, prob, succ: parseModuleTemplates(rhs), src: line.trim() };
}

export interface ParsedRules {
  productions: Production[];
  errors: { line: number; text: string; message: string }[];
}

export function parseRules(text: string): ParsedRules {
  const productions: Production[] = [];
  const errors: ParsedRules['errors'] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const withoutComment = lines[i].split('#')[0].trim();
    if (!withoutComment) continue;
    try {
      productions.push(parseProduction(withoutComment));
    } catch (err) {
      errors.push({ line: i + 1, text: withoutComment, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { productions, errors };
}

/** Render a module list back to source text (used for the axiom display). */
export function moduleToString(m: Module): string {
  if (m.p.length === 0) return m.s;
  return `${m.s}(${m.p.map((v) => (Number.isInteger(v) ? v : v.toFixed(2))).join(', ')})`;
}
