/**
 * Keeps a tree's anatomy off the main thread, and answers questions about it.
 * See `anatomy.ts` (the client) and `lsystem/anatomy.ts` (what it knows).
 *
 * The whole history of a large tree is hundreds of thousands of modules: it
 * stays here, and the page is only ever sent what it is about to show.
 */
import { TAPER, type TreeStructure } from './build';
import { Anatomy } from './lsystem';

export type AnatomyRequest =
  | { id: number; kind: 'load'; params: TreeStructure; maxModules: number }
  | { id: number; kind: 'skeleton'; n: number }
  | { id: number; kind: 'branch'; n: number; node: number };

let anatomy: Anatomy | null = null;

const reply = (message: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer);

self.onmessage = (event: MessageEvent<AnatomyRequest>) => {
  const req = event.data;
  try {
    if (req.kind === 'load') {
      // Exactly as the garden's tree is built, so this is that tree.
      anatomy = new Anatomy({ ...req.params, maxModules: req.maxModules, ground: true, taper: TAPER });
      const words = anatomy.history.words;
      const symbols = new Set<string>();
      for (const m of words[words.length - 1]) symbols.add(m.s);
      for (const w of words) for (const m of w.slice(0, 200)) symbols.add(m.s);
      reply({
        id: req.id,
        result: {
          steps: anatomy.steps,
          truncated: anatomy.truncated,
          issues: anatomy.issues,
          productions: anatomy.productions.map((p) => ({ pred: p.pred, src: p.src })),
          summary: anatomy.summary(),
          symbols: [...symbols],
        },
      });
      return;
    }
    if (!anatomy) throw new Error('No tree loaded');
    if (req.kind === 'skeleton') {
      const s = anatomy.skeleton(req.n);
      // Copies, so the cached skeleton stays whole for the next question.
      const pos = s.pos.slice();
      const parent = s.parent.slice();
      const radius = s.radius.slice();
      const order = s.order.slice();
      const module = s.module.slice();
      reply(
        { id: req.id, result: { step: req.n, count: s.count, pos, parent, radius, order, module, height: s.height, radiusXZ: s.radiusXZ } },
        [pos.buffer, parent.buffer, radius.buffer, order.buffer, module.buffer],
      );
      return;
    }
    if (req.kind === 'branch') {
      reply({ id: req.id, result: anatomy.branch(req.n, req.node) });
    }
  } catch (error) {
    reply({ id: req.id, error: error instanceof Error ? error.message : String(error) });
  }
};
