/**
 * Builds trees off the main thread. See `build.ts`.
 *
 * One message in — parameters and limits, tagged with an id — and one out,
 * with the built tree's buffers transferred rather than copied.
 */
import { computeTree, packTreeData, type BuildLimits, type TreeStructure } from './build';

interface Request {
  id: number;
  params: TreeStructure;
  limits: BuildLimits;
}

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, params, limits } = event.data;
  try {
    const { payload, transfer } = packTreeData(computeTree(params, limits));
    (self as unknown as Worker).postMessage({ id, payload }, transfer as Transferable[]);
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
