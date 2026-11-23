/**
 * The interface's sound, from the interface's side.
 *
 * Components call `sonic` for what only they know (a card's place in the
 * dock, a tour step, a picture saved); everything that looks the same
 * everywhere is heard by one listener on the page instead of in every
 * component: any slider moving or let go, any choice in a row (a tile, a
 * segment, a colour), any switch. It all does nothing while sound is off.
 */
import type { UiVoice } from '../render/sound/ui-voice';

let voice: UiVoice | null = null;

/** Hand over the instrument once there is one (sound switched on), or null. */
export function useVoice(v: UiVoice | null): void {
  voice = v;
}

export const sonic = {
  select: (index: number, count: number) => voice?.select(index, count),
  toggle: (on: boolean) => voice?.toggle(on),
  open: (index?: number) => voice?.open(index),
  pass: (index: number) => voice?.pass(index),
  close: () => voice?.close(),
  begin: () => voice?.begin(),
  end: () => voice?.end(),
  step: (index: number) => voice?.step(index),
  shutter: () => voice?.shutter(),
  copied: () => voice?.copied(),
  whoosh: () => voice?.whoosh(),
  reset: () => voice?.reset(),
  awake: () => voice?.awake(),
  xrayIn: () => voice?.xrayIn(),
  xrayOut: () => voice?.xrayOut(),
  branch: (depth: number, deepest: number) => voice?.branch(depth, deepest),
  rewrite: (step: number, steps: number) => voice?.rewrite(step, steps),
  /** A custom control being dragged (a dial, a pad): `key` is the control, `fraction` how far along. */
  slide: (key: object, fraction: number) => voice?.slide(key, fraction),
  settle: (key: object, fraction: number) => voice?.settle(key, fraction),
};

/** Where an element sits among the matching children of its parent, and how many there are. */
function placeIn(el: Element, selector: string): [number, number] {
  const row = el.parentElement ? Array.from(el.parentElement.children).filter((c) => c.matches(selector)) : [el];
  return [Math.max(0, row.indexOf(el)), row.length];
}

function fractionOf(input: HTMLInputElement): number {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  return max > min ? (Number(input.value) - min) / (max - min) : 0;
}

/**
 * Listen on the whole page for the gestures every control shares. Clicks
 * are heard on their way down (capture), before the control has changed,
 * so a switch's state is read as it was and the note is for what it is
 * about to become. Returns a function that stops listening.
 */
export function sonify(root: Document = document): () => void {
  const onInput = (e: Event) => {
    const t = e.target as HTMLInputElement;
    if (t?.type === 'range') sonic.slide(t, fractionOf(t));
  };
  const onChange = (e: Event) => {
    const t = e.target as HTMLInputElement;
    if (t?.type === 'range') sonic.settle(t, fractionOf(t));
    else if (t?.type === 'color') sonic.select(4, 8);
  };
  const onClick = (e: Event) => {
    const t = e.target as Element | null;
    if (!t?.closest) return;
    const choice = t.closest('.tile, .segmented > button, .dot[role="radio"]');
    if (choice) {
      if (choice.matches('.active, [aria-checked="true"]')) return;
      const selector = choice.matches('.tile') ? '.tile' : choice.matches('.dot') ? '.dot[role="radio"]' : 'button';
      sonic.select(...placeIn(choice, selector));
      return;
    }
    // Switches, and the scene's pebbles (but not the sound's own: it speaks for itself).
    const flip = t.closest('.toggle, .pebble:not([data-tour="quick-sound"]):not([data-tour="quick-xray"]):not([aria-disabled="true"])');
    if (flip) sonic.toggle(flip.getAttribute('aria-pressed') !== 'true');
  };
  root.addEventListener('input', onInput, true);
  root.addEventListener('change', onChange, true);
  root.addEventListener('click', onClick, true);
  return () => {
    root.removeEventListener('input', onInput, true);
    root.removeEventListener('change', onChange, true);
    root.removeEventListener('click', onClick, true);
  };
}
