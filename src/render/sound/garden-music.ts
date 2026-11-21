/**
 * The garden's own music, which comes and goes.
 *
 * Music that plays all the time stops being heard, and covers the place it
 * is meant to belong to. So a piece is played now and then: the garden is
 * heard on its own for a while first, then a piece for the season and the
 * hour (a quiet one, made to sit under birdsong), then a long rest, then
 * another — never the one just heard. A moment in the sky (dusk, a rainbow)
 * has its own music; the garden's bows out for it, and waits a while after.
 */
import type { SoundBank } from './loop';

export type Mood = 'spring' | 'summer' | 'autumn' | 'winter';

const PIECES: Record<Mood | 'night', string[]> = {
  spring: ['garden-spring-1', 'garden-spring-2'],
  summer: ['garden-summer-1', 'garden-summer-2'],
  autumn: ['garden-autumn-1', 'garden-autumn-2'],
  winter: ['garden-winter-1', 'garden-winter-2'],
  // The warm night for the warm months, the cool one for the cold.
  night: ['garden-night-1', 'garden-night-2'],
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class GardenMusic {
  /** Seconds until the next piece; counting only while music is allowed. */
  private restFor = rand(25, 45);
  private playing: { src: AudioBufferSourceNode; gain: GainNode; file: string } | null = null;
  private chosen: string | null = null;
  private last = '';

  constructor(
    private readonly bank: SoundBank,
    private readonly out: AudioNode,
    /** How loud a piece sits, under the moments' music. */
    private readonly level = 0.6,
  ) {}

  get busy(): boolean {
    return this.playing !== null;
  }

  /**
   * One step. `allowed` is false while something else has the music (a
   * moment in the sky, the tour) or nobody wants any; the rest then waits.
   */
  tick(dt: number, season: Mood, night: number, allowed: boolean): void {
    if (!allowed) {
      if (this.playing) this.hush(rand(40, 80));
      return;
    }
    if (this.playing) return;
    this.restFor -= dt;
    // Choose and fetch a little ahead, so the piece starts on its moment.
    if (this.restFor < 8 && !this.chosen) {
      this.chosen = this.choose(season, night);
      void this.bank.buffer(`${this.chosen}.mp3`, false);
    }
    if (this.restFor <= 0 && this.chosen) {
      const file = `${this.chosen}.mp3`;
      this.chosen = null;
      void this.bank.buffer(file, false).then((b) => {
        if (!b || this.playing) return;
        this.start(b, file);
      });
      // If the fetch fails, try again after a while rather than at once.
      this.restFor = rand(60, 120);
    }
  }

  private choose(season: Mood, night: number): string {
    let pool: string[];
    if (night > 0.5) {
      const warm = season === 'spring' || season === 'summer';
      // Mostly the night that suits the season, now and then the other.
      pool = Math.random() < 0.75 ? [PIECES.night[warm ? 0 : 1]] : PIECES.night;
    } else {
      pool = PIECES[season];
    }
    const fresh = pool.filter((p) => p !== this.last);
    const pick = (fresh.length ? fresh : pool)[Math.floor(Math.random() * (fresh.length || pool.length))];
    this.last = pick;
    return pick;
  }

  private start(b: AudioBuffer, file: string): void {
    const ctx = this.bank.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = b;
    const gain = ctx.createGain();
    // In over a few seconds, so it arrives rather than starts.
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(this.level, now + 4);
    src.connect(gain).connect(this.out);
    src.start(now + 0.05);
    this.playing = { src, gain, file };
    src.onended = () => {
      if (this.playing?.src !== src) return;
      this.playing = null;
      gain.disconnect();
      this.bank.forget(file);
      // A long rest: the garden on its own again before the next piece.
      this.restFor = rand(70, 160);
    };
  }

  /** Bow out over a couple of seconds, and rest `seconds` before the next. */
  hush(seconds: number): void {
    const p = this.playing;
    this.restFor = Math.max(this.restFor, seconds);
    this.chosen = null;
    if (!p) return;
    this.playing = null;
    const now = this.bank.ctx.currentTime;
    p.gain.gain.cancelScheduledValues(now);
    p.gain.gain.setTargetAtTime(0, now, 0.8);
    p.src.stop(now + 4);
    p.src.onended = () => {
      p.gain.disconnect();
      this.bank.forget(p.file);
    };
  }

  /** Straight to silence: sound switched off. */
  stop(): void {
    this.playing?.src.stop();
    this.playing = null;
    this.chosen = null;
    this.restFor = rand(25, 45);
  }
}
