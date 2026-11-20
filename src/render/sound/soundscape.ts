/**
 * The garden's sound.
 *
 * A small Web Audio engine that follows the scene rather than playing over
 * it. Every frame the studio hands it a snapshot of the values it is already
 * easing for the picture — the season, the hour, the rain, the wind and its
 * gusts, the ice, how fast the tree is growing, how hard the crown is being
 * rustled — and each long sound's level chases them, so dusk falls in the
 * ears as it falls on the screen. Things that happen — a bird taking off, a
 * fish rising, an apple landing — are played the moment the picture shows
 * them, panned to where they happened.
 *
 *   beds, wind ─► air ─────┐
 *   rain, snow ─► weather ─┤
 *   growth, rustle ► tree ─┤
 *   creatures ──► life ────┼─► compressor ─► master ─► speakers
 *   cues ───────► music ───┤   (music ducks air and life while it plays)
 *   clicks ─────► ui ──────┘
 *
 * Long sounds are looped by crossfading the file over itself, a second and a
 * half at each wrap, starting each at a random point — so a take whose seam
 * is not perfect, or an MP3's encoder padding, never clicks, and two beds
 * never phase. One-shots come in pools of takes, never the same one twice
 * running, each a few percent off in pitch and level.
 *
 * Nothing is fetched until sound is switched on, and a long sound's audio is
 * let go a while after it falls silent, so the season you are not in costs
 * no memory.
 */
import type { SceneEvent } from '../events';
import { SOUND_BY_ID, filesOf } from './manifest';

export type SeasonName = 'spring' | 'summer' | 'autumn' | 'winter';

/** What the scene is doing this frame, as the soundscape needs it. */
export interface SoundState {
  season: SeasonName;
  /** 0 day, 1 night, eased as the sky is. */
  night: number;
  rain: number;
  snow: number;
  overcast: number;
  /** The wind's strength as the tree feels it, and its gust, 0–1, on the shader's own clock. */
  wind: number;
  gust: number;
  /** How much of the crown is in leaf, 0–1. */
  leafy: number;
  needles: boolean;
  ice: number;
  /** How close the camera is to the pond, 0–1. */
  pondNear: number;
  /** Signed growth per second: up as it grows, down as it shrinks. */
  growthRate: number;
  /** How hard the crown is being rustled under the pointer, 0–1. */
  rustle: number;
  /** Doves sitting in the tree. */
  perched: number;
  /** Ducks on the water, and how many of them are ducklings. */
  ducks: number;
  ducklings: number;
}

type Bus = 'air' | 'weather' | 'tree' | 'life' | 'music' | 'ui';
const BUS_LEVEL: Record<Bus, number> = { air: 0.85, weather: 1, tree: 0.9, life: 0.8, music: 0.75, ui: 0.4 };

/** Where a one-shot comes from: left–right on screen, and how loud from here. */
export interface Placement {
  pan?: number;
  gain?: number;
  /** Seconds from now. */
  delay?: number;
}

const BASE = `${import.meta.env.BASE_URL}sounds/`;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Equal-power fades: a crossfade between two unrelated textures dips by half otherwise. */
const FADE_IN = Float32Array.from({ length: 64 }, (_, i) => Math.sin((i / 63) * Math.PI * 0.5));
const FADE_OUT = Float32Array.from({ length: 64 }, (_, i) => Math.cos((i / 63) * Math.PI * 0.5));

/** A long sound, crossfade-looped, its level chasing a target. */
class Loop {
  readonly out: GainNode;
  private buffer: AudioBuffer | null = null;
  private loading = false;
  private sources: { src: AudioBufferSourceNode; env: GainNode }[] = [];
  private nextAt = 0;
  private running = false;
  private silentFor = 0;
  private target = 0;

  constructor(
    private readonly scape: Soundscape,
    readonly file: string,
    bus: GainNode,
    private readonly reverse = false,
  ) {
    this.out = scape.ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(bus);
  }

  /** Where its level is heading, and over how long it gets there. */
  set(target: number, seconds = 0.35): void {
    const t = Math.max(0, Math.min(2, target));
    if (Math.abs(t - this.target) > 0.002) {
      this.out.gain.setTargetAtTime(t, this.scape.ctx.currentTime, seconds / 3);
      this.target = t;
    }
  }

