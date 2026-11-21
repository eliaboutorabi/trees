/**
 * The garden's sound.
 *
 * A small Web Audio engine that follows the scene rather than playing over
 * it. Every frame the studio hands it a snapshot of the values it is already
 * easing for the picture (the season, the hour, the rain, the wind and its
 * gusts, the ice, how fast the tree is growing, how hard the crown is being
 * rustled), and where the camera is. Each long sound's level chases those
 * values, so dusk falls in the ears as it falls on the screen; and each comes
 * from somewhere: the crown, the reeds of the pond, patches of the meadow,
 * stands of woodland on the horizon. Turn the camera and they turn round you.
 * Things that happen (a dove braking into the crown, a fish rising, an apple
 * landing) are played the moment the picture shows them, from where they
 * happened, with the browser's full head-related panning.
 *
 *   air, wind, the places ─► air ─────┐
 *   rain, snow ───────────► weather ──┤
 *   growth, rustle ───────► tree ─────┤ each: your level ─► ducking ─┐
 *   creatures ────────────► life ─────┤                              ├─► compressor ─► master
 *   the garden's music, cues ► music ─┤                              │
 *   clicks ───────────────► ui ───────┘ ─────────────────────────────┘
 *
 * Nothing is fetched until sound is switched on; a long sound's audio is let
 * go a while after it falls silent, so the season you are not in costs no
 * memory.
 */
import type { SceneEvent } from '../events';
import { GardenMusic } from './garden-music';
import { Loop, type SoundBank } from './loop';
import { SOUND_BY_ID, filesOf } from './manifest';
import { Emitter, distanceGain, hrtf, placeListener, type Ears, type Vec3 } from './space';

export type { Ears, Vec3 } from './space';

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
  /** Signed growth per second: up as it grows, down as it shrinks. */
  growthRate: number;
  /** How hard the crown is being rustled under the pointer, 0–1, and where the hand is. */
  rustle: number;
  hand: Vec3;
  /** Doves sitting in the tree. */
  perched: number;
  /** Ducks on the water, and how many of them are ducklings. */
  ducks: number;
  ducklings: number;
}

/** Where the garden's places are, in the world. */
export interface SoundPlaces {
  /** The foot of the trunk, and the tree's size. */
  tree: Vec3 & { height: number; radius: number };
  /** The middle of the water, and its half-extents. */
  pond: Vec3 & { rx: number; rz: number };
  /** Patches of long grass where the insects are. */
  meadow: Vec3[];
  /** Stands of the distant woods. */
  woods: Vec3[];
}

export type Bus = 'air' | 'weather' | 'tree' | 'life' | 'music' | 'ui';
export const BUSES: Bus[] = ['air', 'weather', 'life', 'tree', 'music', 'ui'];
const BUS_LEVEL: Record<Bus, number> = { air: 0.85, weather: 1, tree: 0.9, life: 0.8, music: 0.75, ui: 0.35 };

/** Everything sits this far under where it was first set: it was too loud. */
const TRIM = 0.5;

type PlaceName = 'tree' | 'pond' | 'meadow' | 'woods' | 'hand';
/** At what distance each place is heard as loud as its sounds were made. */
const PLACE_REF: Record<PlaceName, number> = { tree: 16, pond: 14, meadow: 10, woods: 100, hand: 10 };

/** How a one-shot is played. */
export interface Shot {
  /** Where it is in the world; left out, it is in the middle of your head (the interface). */
  at?: Vec3 | null;
  /** Where it travels to while it plays. */
  to?: Vec3;
  gain?: number;
  /** Seconds from now. */
  delay?: number;
  bus?: Bus;
  /** No closer than this to the last of the same sound: a burst is one sound. */
  minGap?: number;
  /** The distance at which it is as loud as it was made. */
  ref?: number;
  /** Which take, rather than the next in the pool. */
  take?: number;
  /** Played this much faster (higher), exactly, rather than a few percent either way. */
  rate?: number;
}

const BASE = `${import.meta.env.BASE_URL}sounds/`;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Music for what you change, which outranks which when several come together. */
const MOMENT_RANK: Record<string, number> = { season: 3, tree: 3, sky: 2, weather: 1 };

