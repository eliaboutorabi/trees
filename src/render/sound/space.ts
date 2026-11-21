/**
 * Where a sound is, for the ears at the camera.
 *
 * Two ways of putting a sound somewhere:
 *
 *  - An `Emitter` is a fixed spot that long sounds play from — a stand of
 *    trees on the horizon, the reeds of the pond, a patch of meadow. It is a
 *    pan, a gentle dulling for what is behind you and a level for how far it
 *    is, all of it re-aimed every frame as the camera moves. Cheap enough to
 *    have a couple of dozen, and the loops through them never stop, so the
 *    cost matters more than the last word in localisation.
 *
 *  - A one-shot gets the browser's HRTF panner: the full head-related cues,
 *    above and behind included, for the short time it plays. A bee or a skein
 *    of geese can travel along a path while it sounds.
 *
 * Levels follow distance against a reference: at `ref` metres a sound is as
 * loud as it was made, nearer it is louder, further quieter, never silent.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** The listener: where the camera is, and which way is ahead, right and up. */
export interface Ears {
  pos: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

/** How loud something `d` metres away is, against how loud it is at `ref`. */
export function distanceGain(d: number, ref: number, floor = 0.06, ceil = 1.6): number {
  return Math.min(ceil, Math.max(floor, Math.pow(ref / Math.max(0.5, d), 0.8)));
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * Seen from the ears, a point's side (-1 left … 1 right), how far behind it
 * is (0 ahead … 1 straight behind) and its distance. `size` keeps something
 * you are standing next to from snapping hard into one ear.
 */
export function bearing(ears: Ears, at: Vec3, size = 1.5): { side: number; behind: number; distance: number } {
  const d = { x: at.x - ears.pos.x, y: at.y - ears.pos.y, z: at.z - ears.pos.z };
  const distance = Math.hypot(d.x, d.y, d.z);
  const r = dot(d, ears.right);
  const f = dot(d, ears.forward);
  const flat = Math.hypot(r, f, size);
  return { side: r / flat, behind: Math.max(0, -f / flat), distance };
}

/** A fixed spot that long sounds play from. Connect sources to `input`. */
export class Emitter {
  readonly input: GainNode;
  private readonly level: GainNode;
  private readonly shade: BiquadFilterNode;
  private readonly pan: StereoPannerNode;

  constructor(
    private readonly ctx: BaseAudioContext,
    out: AudioNode,
    /** Where it is; move it by writing to this. */
    readonly at: Vec3,
    /** The distance at which it is heard as loud as it was made. */
    private readonly ref: number,
    /** How far round it can swing: a little short of one ear, which is how a real one sounds. */
    private readonly width = 0.82,
  ) {
    this.input = ctx.createGain();
    this.shade = ctx.createBiquadFilter();
    this.shade.type = 'lowpass';
    this.shade.frequency.value = 20000;
    this.shade.Q.value = 0.5;
    this.level = ctx.createGain();
    this.pan = ctx.createStereoPanner();
    this.input.connect(this.shade).connect(this.level).connect(this.pan).connect(out);
  }

  /** Re-aim for where the ears now are. */
  aim(ears: Ears): void {
    const { side, behind, distance } = bearing(ears, this.at);
    const now = this.ctx.currentTime;
    this.pan.pan.setTargetAtTime(side * this.width, now, 0.06);
    // Behind you, a sound loses its air and a little of its level: the
    // cheapest front-from-back cue there is, and the ear accepts it.
    this.shade.frequency.setTargetAtTime(20000 - 15000 * Math.pow(behind, 1.3), now, 0.08);
    this.level.gain.setTargetAtTime(distanceGain(distance, this.ref) * (1 - 0.25 * behind), now, 0.08);
  }
}

/** Put the browser's own listener where the ears are, for the HRTF one-shots. */
export function placeListener(ctx: BaseAudioContext, ears: Ears): void {
  const l = ctx.listener;
  const { pos, forward, up } = ears;
  if (l.positionX) {
    const now = ctx.currentTime;
    const set = (p: AudioParam, v: number) => p.setTargetAtTime(v, now, 0.03);
    set(l.positionX, pos.x);
    set(l.positionY, pos.y);
    set(l.positionZ, pos.z);
    set(l.forwardX, forward.x);
    set(l.forwardY, forward.y);
    set(l.forwardZ, forward.z);
    set(l.upX, up.x);
    set(l.upY, up.y);
    set(l.upZ, up.z);
  } else {
    // Older engines: the deprecated setters, which is all they have.
    const legacy = l as unknown as {
      setPosition(x: number, y: number, z: number): void;
      setOrientation(x: number, y: number, z: number, ux: number, uy: number, uz: number): void;
    };
    legacy.setPosition(pos.x, pos.y, pos.z);
    legacy.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
  }
}

/**
 * An HRTF panner for one sound at `from`, travelling to `to` over `seconds`
 * if given. Distance is left to the caller's gain: the panner only says where.
 */
export function hrtf(ctx: BaseAudioContext, from: Vec3, to?: Vec3, seconds = 0, start = ctx.currentTime): PannerNode {
  const p = ctx.createPanner();
  p.panningModel = 'HRTF';
  p.distanceModel = 'linear';
  p.rolloffFactor = 0;
  p.positionX.setValueAtTime(from.x, start);
  p.positionY.setValueAtTime(from.y, start);
  p.positionZ.setValueAtTime(from.z, start);
  if (to && seconds > 0) {
    p.positionX.linearRampToValueAtTime(to.x, start + seconds);
    p.positionY.linearRampToValueAtTime(to.y, start + seconds);
    p.positionZ.linearRampToValueAtTime(to.z, start + seconds);
  }
  return p;
}