  tick(dt: number): void {
    const ctx = this.scape.ctx;
    if (this.target > 0.002) {
      this.silentFor = 0;
      if (!this.buffer) {
        if (!this.loading) {
          this.loading = true;
          void this.scape.buffer(this.file, false).then((b) => {
            this.loading = false;
            this.buffer = b && this.reverse ? reversed(ctx, b) : b;
          });
        }
        return;
      }
      if (!this.running) {
        this.running = true;
        this.nextAt = ctx.currentTime + 0.02;
        this.schedule(true);
      } else {
        this.schedule(false);
      }
    } else if (this.running) {
      this.silentFor += dt;
      // Let the level reach nothing before the sources stop.
      if (this.silentFor > 2) this.stop();
    } else {
      this.silentFor += dt;
      // A minute unheard and its audio is let go; it reloads if wanted again.
      if (this.silentFor > 60 && this.buffer) {
        this.buffer = null;
        this.scape.forget(this.file);
      }
    }
  }

  private schedule(first: boolean): void {
    const ctx = this.scape.ctx;
    const b = this.buffer;
    if (!b) return;
    const fade = Math.min(1.5, b.duration * 0.2);
    let offset = first ? Math.random() * Math.max(0, b.duration - fade * 3) : 0;
    while (this.nextAt < ctx.currentTime + 2.5) {
      const start = this.nextAt;
      const len = b.duration - offset;
      const src = ctx.createBufferSource();
      src.buffer = b;
      const env = ctx.createGain();
      // The first starts at full — its level is the loop's own to bring up —
      // and each after it fades in under the one before as that fades out.
      if (first) {
        env.gain.setValueAtTime(1, start);
      } else {
        env.gain.setValueAtTime(0, start);
        env.gain.setValueCurveAtTime(FADE_IN, start, fade);
      }
      first = false;
      const end = start + len;
      env.gain.setValueAtTime(1, end - fade);
      env.gain.setValueCurveAtTime(FADE_OUT, end - fade, fade);
      src.connect(env).connect(this.out);
      src.start(start, offset);
      src.stop(end + 0.05);
      const entry = { src, env };
      this.sources.push(entry);
      src.onended = () => {
        env.disconnect();
        this.sources = this.sources.filter((s) => s !== entry);
      };
      this.nextAt = end - fade;
      offset = 0;
    }
  }

  stop(): void {
    const now = this.scape.ctx.currentTime;
    for (const { src } of this.sources) {
      try {
        src.stop(now + 0.05);
      } catch {
        // Already stopped.
      }
    }
    this.sources = [];
    this.running = false;
  }
}

function reversed(ctx: BaseAudioContext, b: AudioBuffer): AudioBuffer {
  const out = ctx.createBuffer(b.numberOfChannels, b.length, b.sampleRate);
  for (let c = 0; c < b.numberOfChannels; c++) {
    const from = b.getChannelData(c);
    const to = out.getChannelData(c);
    for (let i = 0, n = from.length; i < n; i++) to[i] = from[n - 1 - i];
  }
  return out;
}

/** A one-shot's takes are mono: they are panned here, so a stereo file only doubles the memory. */
function mono(ctx: BaseAudioContext, b: AudioBuffer): AudioBuffer {
  if (b.numberOfChannels === 1) return b;
  const out = ctx.createBuffer(1, b.length, b.sampleRate);
  const to = out.getChannelData(0);
  const k = 1 / b.numberOfChannels;
  for (let c = 0; c < b.numberOfChannels; c++) {
    const from = b.getChannelData(c);
    for (let i = 0; i < from.length; i++) to[i] += from[i] * k;
  }
  return out;
}

export class Soundscape {
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly buses: Record<Bus, GainNode>;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly loops = new Map<string, Loop>();
  private readonly lastTake = new Map<string, number>();
  private readonly lastPlayed = new Map<string, number>();
  private volume = 0.8;
  private on = false;
  private dimmed = false;

