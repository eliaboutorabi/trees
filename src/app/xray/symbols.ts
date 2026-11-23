/**
 * The alphabet, for reading: what each symbol does to the turtle, how it is
 * written, and which family it belongs to (the families are coloured as the
 * Grammar card's legend colours them).
 */

export type SymbolKind = 'draw' | 'move' | 'turn' | 'branch' | 'leaf' | 'width' | 'grows' | 'gap';

export function kindOf(s: string): SymbolKind {
  if (s === 'F' || s === 'G') return 'draw';
  if (s === 'f') return 'move';
  if ('+-&^\\/|$'.includes(s)) return 'turn';
  if (s === '[' || s === ']') return 'branch';
  if (s === 'L' || s === 'K') return 'leaf';
  if (s === '!' || s === 'T' || s === '~' || s === '%') return 'width';
  if (s === '…') return 'gap';
  return 'grows';
}

/** As typeset: a true minus, and the rest as they are. */
export function glyphOf(s: string): string {
  if (s === '-') return '−';
  return s;
}

/** What a symbol does, for the legend. */
export const MEANING: Record<string, string> = {
  F: 'draw forward',
  G: 'draw forward',
  f: 'move without drawing',
  '+': 'turn left',
  '-': 'turn right',
  '&': 'pitch down',
  '^': 'pitch up',
  '\\': 'roll left',
  '/': 'roll right',
  '|': 'turn around',
  $: 'roll level',
  '[': 'remember, branch off',
  ']': 'return to the fork',
  '!': 'set the width',
  T: 'set the tropism',
  L: 'a leaf',
  K: 'a blossom',
};

/** The legend's rows: symbols that travel together, shown together. */
export const LEGEND: { symbols: string[]; meaning: string }[] = [
  { symbols: ['F'], meaning: 'draw forward' },
  { symbols: ['G'], meaning: 'draw forward' },
  { symbols: ['f'], meaning: 'move, drawing nothing' },
  { symbols: ['+', '-'], meaning: 'turn' },
  { symbols: ['&', '^'], meaning: 'pitch' },
  { symbols: ['\\', '/'], meaning: 'roll' },
  { symbols: ['|'], meaning: 'turn around' },
  { symbols: ['$'], meaning: 'roll level' },
  { symbols: ['[', ']'], meaning: 'branch & return' },
  { symbols: ['!'], meaning: 'set the width' },
  { symbols: ['T'], meaning: 'set the tropism' },
  { symbols: ['L'], meaning: 'leaf' },
  { symbols: ['K'], meaning: 'blossom' },
];

/** One piece of a production's source, for typesetting it. */
export interface Piece {
  s: string;
  /** Its arguments as written, if any. */
  args: string;
}

/** A production's source line, taken apart: predecessor, condition, probability, successor. */
export interface Rule {
  pred: Piece;
  cond: string;
  prob: string;
  succ: Piece[];
}

function pieces(src: string): Piece[] {
  const out: Piece[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    let args = '';
    if (src[i + 1] === '(') {
      let depth = 0;
      let j = i + 1;
      for (; j < src.length; j++) {
        if (src[j] === '(') depth++;
        else if (src[j] === ')') {
          depth--;
          if (depth === 0) break;
        }
      }
      args = src.slice(i + 2, j).replace(/\s+/g, ' ').trim();
      out.push({ s: ch, args });
      i = j + 1;
      continue;
    }
    out.push({ s: ch, args });
    i++;
  }
  return out;
}

export function parseRule(src: string): Rule | null {
  const arrow = src.indexOf('->');
  if (arrow < 0) return null;
  let left = src.slice(0, arrow).trim();
  const right = src.slice(arrow + 2).replace(/#.*$/, '').trim();
  let prob = '';
  const at = left.indexOf('@');
  if (at >= 0) {
    prob = left.slice(at + 1).trim();
    left = left.slice(0, at).trim();
  }
  let cond = '';
  const colon = left.indexOf(':');
  if (colon >= 0) {
    cond = left.slice(colon + 1).trim();
    left = left.slice(0, colon).trim();
  }
  const pred = pieces(left)[0] ?? { s: '?', args: '' };
  return { pred, cond, prob, succ: pieces(right) };
}

/** An argument list typeset a little: `*` as a times sign, `-` as a minus. */
export function prettyArgs(args: string): string {
  return args
    .replace(/>=/g, '≥')
    .replace(/<=/g, '≤')
    .replace(/!=/g, '≠')
    .replace(/==/g, '=')
    .replace(/&&/g, ' and ')
    .replace(/\|\|/g, ' or ')
    .replace(/\*/g, '·')
    .replace(/(^|[^eE])-/g, '$1−')
    .replace(/\s+/g, ' ');
}
