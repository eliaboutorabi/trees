/**
 * The interface, played as an instrument.
 *
 * A few real sounds (a felt piano note, a glass bowl, a low cello string, a
 * wooden tick, paper lifted and laid down) are each measured once for their
 * pitch, so any of them can be played as any note of D Dorian, the mode the
 * garden's music is written around. Then every gesture is a note:
 *
 *  - a row of choices is a scale, left to right, so choosing is playing;
 *  - a switch rises a third as it comes on and falls as it goes off;
 *  - a slider ticks as it travels, a little higher the further along, and
 *    settles on the note of where it stopped;
 *  - a card comes up with paper and its own note (the dock is a scale too),
 *    and passing from card to card under the pointer is a soft arpeggio;
 *  - the tour climbs the scale a step at a time.
 *
 * All of it goes through the soft hall the engine keeps for the interface,
 * quietly: these are meant to be felt more than heard.
 */
import { SOUND_BY_ID } from './manifest';
import type { Soundscape } from './soundscape';

/** D Dorian, in semitones above D. */
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const D4 = 293.66;

/** The pitch of a degree of the scale (0 is D4; 7 the D above; negative goes down). */
export function pitchOf(degree: number): number {
  const octave = Math.floor(degree / 7);
  const step = DORIAN[((degree % 7) + 7) % 7];
  return D4 * 2 ** (octave + step / 12);
}

type Voice = 'ui-felt' | 'ui-glass' | 'ui-low';

/**
 * A row of up to a dozen things (the dock's cards) spread over one octave,
 * so no sound is pushed more than an octave from where it rings: past that a
 * bowl turns thin and short, and a piano note to a toy.
 */
const spread = (index: number) => Math.round(Math.min(Math.max(0, index), 10) * 0.7);

export class UiVoice {
  /** Per slider: the last detent it ticked at, so it ticks at each one it crosses. */
  private readonly detents = new WeakMap<object, number>();
  private lastTick = 0;

  constructor(private readonly scape: Soundscape) {}

  private get live(): boolean {
    return this.scape.enabled;
  }

  /** One note: the take nearest the pitch wanted, retuned to it. */
  note(voice: Voice, degree: number, gain: number, delay = 0, octave = 0): void {
    if (!this.live) return;
    const pitches = SOUND_BY_ID[voice]?.pitch;
    const want = pitchOf(degree) * 2 ** octave;
    if (!pitches?.length) {
      this.scape.play(voice, { gain, delay, bus: 'ui' });
      return;
    }
    let take = 0;
    for (let i = 1; i < pitches.length; i++) {
      if (Math.abs(Math.log(want / pitches[i])) < Math.abs(Math.log(want / pitches[take]))) take = i;
    }
    // Kept near where the sound rings: the same note an octave over, rather
    // than the sound itself stretched out of its nature.
    let rate = want / pitches[take];
    while (rate > 1.8) rate /= 2;
    while (rate < 0.55) rate *= 2;
    this.scape.play(voice, { take, rate, gain, delay, bus: 'ui' });
  }

  /** A choice made: the option's place in its row, as a note, with a breath of glass above it. */
  select(index: number, count: number): void {
    const degree = Math.round((index / Math.max(1, count - 1)) * Math.min(7, count - 1));
    this.note('ui-felt', degree, 0.55);
    this.note('ui-glass', degree + 4, 0.1, 0.02);
  }

  /** A switch: up a third coming on, down one going off. */
  toggle(on: boolean): void {
    if (on) {
      this.note('ui-felt', 2, 0.45);
      this.note('ui-felt', 4, 0.5, 0.075);
    } else {
      this.note('ui-felt', 4, 0.35);
      this.note('ui-felt', 2, 0.32, 0.075);
    }
  }

  /**
   * A slider moving (`key` is the slider itself): a small wooden tick at
   * each of two dozen detents it passes, pitched by how far along it is.
   */
  slide(key: object, fraction: number): void {
    if (!this.live) return;
    const detent = Math.round(Math.max(0, Math.min(1, fraction)) * 24);
    const was = this.detents.get(key);
    this.detents.set(key, detent);
    if (was === undefined || was === detent) return;
    const now = performance.now();
    // A flung slider is a quick run of ticks, not a buzz.
    if (now - this.lastTick < 28) return;
    this.lastTick = now;
    this.scape.play('ui-tick', { rate: 0.8 * 2 ** (fraction * 0.9), gain: 0.32, bus: 'ui' });
  }

  /** A slider let go: the note of where it came to rest, over one octave of the scale. */
  settle(key: object, fraction: number): void {
    this.detents.delete(key);
    this.note('ui-felt', Math.round(Math.max(0, Math.min(1, fraction)) * 7), 0.32);
  }

  /** A card or panel coming up out of nothing: paper lifted, and its note. */
  open(index = 0): void {
    if (!this.live) return;
    this.scape.play('ui-open', { gain: 0.42, bus: 'ui', minGap: 0.08 });
    this.note('ui-glass', spread(index), 0.16, 0.04);
  }

  /** From one card to the next under a passing pointer: only its note, softly. */
  pass(index: number): void {
    this.note('ui-glass', spread(index), 0.1);
  }

  /** Put away. */
  close(): void {
    if (!this.live) return;
    this.scape.play('ui-close', { gain: 0.34, bus: 'ui', minGap: 0.08 });
  }

  /** A larger beginning (the tour, the Learn page): a low D, its fifth, glass above. */
  begin(): void {
    this.note('ui-low', -7, 0.5);
    this.note('ui-felt', 4, 0.3, 0.06);
    this.note('ui-glass', 7, 0.12, 0.12);
  }

  /** And its ending: settling back down onto D. */
  end(): void {
    this.note('ui-felt', 4, 0.3);
    this.note('ui-felt', 0, 0.36, 0.11);
    this.note('ui-low', -7, 0.32, 0.11);
  }

  /** The tour's steps climb the scale, a step at a time, and start again an octave down. */
  step(index: number): void {
    this.note('ui-felt', (index % 8) - 1, 0.36);
  }

  /** The picture taken. */
  shutter(): void {
    if (this.live) this.scape.play('ui-shutter', { gain: 0.5, bus: 'ui' });
  }

  /** The link copied: two notes of glass, a fourth apart. */
  copied(): void {
    this.note('ui-glass', 4, 0.18);
    this.note('ui-glass', 7, 0.18, 0.09);
  }

  /** The camera sent somewhere, or the scene started over. */
  whoosh(): void {
    if (this.live) this.scape.play('ui-whoosh', { gain: 0.4, bus: 'ui', minGap: 0.3 });
  }

  /** Back to the beginning: down the scale to D. */
  reset(): void {
    this.note('ui-felt', 4, 0.32);
    this.note('ui-felt', 2, 0.32, 0.09);
    this.note('ui-felt', 0, 0.36, 0.18);
  }

  /** Sound just switched on: the garden's D, opened out. */
  awake(): void {
    this.note('ui-low', -7, 0.4, 0.15);
    this.note('ui-felt', 0, 0.3, 0.15);
    this.note('ui-felt', 4, 0.28, 0.26);
    this.note('ui-glass', 7, 0.1, 0.36);
  }
}
