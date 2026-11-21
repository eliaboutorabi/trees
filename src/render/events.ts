/**
 * Things that happen in the garden, where they happen.
 *
 * The creatures and the studio say so as they do them — a dove leaving its
 * twig, a fish rising, an apple let go — and whoever is listening (today the
 * soundscape) decides what that means for it. The emitters know nothing of
 * sound; they only report, in world space, at the moment the picture shows it.
 */
export type SceneEventKind =
  /** A dove leaving its twig in its own time: `detail` is how much noise its wings make, 0–1. */
  | 'dove-takeoff'
  /** A dove put up — off the twig or the grass — by a hand in the crown: `detail` as above. */
  | 'dove-flush'
  /** A dove about to settle on a twig, braking in: `detail` as above. */
  | 'dove-arrive'
  /** A dove settling: `detail` 1 on a twig, 0 on the grass. */
  | 'dove-land'
  /** A fish taking something from the surface, the moment its ring starts. */
  | 'fish-rise'
  /** The hen up-ending to feed. */
  | 'duck-dabble'
  /** The winter robin hopping to the next stone. */
  | 'robin-hop'
  /** A fruit let go: `delay` is how long until it lands, `detail` its shape (0 berry, 1 apple, 2 cone). */
  | 'fruit-fall'
  /** Leaves coming loose this moment: `detail` is how many. */
  | 'leaves-fall'
  /** A tree starting to grow from the ground, and finishing. */
  | 'grow-start'
  | 'grow-done'
  /** The tree going back into the ground, before another takes its place. */
  | 'tree-sink'
  /** The sky changing: dusk, dawn, a rainbow asked for, the aurora asked for. */
  | 'nightfall'
  | 'daybreak'
  | 'rainbow'
  | 'aurora';

export interface SceneEvent {
  kind: SceneEventKind;
  x: number;
  y: number;
  z: number;
  delay?: number;
  detail?: number;
}

export type SceneListener = (e: SceneEvent) => void;