/** A one-shot's takes are mono: they are placed here, so a stereo file only doubles the memory. */
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

interface Channel {
  /** Its place in the mix, times your level for it. */
  mix: GainNode;
  /** Made room in under music. */
  duck: GainNode;
  meter: AnalyserNode | null;
  heard: number;
}

export class Soundscape implements SoundBank {
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly squeeze: DynamicsCompressorNode;
  private readonly channels = {} as Record<Bus, Channel>;
  private readonly yours: Record<Bus, number> = { air: 1, weather: 1, tree: 1, life: 1, music: 1, ui: 1 };
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly loops = new Map<string, Loop>();
  private readonly emitters = new Map<string, Emitter[]>();
  private readonly lastTake = new Map<string, number>();
  private readonly lastPlayed = new Map<string, number>();
  private readonly garden: GardenMusic;
  private volume = 0.8;
  private on = false;
  private dimmed = false;
  private touring = false;
  private places: SoundPlaces | null = null;
  private readonly ears: Ears = {
    pos: { x: 0, y: 2, z: 16 },
    forward: { x: 0, y: 0, z: -1 },
    right: { x: 1, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
  };

  /** The season's blend, eased the way the picture's colours are. */
  private readonly seasons: Record<SeasonName, number> = { spring: 0, summer: 1, autumn: 0, winter: 0 };
  private seasonSet = false;
  private wasIce = 0;
  private state: SoundState | null = null;
  /** The loops are kept fed on a clock of their own, so they carry on while the scene is paused. */
  private feeder = 0;
  private lastFeed = 0;
  /** Fruit landing: a few at once are a patter, a whole crown at once is still only a few. */
  private fruitBudget = 4;
  /** A moment's music playing, and which. */
  private cue: { src: AudioBufferSourceNode; gain: GainNode; id: string; until: number } | null = null;
  /** A moment asked for, waiting for you to settle; see `moment`. */
  private pending: { id: string; rank: number; duck: number } | null = null;
  private pendingTimer = 0;


  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.squeeze = this.ctx.createDynamicsCompressor();
    this.squeeze.threshold.value = -18;
    this.squeeze.knee.value = 12;
    this.squeeze.ratio.value = 3;
    this.squeeze.attack.value = 0.01;
    this.squeeze.release.value = 0.3;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.squeeze.connect(this.master).connect(this.ctx.destination);
    for (const bus of BUSES) {
      const mix = this.ctx.createGain();
      mix.gain.value = BUS_LEVEL[bus];
      const duck = this.ctx.createGain();
      mix.connect(duck).connect(this.squeeze);
      this.channels[bus] = { mix, duck, meter: null, heard: 0 };
    }
    this.garden = new GardenMusic(this, this.channels.music.mix);

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

  // ------------------------------------------------------------- controls

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
        this.garden.stop();
        this.cue?.src.stop();
        this.cue = null;
        clearTimeout(this.pendingTimer);
        this.pending = null;
        void this.ctx.suspend();
      }, 900);
    }
  }

  get enabled(): boolean {
    return this.on;
  }

  /** The whole garden's level, 0–1. */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.on) this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.1);
  }

  /** One layer's level, as a multiple of where it sits in the mix (0 silent, 1 as set, 2 twice). */
  setMix(bus: Bus, v: number): void {
    this.yours[bus] = Math.max(0, Math.min(2, v));
    this.channels[bus].mix.gain.setTargetAtTime(BUS_LEVEL[bus] * this.yours[bus], this.ctx.currentTime, 0.08);
  }

  /** Quieter while something covers the scene (the Learn page). */
  setDimmed(dim: boolean): void {
    this.dimmed = dim;
    if (this.on) this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.5);
  }

  private level(): number {
    return this.volume * this.volume * TRIM * (this.dimmed ? 0.3 : 1);
  }

  /**
   * How much each layer is sounding right now, 0–1, for a meter. Meters are
   * only attached while someone is watching; call with `watch = false` to
   * take them off.
   */
  meters(watch = true): Record<Bus, number> {
    const out = {} as Record<Bus, number>;
    const data = new Float32Array(1024);
    for (const bus of BUSES) {
      const c = this.channels[bus];
      if (!watch) {
        c.meter?.disconnect();
        c.meter = null;
        out[bus] = 0;
        continue;
      }
      if (!c.meter) {
        c.meter = this.ctx.createAnalyser();
        c.meter.fftSize = 1024;
        c.duck.connect(c.meter);
      }
      c.meter.getFloatTimeDomainData(data);
      let e = 0;
      for (let i = 0; i < data.length; i++) e += data[i] * data[i];
      const db = 10 * Math.log10(e / data.length + 1e-12);
      // −62 dB is nothing, −22 is a full bar; eased so a bar falls slower than it rises.
      const v = Math.min(1, Math.max(0, (db + 62) / 40));
      c.heard = v > c.heard ? v : c.heard * 0.86 + v * 0.14;
      out[bus] = this.on ? c.heard : 0;
    }
    return out;
  }

  // ---------------------------------------------------------------- space

  /** Where the garden's places are. Call again when the tree changes size. */
  setPlaces(places: SoundPlaces): void {
    this.places = places;
    for (const [key, list] of this.emitters) {
      const points = this.pointsOf(key.split('/')[0] as PlaceName);
      list.forEach((e, i) => Object.assign(e.at, points[i % points.length]));
    }
  }

  /** Where the camera is, and which way it looks. Every frame. */
  setEars(ears: Ears): void {
    Object.assign(this.ears.pos, ears.pos);
    Object.assign(this.ears.forward, ears.forward);
    Object.assign(this.ears.right, ears.right);
    Object.assign(this.ears.up, ears.up);
    if (!this.on) return;
    placeListener(this.ctx, this.ears);
    for (const list of this.emitters.values()) for (const e of list) e.aim(this.ears);
  }

  /** Where a place's emitters stand. */
  private pointsOf(place: PlaceName): Vec3[] {
    const p = this.places;
    if (!p) return [{ x: 0, y: 1, z: 0 }];
    switch (place) {
      case 'tree': {
        // Round the crown, so a near tree is wide and a far one a point.
        const { x, y, z, height, radius } = p.tree;
        return [0, 1, 2].map((k) => {
          const a = (k / 3) * Math.PI * 2 + 0.5;
          return { x: x + Math.cos(a) * radius * 0.65, y: y + height * 0.55, z: z + Math.sin(a) * radius * 0.65 };
        });
      }
      case 'pond':
        return [-1, 1].map((s) => ({ x: p.pond.x + s * p.pond.rx * 0.45, y: p.pond.y + 0.2, z: p.pond.z }));
      case 'hand':
        return [this.state?.hand ?? { x: 0, y: 3, z: 0 }];
      default:
        return p[place];
    }
  }

  private emittersOf(place: PlaceName, bus: Bus): Emitter[] {
    const key = `${place}/${bus}`;
    let list = this.emitters.get(key);
    if (!list) {
      list = this.pointsOf(place).map((at) => {
        const e = new Emitter(this.ctx, this.channels[bus].mix, { ...at }, PLACE_REF[place]);
        e.aim(this.ears);
        return e;
      });
      this.emitters.set(key, list);
    }
    return list;
  }

  // -------------------------------------------------------------- loading

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
      'fish-plop', 'dove-coo', 'dove-takeoff', 'dove-flutter-in', 'dove-flutter-off', 'leaf-fall', 'apple-thud',
      'berry-patter', 'cone-thud', 'grow-seed', 'grow-bloom', 'tree-sink', 'duck-quack', 'duckling-peep',
      'duck-dabble', 'songbird-spring', 'songbird-summer', 'songbird-autumn', 'chickadee', 'ice-creak',
    ]) {
      const spec = SOUND_BY_ID[id];
      if (spec) for (const f of filesOf(spec)) void this.buffer(f, true);
    }
  }

  /** A long sound: all around you, or played from a place. */
  private loop(id: string, bus: Bus, place?: PlaceName, reverse = false): Loop {
    const key = `${id}${reverse ? '~' : ''}@${place ?? 'all'}`;
    let l = this.loops.get(key);
    if (!l) {
      const to = place ? this.emittersOf(place, bus).map((e) => e.input) : [this.channels[bus].mix];
      l = new Loop(this, `${id}.mp3`, to, reverse);
      this.loops.set(key, l);
    }
    return l;
  }

  private feed(): void {
    const now = performance.now();
    const dt = Math.min(1, (now - this.lastFeed) / 1000);
    this.lastFeed = now;
    for (const l of this.loops.values()) l.tick(dt);
  }

  // ------------------------------------------------------------ one-shots

  /** Play a one-shot from its pool of takes, from where it happened. */
  play(id: string, shot: Shot = {}): void {
    if (!this.on || this.ctx.state !== 'running') return;
    const spec = SOUND_BY_ID[id];
    if (!spec) return;
    const now = this.ctx.currentTime;
    const gap = shot.minGap ?? 0;
    if (gap > 0 && now - (this.lastPlayed.get(id) ?? -1e9) < gap) return;
    this.lastPlayed.set(id, now);
    const files = filesOf(spec);
    let k = shot.take ?? Math.floor(Math.random() * files.length);
    if (shot.take === undefined && files.length > 1 && k === this.lastTake.get(id)) k = (k + 1) % files.length;
    k = Math.min(files.length - 1, Math.max(0, k));
    this.lastTake.set(id, k);
    const bus = shot.bus ?? 'life';
    void this.buffer(files[k], true).then((b) => {
      if (!b || !this.on) return;
      // A late decode still lands on its moment if it can, or as soon as it can.
      const start = Math.max(this.ctx.currentTime, now + (shot.delay ?? 0));
      const src = this.ctx.createBufferSource();
      src.buffer = b;
      src.playbackRate.value = shot.rate ?? 1 + (Math.random() - 0.5) * 0.06;
      const gain = this.ctx.createGain();
      const base = (shot.gain ?? 1) * Math.pow(10, ((Math.random() - 0.5) * 3) / 20);
      let last: AudioNode = gain;
      src.connect(gain);
      if (shot.at) {
        const ref = shot.ref ?? 12;
        const ears = this.ears.pos;
        const far = (p: Vec3) => distanceGain(Math.hypot(p.x - ears.x, p.y - ears.y, p.z - ears.z), ref);
        if (shot.to) {
          // Swelling as it passes: the level along its path, sampled.
          const steps = 12;
          const curve = Float32Array.from({ length: steps }, (_, i) => {
            const t = i / (steps - 1);
            const a = shot.at!;
            const b2 = shot.to!;
            return base * far({ x: a.x + (b2.x - a.x) * t, y: a.y + (b2.y - a.y) * t, z: a.z + (b2.z - a.z) * t });
          });
          gain.gain.setValueCurveAtTime(curve, start, b.duration);
        } else {
          gain.gain.value = base * far(shot.at);
        }
        const panner = hrtf(this.ctx, shot.at, shot.to, b.duration, start);
        gain.connect(panner);
        last = panner;
      } else {
        gain.gain.value = base;
      }
      last.connect(this.channels[bus].mix);
      src.start(start);
      src.onended = () => last.disconnect();
    });
  }

  /**
   * Music for something you changed. It waits until you have settled (a
   * flick through four seasons is one piece, for the one you stopped on);
   * when several changes come together (a season that brings snow), the
   * one that matters most is the one heard.
   */
  moment(id: string, kind: keyof typeof MOMENT_RANK, duck = 0.75): void {
    if (!this.on) return;
    const rank = MOMENT_RANK[kind] ?? 1;
    const waiting = this.pending;
    if (waiting && waiting.rank > rank) return;
    this.pending = { id, rank, duck };
    clearTimeout(this.pendingTimer);
    this.pendingTimer = window.setTimeout(() => {
      const p = this.pending;
      this.pending = null;
      // The same piece, still playing, is not started again.
      if (!p || (this.cue?.id === p.id && this.ctx.currentTime < this.cue.until - 3)) return;
      this.music(p.id, p.duck);
    }, 700);
  }

  /** A piece of music for a moment; the air and the creatures make room for it, and the garden's own music waits. */
  music(id: string, duck = 0.6): void {
    if (!this.on || this.ctx.state !== 'running' || this.yours.music < 0.02) return;
    const spec = SOUND_BY_ID[id];
    const files = spec ? filesOf(spec) : [`${id}.mp3`];
    const file = files[Math.floor(Math.random() * files.length)];
    void this.buffer(file, false).then((b) => {
      if (!b || !this.on) return;
      const now = this.ctx.currentTime;
      // A new cue takes over from one still playing, briefly overlapping.
      if (this.cue) {
        const old = this.cue;
        old.gain.gain.setTargetAtTime(0, now, 0.4);
        old.src.stop(now + 2);
      }
      this.garden.hush(rand(90, 150));
      const src = this.ctx.createBufferSource();
      src.buffer = b;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.85, now + 0.6);
      src.connect(gain).connect(this.channels.music.mix);
      src.start(now + 0.05);
      const until = now + b.duration;
      this.cue = { src, gain, id, until };
      src.onended = () => {
        if (this.cue?.src === src) this.cue = null;
        gain.disconnect();
        this.forget(file);
      };
      // Duck the air and the creatures under it, and bring them back as it ends.
      for (const bus of ['air', 'life'] as Bus[]) {
        const g = this.channels[bus].duck.gain;
        g.cancelScheduledValues(now);
        g.setTargetAtTime(duck, now, 0.5);
        g.setTargetAtTime(1, Math.max(now + 1, until - 3), 1.2);
      }
    });
  }

  // ---------------------------------------------------------------- frame

  /** One frame: every long sound's level, the garden's music, and the creatures that call on their own. */
  update(s: SoundState, dt: number): void {
    this.state = s;
    if (!this.on) return;
    this.fruitBudget = Math.min(4, this.fruitBudget + dt * 5);
    const hand = this.emitters.get('hand/tree');
    if (hand) Object.assign(hand[0].at, s.hand);

    // The season's blend eases as the colours do.
    const k = this.seasonSet ? 1 - Math.exp(-dt / 1.2) : 1;
    this.seasonSet = true;
    for (const name of Object.keys(this.seasons) as SeasonName[]) {
      this.seasons[name] += ((name === s.season ? 1 : 0) - this.seasons[name]) * k;
    }
    const { spring, summer, autumn, winter } = this.seasons;

    const day = 1 - s.night;
    const wet = s.rain;
    // Rain and snow mask the quiet life of the place.
    const hush = (1 - 0.65 * wet) * (1 - 0.35 * s.snow);

    // The air all around: the season by day and by night, under the places.
    for (const name of Object.keys(this.seasons) as SeasonName[]) {
      const w = this.seasons[name] * hush * 0.7;
      this.loop(`bed-${name}-day`, 'air').set(w * day, 1.2);
      this.loop(`bed-${name}-night`, 'air').set(w * s.night, 1.2);
    }

    // The places, heard from where they are. The woods on the horizon carry
    // the season's birds by day and an owl's quiet by night; the meadow's
    // grass its insects; the pond its frogs, once the light goes.
    for (const name of Object.keys(this.seasons) as SeasonName[]) {
      this.loop(`woods-${name}`, 'life', 'woods').set(this.seasons[name] * day * hush * 0.9, 1.5);
    }
    this.loop('woods-night', 'life', 'woods').set(s.night * hush * (1 - 0.5 * winter) * 0.8, 1.5);
    this.loop('insects-meadow', 'life', 'meadow').set(day * hush * (summer + 0.35 * spring + 0.2 * autumn), 1.5);
    this.loop('crickets-night', 'life', 'meadow').set(s.night * hush * (summer + 0.7 * autumn + 0.3 * spring), 1.5);
    this.loop('frogs-pond', 'life', 'pond').set((spring + 0.8 * summer) * (0.15 + 0.85 * s.night) * (1 - s.ice) * hush, 1.5);

    // Wind in the tree, swelling with the gusts the crown is visibly taking.
    // The slider runs to 1.5: a summer breeze is about a third of that and
    // already heard; by 0.8 the crown is in full voice, and the gale comes in
    // over the top of it beyond 1.
    const wind = Math.max(0, s.wind);
    const swell = 0.55 + 0.45 * s.gust;
    const breeze = Math.sqrt(Math.min(1, wind / 0.8));
    const gale = smoothstep(0.95, 1.5, wind);
    const broadleaf = s.needles ? 0 : 1;
    this.loop('wind-leaves', 'air', 'tree').set(s.leafy * broadleaf * breeze * swell * (1 - 0.45 * gale), 0.25);
    this.loop('wind-pine', 'air', 'tree').set((1 - broadleaf) * breeze * swell, 0.25);
    this.loop('wind-bare', 'air', 'tree').set((1 - s.leafy) * broadleaf * Math.min(1, wind / 0.9) * swell, 0.25);
    this.loop('wind-gale', 'air').set(gale * swell, 0.25);

    // Weather. Rain, once it is falling, is the loudest thing out there.
    const heavy = smoothstep(0.45, 0.95, wet);
    this.loop('rain-light', 'weather').set(Math.sqrt(wet) * (1 - heavy) * 1.5, 0.6);
    this.loop('rain-heavy', 'weather').set(heavy * 1.6, 0.6);
    this.loop('rain-pond', 'weather', 'pond').set(wet * (1 - s.ice) * 1.2, 0.6);
    this.loop('snowfall', 'weather').set(s.snow * 0.9, 0.8);

    // The pond laps, quieter in the rain, silent once frozen.
    this.loop('pond-water', 'air', 'pond').set((1 - s.ice) * (1 - 0.5 * wet) * 0.9, 0.5);

    // The tree. Growth is heard as fast as it happens, and backwards when it
    // shrinks; the rustle is where the hand is.
    const grow = Math.min(1, Math.max(0, s.growthRate) / 0.3);
    const shrink = Math.min(1, Math.max(0, -s.growthRate) / 0.6);
    this.loop('grow-texture', 'tree', 'tree').set(Math.pow(grow, 0.6) * 1.3, 0.12);
    this.loop('grow-texture', 'tree', 'tree', true).set(Math.pow(shrink, 0.6) * 0.8, 0.12);
    this.loop('rustle-hand', 'tree', 'hand').set(s.rustle * Math.max(0.15, s.leafy) * 1.2, 0.1);

    // Pond ice: it groans as it closes over.
    if (s.ice > 0.35 && this.wasIce <= 0.35) this.play('ice-creak', { at: this.pondPoint(), gain: 0.8, bus: 'weather', ref: 14 });
    this.wasIce = s.ice;

    // The garden's own music, when nothing else has the music and anyone wants it.
    const free = !this.cue && !this.touring && this.yours.music > 0.02;
    this.garden.tick(dt, s.season, s.night, free);

    this.chorus(s, dt);
  }

  // ------------------------------------------------------------- the places

  private crownPoint(): Vec3 {
    const t = this.places?.tree;
    if (!t) return { x: 0, y: 5, z: 0 };
    const a = Math.random() * Math.PI * 2;
    const r = t.radius * rand(0.2, 0.7);
    return { x: t.x + Math.cos(a) * r, y: t.y + t.height * rand(0.5, 0.85), z: t.z + Math.sin(a) * r };
  }

  private pondPoint(): Vec3 {
    const p = this.places?.pond;
    if (!p) return { x: -2, y: 0, z: -8 };
    const a = Math.random() * Math.PI * 2;
    return { x: p.x + Math.cos(a) * p.rx * rand(0, 0.6), y: p.y + 0.1, z: p.z + Math.sin(a) * p.rz * rand(0, 0.6) };
  }

  /** Somewhere out in the land, `near`–`far` metres from the tree, `up` off the ground. */
  private around(near: number, far: number, up: number): Vec3 {
    const a = Math.random() * Math.PI * 2;
    const r = rand(near, far);
    return { x: Math.cos(a) * r, y: up, z: Math.sin(a) * r };
  }

  /** The creatures that call on their own, each at its own unhurried rate, each from somewhere. */
  private chorus(s: SoundState, dt: number): void {
    const day = 1 - s.night;
    const quiet = (1 - 0.7 * s.rain) * (1 - 0.5 * s.snow);
    const chance = (perSecond: number) => Math.random() < perSecond * dt;
    const ears = this.ears;

    // Doves in the crown coo now and then, more of them more often.
    if (day > 0.5 && s.perched > 0 && chance(Math.min(0.2, s.perched * 0.022) * quiet)) {
      this.play('dove-coo', { at: this.crownPoint(), gain: rand(0.4, 0.75), minGap: 2 });
    }
    // Songbirds, by season, by day: mostly out in the hedges, now and then from the top of the tree.
    const song = { spring: ['songbird-spring', 1 / 9], summer: ['songbird-summer', 1 / 14], autumn: ['songbird-autumn', 1 / 26], winter: null }[s.season] as
      | [string, number]
      | null;
    if (song && day > 0.6 && chance(song[1] * quiet)) {
      const at = Math.random() < 0.3 ? this.crownPoint() : this.around(25, 55, 4);
      this.play(song[0], { at, gain: 0.6, minGap: 3, ref: 18 });
    }
    // Ducks talk among themselves; the ducklings never stop peeping.
    if (s.ducks > 0.5 && day > 0.3 && chance((1 / 14) * quiet)) this.play('duck-quack', { at: this.pondPoint(), gain: 0.55, minGap: 3, ref: 12 });
    if (s.ducklings > 0.3 && chance((1 / 9) * quiet)) this.play('duckling-peep', { at: this.pondPoint(), gain: 0.35, minGap: 4, ref: 10 });
    // A bumblebee goes by close, from one side of you to the other.
    if (day > 0.6 && (s.season === 'spring' || s.season === 'summer') && chance((1 / 35) * quiet)) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const ahead = rand(1.5, 4);
      const from = this.offset(ears, -6 * side, -1.2, ahead + rand(-1, 1));
      const to = this.offset(ears, 6 * side, -0.8, ahead + rand(-1, 1));
      this.play('bee-flyby', { at: from, to, gain: 0.45, minGap: 10, ref: 3 });
    }
    // Further off: crows in the cold months, an owl at night from the woods,
    // geese passing high over in autumn, thunder in a downpour under heavy cloud.
    if (day > 0.6 && (s.season === 'autumn' || s.season === 'winter') && chance((1 / 40) * quiet)) {
      this.play('crow-far', { at: this.around(60, 110, 12), gain: 0.5, minGap: 10, ref: 80 });
    }
    if (day > 0.6 && s.season === 'autumn' && chance(1 / 150)) {
      const a = Math.random() * Math.PI * 2;
      const from = { x: Math.cos(a) * 140, y: 45, z: Math.sin(a) * 140 };
      this.play('geese-far', { at: from, to: { x: -from.x, y: 45, z: -from.z }, gain: 0.6, minGap: 60, ref: 60 });
    }
    if (s.night > 0.7 && s.season !== 'summer' && chance((1 / 35) * quiet)) {
      const woods = this.places?.woods;
      const stand = woods?.length ? woods[Math.floor(Math.random() * woods.length)] : this.around(70, 90, 8);
      this.play('owl-hoot', { at: { x: stand.x * 0.65, y: 9, z: stand.z * 0.65 }, gain: 0.55, minGap: 12, ref: 60 });
    }
    if (s.rain > 0.7 && s.overcast > 0.6 && chance(1 / 45)) {
      this.play('thunder-far', { at: this.around(300, 500, 120), gain: 0.65, bus: 'weather', minGap: 15, ref: 400 });
    }
    if (s.ice > 0.9 && chance(1 / 28)) this.play('ice-sing', { at: this.pondPoint(), gain: 0.5, bus: 'weather', minGap: 8, ref: 14 });
  }

  /** A point relative to the ears: right, up, ahead, in metres. */
  private offset(ears: Ears, right: number, up: number, ahead: number): Vec3 {
    const { pos, right: r, up: u, forward: f } = ears;
    return {
      x: pos.x + r.x * right + u.x * up + f.x * ahead,
      y: pos.y + r.y * right + u.y * up + f.y * ahead,
      z: pos.z + r.z * right + u.z * up + f.z * ahead,
    };
  }

  // --------------------------------------------------------------- events

  /** Something happened in the garden, here: the sound of it, at the moment the picture shows it. */
  happen(e: SceneEvent): void {
    if (!this.on) return;
    const at = { x: e.x, y: e.y, z: e.z };
    const voice = e.detail ?? 0.5;
    switch (e.kind) {
      case 'dove-flush':
        // A flock put up is one clatter, however many go.
        this.play('dove-takeoff', { at, gain: 0.7, minGap: 1.2 });
        break;
      case 'dove-takeoff':
        // Leaving in its own time: a quiet bird is not heard at all.
        if (Math.random() < voice * 1.2) this.play('dove-flutter-off', { at, gain: 0.25 + 0.45 * voice, minGap: 3 });
        break;
      case 'dove-arrive':
        if (Math.random() < 0.35 + 0.65 * voice) this.play('dove-flutter-in', { at, gain: 0.25 + 0.5 * voice, minGap: 2.5 });
        break;
      case 'fish-rise':
        // Not every rise is heard: a few fish feeding are a plop now and then.
        if (Math.random() < 0.6) this.play('fish-plop', { at, gain: 0.55, minGap: 2.5 });
        break;
      case 'duck-dabble':
        this.play('duck-dabble', { at, gain: 0.65, minGap: 2 });
        break;
      case 'robin-hop':
        // It does not call at every hop.
        if (Math.random() < 0.3) this.play('chickadee', { at, gain: 0.6, minGap: 5 });
        break;
      case 'fruit-fall': {
        if (this.fruitBudget < 1) break;
        this.fruitBudget -= 1;
        const id = e.detail === 2 ? 'cone-thud' : e.detail === 1 ? 'apple-thud' : 'berry-patter';
        // Heard where it lands, which is under where it hung.
        this.play(id, { at: { x: e.x, y: 0.1, z: e.z }, gain: 0.8, delay: e.delay, bus: 'tree' });
        break;
      }
      case 'leaves-fall':
        this.play('leaf-fall', { at, gain: Math.min(1, 0.4 + (e.detail ?? 6) * 0.03), bus: 'tree', minGap: 1.4 });
        break;
      case 'grow-start':
        this.play('grow-seed', { at: this.treeFoot(0.2), gain: 0.8, bus: 'tree', minGap: 0.5, ref: 16 });
        break;
      case 'grow-done':
        this.play('grow-bloom', { at: this.treeFoot(0.6), gain: 0.7, bus: 'tree', minGap: 1, ref: 16 });
        break;
      case 'tree-sink':
        this.play('tree-sink', { at: this.treeFoot(0.3), gain: 0.7, bus: 'tree', minGap: 1, ref: 16 });
        break;
      case 'nightfall':
      case 'daybreak':
      case 'rainbow':
      case 'aurora':
        this.moment(`music-${e.kind}`, 'sky', 0.6);
        break;
      case 'season':
        this.moment(`moment-${(['spring', 'summer', 'autumn', 'winter'] as const)[e.detail ?? 0]}`, 'season');
        break;
      case 'weather':
        this.moment(`moment-${(['clear', 'rain', 'snow'] as const)[e.detail ?? 0]}`, 'weather');
        break;
      case 'new-tree':
        this.moment('moment-tree', 'tree');
        break;
    }
  }

  private treeFoot(up: number): Vec3 {
    const t = this.places?.tree;
    return t ? { x: t.x, y: t.y + t.height * up, z: t.z } : { x: 0, y: 2, z: 0 };
  }

  /** The interface's own small sounds, very quiet: a switch, a card, a question. */
  ui(kind: 'pebble' | 'card' | 'ask'): void {
    this.play(`ui-${kind}`, { gain: kind === 'card' ? 0.5 : 0.7, bus: 'ui', minGap: 0.06 });
  }

  /** The welcome's tune, once, if sound is on when it opens. */
  welcome(): void {
    this.music('music-welcome', 0.7);
  }

  /** A quiet underscore while the whole tour plays itself; the garden's music waits. */
  setTour(on: boolean): void {
    this.touring = on;
    this.loop('music-tour', 'music').set(on ? 0.55 : 0, on ? 2 : 1.5);
  }

  dispose(): void {
    this.on = false;
    clearInterval(this.feeder);
    clearTimeout(this.pendingTimer);
    window.removeEventListener('pointerdown', this.wake);
    window.removeEventListener('keydown', this.wake);
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const l of this.loops.values()) l.stop();
    this.garden.stop();
    void this.ctx.close();
  }
}
