import type { Snippet } from 'svelte';

/**
 * How a card offers its exact controls to the dock. A card's `Fold` does not
 * open inside the card (which would make it grow, and scroll); it hands its
 * contents to the dock, which puts a button in the card's header and opens
 * them in a panel of their own beside the card.
 */
export const MORE = Symbol('more');

export interface MoreHost {
  /** Offer `panel` under `label`; the returned function withdraws it. */
  offer(label: string, panel: Snippet): () => void;
}