  /** The season's blend, eased the way the picture's colours are. */
  private readonly seasons: Record<SeasonName, number> = { spring: 0, summer: 1, autumn: 0, winter: 0 };
  private seasonSet = false;
  private wasIce = 0;
  /** The loops are kept fed on a clock of their own, so they carry on while the scene is paused. */
  private feeder = 0;
  private lastFeed = 0;
  /** Fruit landing: a few at once are a patter, a whole crown at once is still only a few. */
  private fruitBudget = 4;
  private musicPlaying: { src: AudioBufferSourceNode; gain: GainNode; until: number } | null = null;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const squeeze = this.ctx.createDynamicsCompressor();
    squeeze.threshold.value = -16;
    squeeze.knee.value = 12;
    squeeze.ratio.value = 3;
    squeeze.attack.value = 0.01;
    squeeze.release.value = 0.3;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    squeeze.connect(this.master).connect(this.ctx.destination);
    this.buses = {} as Record<Bus, GainNode>;
    for (const bus of Object.keys(BUS_LEVEL) as Bus[]) {
      const g = this.ctx.createGain();
      g.gain.value = BUS_LEVEL[bus];
      g.connect(squeeze);
      this.buses[bus] = g;
    }

    // Browsers hold audio until someone touches the page; the switch that
    // turned sound on was that touch, but a return visit with it remembered
    // on has to wait for the first.
    window.addEventListener('pointerdown', this.wake, { passive: true });
    window.addEventListener('keydown', this.wake);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private readonly wake = (): void => {
    if (this.on && this.ctx.state === 'suspended') void this.ctx.resume();
  };

  /** Nothing plays in a tab nobody is looking at. */
  private readonly onVisibility = (): void => {
    if (this.ctx.state === 'closed') return;
    if (document.hidden) void this.ctx.suspend();
    else if (this.on) void this.ctx.resume();
  };

  /** Sound on or off; on starts loading what the scene needs, off fades everything out. */
  setEnabled(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    const now = this.ctx.currentTime;
    clearInterval(this.feeder);
    if (on) {
      void this.ctx.resume();
      this.master.gain.setTargetAtTime(this.level(), now, 0.4);
      this.preload();
      this.lastFeed = performance.now();
      this.feeder = window.setInterval(() => this.feed(), 250);
    } else {
      this.master.gain.setTargetAtTime(0, now, 0.15);
      // Once it has faded, everything stops and lets go; it picks up from the
      // scene as it then is when switched back on.
      this.feeder = window.setInterval(() => {
        if (this.on) return;
        clearInterval(this.feeder);
        for (const l of this.loops.values()) l.stop();
        if (this.musicPlaying) {
          this.musicPlaying.src.stop();
          this.musicPlaying = null;
        }
        void this.ctx.suspend();
      }, 900);
    }
  }

  private feed(): void {
    const now = performance.now();
    const dt = Math.min(1, (now - this.lastFeed) / 1000);
    this.lastFeed = now;
    for (const l of this.loops.values()) l.tick(dt);
  }

