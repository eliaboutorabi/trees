/**
 * A long sound, played as long as it is wanted, its level chasing a target.
 *
 * It loops by crossfading the file over itself, a second and a half at each
 * wrap, from a random starting point, so a take whose seam is not perfect, or
 * an MP3's encoder padding, never clicks, and two loops never phase. Played
 * from several places at once (the three sides of a crown, two ends of a
 * pond), each voice starts somewhere different in the file: the copies do not
 * line up, so they are heard as a wide sound rather than one sound thrice.
 *
 * Its audio is fetched the first time it is wanted and let go a minute after
 * it last fell silent.
 */

/** What a loop needs from the engine: a clock, and decoded files. */
export interface SoundBank {
  readonly ctx: AudioContext;
  buffer(file: string, mono: boolean): Promise<AudioBuffer | null>;
  forget(file: string): void;
}

/** Equal-power fades: a crossfade between two unrelated textures dips by half otherwise. */
const FADE_IN = Float32Array.from({ length: 64 }, (_, i) => Math.sin((i / 63) * Math.PI * 0.5));
const FADE_OUT = Float32Array.from({ length: 64 }, (_, i) => Math.cos((i / 63) * Math.PI * 0.5));

interface Voice {
  out: GainNode;
  nextAt: number;
  sources: AudioBufferSourceNode[];
}

export class Loop {
  private buffer: AudioBuffer | null = null;
  private loading = false;
  private readonly voices: Voice[];
  private running = false;
  private silentFor = 0;
  private target = 0;

  constructor(
    private readonly bank: SoundBank,
    readonly file: string,
    /** Where each voice plays into: a bus, or the emitters of a place. */
    destinations: AudioNode[],
    private readonly reverse = false,
  ) {
    // Uncorrelated copies add by power: each is turned down so together they
    // are as loud as one.
    const share = 1 / Math.sqrt(destinations.length);
    this.voices = destinations.map((to) => {
      const out = bank.ctx.createGain();
      out.gain.value = 0;
      const trim = bank.ctx.createGain();
      trim.gain.value = share;
      out.connect(trim).connect(to);
      return { out, nextAt: 0, sources: [] };
    });
  }

  get level(): number {
    return this.target;
  }

  /** Where its level is heading, and over how long it gets there. */
  set(target: number, seconds = 0.35): void {
    const t = Math.max(0, Math.min(2, target));
    if (Math.abs(t - this.target) <= 0.002) return;
    const now = this.bank.ctx.currentTime;
    for (const v of this.voices) v.out.gain.setTargetAtTime(t, now, seconds / 3);
    this.target = t;
  }

  /** Keep it fed: a few seconds of sources scheduled ahead at all times while it is wanted. */
  tick(dt: number): void {
    const ctx = this.bank.ctx;
    if (this.target > 0.002) {
      this.silentFor = 0;
      if (!this.buffer) {
        if (!this.loading) {
          this.loading = true;
          void this.bank.buffer(this.file, false).then((b) => {
            this.loading = false;
            this.buffer = b && this.reverse ? reversed(ctx, b) : b;
          });
        }
        return;
      }
      const first = !this.running;
      if (first) {
        this.running = true;
        for (const v of this.voices) v.nextAt = ctx.currentTime + 0.02;
      }
      for (const v of this.voices) this.schedule(v, first);
    } else if (this.running) {
      this.silentFor += dt;
      // Let the level reach nothing before the sources stop.
      if (this.silentFor > 2) this.stop();
    } else {
      this.silentFor += dt;
      if (this.silentFor > 60 && this.buffer) {
        this.buffer = null;
        this.bank.forget(this.file);
      }
    }
  }

  private schedule(v: Voice, first: boolean): void {
    const ctx = this.bank.ctx;
    const b = this.buffer;
    if (!b) return;
    const fade = Math.min(1.5, b.duration * 0.2);
    let offset = first ? Math.random() * Math.max(0, b.duration - fade * 3) : 0;
    while (v.nextAt < ctx.currentTime + 2.5) {
      const start = v.nextAt;
      const src = ctx.createBufferSource();
      src.buffer = b;
      const env = ctx.createGain();
      // The first starts at full (its level is the loop's own to bring up);
      // each after it fades in under the one before as that fades out.
      if (first) {
        env.gain.setValueAtTime(1, start);
      } else {
        env.gain.setValueAtTime(0, start);
        env.gain.setValueCurveAtTime(FADE_IN, start, fade);
      }
      first = false;
      const end = start + b.duration - offset;
      env.gain.setValueAtTime(1, end - fade);
      env.gain.setValueCurveAtTime(FADE_OUT, end - fade, fade);
      src.connect(env).connect(v.out);
      src.start(start, offset);
      src.stop(end + 0.05);
      v.sources.push(src);
      src.onended = () => {
        env.disconnect();
        v.sources = v.sources.filter((s) => s !== src);
      };
      v.nextAt = end - fade;
      offset = 0;
    }
  }

  stop(): void {
    const now = this.bank.ctx.currentTime;
    for (const v of this.voices) {
      for (const src of v.sources) {
        try {
          src.stop(now + 0.05);
        } catch {
          // Already stopped.
        }
      }
      v.sources = [];
    }
    this.running = false;
  }
}

export function reversed(ctx: BaseAudioContext, b: AudioBuffer): AudioBuffer {
  const out = ctx.createBuffer(b.numberOfChannels, b.length, b.sampleRate);
  for (let c = 0; c < b.numberOfChannels; c++) {
    const from = b.getChannelData(c);
    const to = out.getChannelData(c);
    for (let i = 0, n = from.length; i < n; i++) to[i] = from[n - 1 - i];
  }
  return out;
}