  get enabled(): boolean {
    return this.on;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.on) this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.1);
  }

  /** Quieter while something covers the scene (the Learn page). */
  setDimmed(dim: boolean): void {
    this.dimmed = dim;
    if (this.on) this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.5);
  }

  private level(): number {
    return this.volume * this.volume * (this.dimmed ? 0.3 : 1);
  }

  // ------------------------------------------------------------ loading

  /** A decoded file, once; a one-shot's take comes back mono. */
  buffer(file: string, asMono: boolean): Promise<AudioBuffer | null> {
    let p = this.buffers.get(file);
    if (!p) {
      p = fetch(`${BASE}${file}`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
        .then((data) => this.ctx.decodeAudioData(data))
        .then((b) => (asMono ? mono(this.ctx, b) : b))
        .catch(() => null);
      this.buffers.set(file, p);
    }
    return p;
  }

  forget(file: string): void {
    this.buffers.delete(file);
  }

  /** The one-shots likely to be wanted soon, so their first play is on time. */
  private preload(): void {
    for (const id of [
      'fish-plop', 'dove-coo', 'dove-takeoff', 'dove-land', 'leaf-fall', 'apple-thud', 'berry-patter', 'cone-thud',
      'grow-seed', 'grow-bloom', 'tree-sink', 'duck-quack', 'duckling-peep', 'duck-dabble', 'songbird-spring',
      'songbird-summer', 'songbird-autumn', 'chickadee', 'ice-creak',
    ]) {
      const spec = SOUND_BY_ID[id];
      if (spec) for (const f of filesOf(spec)) void this.buffer(f, true);
    }
  }

  private loop(id: string, bus: Bus, reverse = false): Loop {
    const key = reverse ? `${id}~` : id;
    let l = this.loops.get(key);
    if (!l) {
      l = new Loop(this, `${id}.mp3`, this.buses[bus], reverse);
      this.loops.set(key, l);
    }
    return l;
  }

  // ----------------------------------------------------------- one-shots

  /**
   * Play a one-shot from its pool. `minGap` keeps a burst of the same event —
   * a whole flock taking off in the same half second — to one sound.
   */
  play(id: string, place: Placement = {}, bus: Bus = 'life', minGap = 0): void {
    if (!this.on || this.ctx.state !== 'running') return;
    const spec = SOUND_BY_ID[id];
    if (!spec) return;
    const now = this.ctx.currentTime;
    if (minGap > 0 && now - (this.lastPlayed.get(id) ?? -1e9) < minGap) return;
    this.lastPlayed.set(id, now);
    const files = filesOf(spec);
    let k = Math.floor(Math.random() * files.length);
    if (files.length > 1 && k === this.lastTake.get(id)) k = (k + 1) % files.length;
    this.lastTake.set(id, k);
    void this.buffer(files[k], true).then((b) => {
      if (!b || !this.on) return;
      const src = this.ctx.createBufferSource();
      src.buffer = b;
      src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.06;
      const gain = this.ctx.createGain();
      gain.gain.value = (place.gain ?? 1) * Math.pow(10, ((Math.random() - 0.5) * 3) / 20);
      const pan = this.ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, place.pan ?? 0));
      src.connect(gain).connect(pan).connect(this.buses[bus]);
      // A late decode still lands on its moment if it can, or as soon as it can.
      src.start(Math.max(this.ctx.currentTime, now + (place.delay ?? 0)));
      src.onended = () => pan.disconnect();
    });
  }

  /** A piece of music for a moment in the sky; the air and the creatures make room for it. */
  music(id: string): void {
    if (!this.on || this.ctx.state !== 'running') return;
    void this.buffer(`${id}.mp3`, false).then((b) => {
      if (!b || !this.on) return;
      const now = this.ctx.currentTime;
      // A new cue takes over from one still playing, briefly overlapping.
      if (this.musicPlaying) {
        const old = this.musicPlaying;
        old.gain.gain.setTargetAtTime(0, now, 0.4);
        old.src.stop(now + 2);
      }
      const src = this.ctx.createBufferSource();
      src.buffer = b;
      const gain = this.ctx.createGain();
      gain.gain.value = 1;
      src.connect(gain).connect(this.buses.music);
      src.start(now + 0.05);
      const until = now + b.duration;
      this.musicPlaying = { src, gain, until };
      src.onended = () => {
        if (this.musicPlaying?.src === src) this.musicPlaying = null;
        gain.disconnect();
        this.forget(`${id}.mp3`);
      };
      // Duck the air and the creatures under it, and bring them back as it ends.
      for (const bus of ['air', 'life'] as Bus[]) {
        const g = this.buses[bus].gain;
        g.cancelScheduledValues(now);
        g.setTargetAtTime(BUS_LEVEL[bus] * 0.55, now, 0.5);
        g.setTargetAtTime(BUS_LEVEL[bus], Math.max(now + 1, until - 3), 1.2);
      }
    });
  }

  // ---------------------------------------------------------------- frame

  /** One frame: every long sound's level, and the creatures that call on their own. */
  update(s: SoundState, dt: number): void {
    if (!this.on) return;
    this.fruitBudget = Math.min(4, this.fruitBudget + dt * 5);

    // The season's blend eases as the colours do.
    const k = this.seasonSet ? 1 - Math.exp(-dt / 1.2) : 1;
    this.seasonSet = true;
    for (const name of Object.keys(this.seasons) as SeasonName[]) {
      this.seasons[name] += ((name === s.season ? 1 : 0) - this.seasons[name]) * k;
    }

    const day = 1 - s.night;
    const wet = s.rain;
    // Rain and snow mask the quiet life of the place.
    const hush = (1 - 0.65 * wet) * (1 - 0.35 * s.snow);
    for (const name of Object.keys(this.seasons) as SeasonName[]) {
      const w = this.seasons[name];
      this.loop(`bed-${name}-day`, 'air').set(w * day * hush, 1.2);
      this.loop(`bed-${name}-night`, 'air').set(w * s.night * hush, 1.2);
    }

    // Wind in the tree, swelling with the gusts the crown is visibly taking.
    // The slider runs to 1.5: a summer breeze is about a third of that and
    // already heard; by 0.8 the crown is in full voice, and the gale comes in
    // over the top of it beyond 1.
    const wind = Math.max(0, s.wind);
    const swell = 0.55 + 0.45 * s.gust;
    const breeze = Math.sqrt(Math.min(1, wind / 0.8));
    const gale = smoothstep(0.95, 1.5, wind);
    const broadleaf = s.needles ? 0 : 1;
    this.loop('wind-leaves', 'air').set(s.leafy * broadleaf * breeze * swell * (1 - 0.45 * gale), 0.25);
    this.loop('wind-pine', 'air').set((1 - broadleaf) * breeze * swell, 0.25);
    this.loop('wind-bare', 'air').set((1 - s.leafy) * broadleaf * Math.min(1, wind / 0.9) * swell, 0.25);
    this.loop('wind-gale', 'air').set(gale * swell, 0.25);

    // Weather. Rain, once it is falling, is the loudest thing out there.
    const heavy = smoothstep(0.45, 0.95, wet);
    this.loop('rain-light', 'weather').set(Math.sqrt(wet) * (1 - heavy) * 1.5, 0.6);
    this.loop('rain-heavy', 'weather').set(heavy * 1.6, 0.6);
    this.loop('rain-pond', 'weather').set(wet * s.pondNear * (1 - s.ice), 0.6);
    this.loop('snowfall', 'weather').set(s.snow * 0.9, 0.8);

    // The pond: louder the nearer you stand, silent once frozen.
    this.loop('pond-water', 'air').set(s.pondNear * (1 - s.ice) * (1 - 0.5 * wet) * 0.8, 0.5);

    // The tree. Growth is heard as fast as it happens, and backwards when it
    // shrinks; the rustle follows the hand in the crown.
    const grow = Math.min(1, Math.max(0, s.growthRate) / 0.3);
    const shrink = Math.min(1, Math.max(0, -s.growthRate) / 0.6);
    this.loop('grow-texture', 'tree').set(Math.pow(grow, 0.6) * 1.3, 0.12);
    this.loop('grow-texture', 'tree', true).set(Math.pow(shrink, 0.6) * 0.8, 0.12);
    this.loop('rustle-hand', 'tree').set(s.rustle * Math.max(0.15, s.leafy), 0.1);

    // Pond ice: it groans as it closes over.
    if (s.ice > 0.35 && this.wasIce <= 0.35) this.play('ice-creak', { gain: 0.8 }, 'weather');
    this.wasIce = s.ice;

    this.chorus(s, dt);
  }

  /** The creatures that call on their own, each at its own unhurried rate. */
  private chorus(s: SoundState, dt: number): void {
    const day = 1 - s.night;
    const quiet = (1 - 0.7 * s.rain) * (1 - 0.5 * s.snow);
    const chance = (perSecond: number) => Math.random() < perSecond * dt;
    const wide = () => (Math.random() - 0.5) * 1.3;

    // Doves in the crown coo now and then, more of them more often.
    if (day > 0.5 && s.perched > 0 && chance(Math.min(0.22, s.perched * 0.025) * quiet)) {
      this.play('dove-coo', { pan: (Math.random() - 0.5) * 0.6, gain: 0.75 }, 'life', 2);
    }
    // Songbirds, by season, by day.
    const song = { spring: ['songbird-spring', 1 / 8], summer: ['songbird-summer', 1 / 13], autumn: ['songbird-autumn', 1 / 24], winter: null }[s.season] as
      | [string, number]
      | null;
    if (song && day > 0.6 && chance(song[1] * quiet)) this.play(song[0], { pan: wide(), gain: 0.55 }, 'life', 3);
    // Ducks talk among themselves; the ducklings never stop peeping.
    if (s.ducks > 0.5 && day > 0.3 && chance((1 / 14) * quiet)) this.play('duck-quack', { pan: -0.35, gain: 0.6 * s.pondNear + 0.25 }, 'life', 3);
    if (s.ducklings > 0.3 && chance((1 / 5) * quiet)) this.play('duckling-peep', { pan: -0.35, gain: 0.45 * s.pondNear + 0.15 }, 'life', 2);
    // Further off: bees in the warm months, crows in the cold, an owl at night,
    // geese passing over in autumn, thunder in a downpour under heavy cloud.
    if (day > 0.6 && (s.season === 'spring' || s.season === 'summer') && chance((1 / 30) * quiet)) this.play('bee-flyby', { pan: wide(), gain: 0.5 }, 'life', 8);
    if (day > 0.6 && (s.season === 'autumn' || s.season === 'winter') && chance((1 / 40) * quiet)) this.play('crow-far', { pan: wide(), gain: 0.45 }, 'life', 10);
    if (day > 0.6 && s.season === 'autumn' && chance(1 / 150)) this.play('geese-far', { pan: wide(), gain: 0.5 }, 'life', 60);
    if (s.night > 0.7 && s.season !== 'summer' && chance((1 / 35) * quiet)) this.play('owl-hoot', { pan: wide(), gain: 0.5 }, 'life', 12);
    if (s.rain > 0.7 && s.overcast > 0.6 && chance(1 / 45)) this.play('thunder-far', { pan: wide(), gain: 0.7 }, 'weather', 15);
    if (s.ice > 0.9 && chance(1 / 28)) this.play('ice-sing', { pan: -0.3, gain: 0.5 }, 'weather', 8);
  }

  /** Something happened in the garden, here: the sound of it, at the moment the picture shows it. */
  happen(e: SceneEvent, place: Placement): void {
    if (!this.on) return;
    switch (e.kind) {
      case 'dove-takeoff':
        this.play('dove-takeoff', { ...place, gain: (place.gain ?? 1) * 0.85 }, 'life', 0.6);
        break;
      case 'dove-land':
        // Into the twigs, now and then: the flock comes and goes all day, and
        // a flutter for every landing — or any for one on the grass — is a
        // racket.
        if (e.detail) this.play('dove-land', { ...place, gain: (place.gain ?? 1) * 0.5 }, 'life', 2.5);
        break;
      case 'fish-rise':
        this.play('fish-plop', { ...place, gain: (place.gain ?? 1) * 0.75 }, 'life', 0.3);
        break;
      case 'duck-dabble':
        this.play('duck-dabble', { ...place, gain: (place.gain ?? 1) * 0.7 }, 'life', 2);
        break;
      case 'robin-hop':
        // It does not call at every hop.
        if (Math.random() < 0.3) this.play('chickadee', { ...place, gain: (place.gain ?? 1) * 0.6 }, 'life', 5);
        break;
      case 'fruit-fall': {
        if (this.fruitBudget < 1) break;
        this.fruitBudget -= 1;
        const id = e.detail === 2 ? 'cone-thud' : e.detail === 1 ? 'apple-thud' : 'berry-patter';
        this.play(id, { ...place, gain: (place.gain ?? 1) * 0.8, delay: e.delay }, 'tree');
        break;
      }
      case 'leaves-fall':
        this.play('leaf-fall', { ...place, gain: (place.gain ?? 1) * Math.min(1, 0.4 + (e.detail ?? 6) * 0.03) }, 'tree', 1.4);
        break;
      case 'grow-start':
        this.play('grow-seed', { gain: 0.8 }, 'tree', 0.5);
        break;
      case 'grow-done':
        this.play('grow-bloom', { gain: 0.7 }, 'tree', 1);
        break;
      case 'tree-sink':
        this.play('tree-sink', { gain: 0.7 }, 'tree', 1);
        break;
      case 'nightfall':
      case 'daybreak':
      case 'rainbow':
      case 'aurora':
        this.music(`music-${e.kind}`);
        break;
    }
  }

  /** The interface's own small sounds, very quiet: a switch, a card, a question. */
  ui(kind: 'pebble' | 'card' | 'ask'): void {
    this.play(`ui-${kind}`, { gain: kind === 'card' ? 0.5 : 0.7 }, 'ui', 0.06);
  }

  /** The welcome's tune, once, if sound is on when it opens. */
  welcome(): void {
    this.music('music-welcome');
  }

  /** A quiet underscore while the whole tour plays itself. */
  setTour(on: boolean): void {
    this.loop('music-tour', 'music').set(on ? 0.55 : 0, on ? 2 : 1.5);
  }

  dispose(): void {
    this.on = false;
    clearInterval(this.feeder);
    window.removeEventListener('pointerdown', this.wake);
    window.removeEventListener('keydown', this.wake);
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const l of this.loops.values()) l.stop();
    void this.ctx.close();
  }
}
