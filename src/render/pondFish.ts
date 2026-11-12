/**
 * Red fish in the pond: goldfish, and a couple of koi.
 *
 * They have no meshes. A fish under the surface is only ever seen *through*
 * it, tinted by the water above it, bent by the ripples, gone in the glare
 * where the surface turns to mirror — so the water's own shader draws them,
 * from where this says they are (see `fishInWater` in `pond.ts`). All this
 * does is swim them.
 *
 * Each one wanders on a slow turn of its own, keeps to water deep enough to
 * hide in, schools loosely with the others — matching their heading, never
 * bumping — cruises, and now and then darts and glides. Every half a minute
 * or so one comes up to kiss the surface, leaving a ring. A duck paddling
 * over sends the nearest scattering. A pointer held over the water draws
 * them in, as fish gather under anyone standing at the edge of a pond. And
 * when the ice closes over they sink to the bottom and barely move till
 * spring.
 */
import { Vector3, Vector4 } from 'three';
import { mulberry32 } from '../lib/rng';
import { groundAt, POND, pondField } from './pondShape';

export const MAX_FISH = 8;

interface Fish {
  x: number;
  z: number;
  heading: number;
  speed: number;
  cruise: number;
  depth: number;
  goal: number;
  length: number;
  /** The tail's beat, in radians. */
  beat: number;
  /** Its own wandering, so no two turn alike. */
  w1: number;
  w2: number;
  /** Seconds until it darts, or rises, again. */
  dartIn: number;
  riseIn: number;
  rising: boolean;
  /** Seconds since it broke the surface, and where; negative when there is no ring. */
  ring: number;
  ringX: number;
  ringZ: number;
}

/** Depth of water at (x, z), surface to bed. */
function waterDepth(x: number, z: number): number {
  return POND.level - groundAt(pondField(x, z));
}

/** Ease `from` toward `to` over roughly `seconds`, whatever the frame rate. */
function ease(from: number, to: number, seconds: number, dt: number): number {
  return from + (to - from) * (1 - Math.exp(-dt / seconds));
}

/** The shortest signed turn from `a` to `b`. */
function turnTo(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

export class PondFish {
  /** For the water: where each fish is and which way it faces, x, z, fx, fz. */
  readonly pose: Vector4[] = Array.from({ length: MAX_FISH }, () => new Vector4());
  /** And how it looks: depth below the surface, length, tail beat. */
  readonly look: Vector4[] = Array.from({ length: MAX_FISH }, () => new Vector4());
  /** The ring each one last left on the surface: x, z, age in seconds (negative for none). */
  readonly rings: Vector4[] = Array.from({ length: MAX_FISH }, () => new Vector4(0, 0, -1, 0));

  private readonly fish: Fish[] = [];
  private readonly rng = mulberry32(90210);
  private clock = 0;

  constructor() {
    const r = this.rng;
    for (let i = 0; i < MAX_FISH; i++) {
      // Somewhere comfortably inside, in water deep enough.
      let x = POND.x;
      let z = POND.z;
      for (let tries = 0; tries < 50; tries++) {
        const a = r() * Math.PI * 2;
        const d = r() * 0.6;
        x = POND.x + Math.cos(a) * d * POND.rx;
        z = POND.z + Math.sin(a) * d * POND.rz;
        if (waterDepth(x, z) > 0.3) break;
      }
      const length = 0.26 + r() * 0.18;
      this.fish.push({
        x,
        z,
        heading: r() * Math.PI * 2,
        speed: 0.15,
        cruise: 0.11 + r() * 0.08,
        depth: 0.2,
        goal: 0.12 + r() * 0.18,
        length,
        beat: r() * Math.PI * 2,
        w1: r() * 100,
        w2: r() * 100,
        dartIn: 4 + r() * 10,
        riseIn: 8 + r() * 30,
        rising: false,
        ring: -1,
        ringX: x,
        ringZ: z,
      });
    }
  }

  /**
   * One frame. `ice` is how frozen the pond is; `ducks` the ducks' wakes
   * (x, z, vx, vz), which they shy from; `lure` a point on the water the
   * pointer is over, if any, which they come to.
   */
  update(dt: number, ice: number, ducks: readonly Vector4[], lure: Vector3 | null): void {
    this.clock += dt;
    const t = this.clock;
    const r = this.rng;
    const frozen = Math.min(1, Math.max(0, (ice - 0.2) / 0.6));

    for (let i = 0; i < this.fish.length; i++) {
      const f = this.fish[i];
      const fx = Math.sin(f.heading);
      const fz = Math.cos(f.heading);
      const bed = waterDepth(f.x, f.z);

      // A slow wander of its own.
      let turn = 0.55 * Math.sin(t * 0.31 + f.w1) + 0.35 * Math.sin(t * 0.77 + f.w2);

      // Keep off the shallows: look ahead, and if the water there is thin or
      // the bank is near, swing toward the middle — harder the nearer it is.
      const ahead = 0.45 + f.speed * 2;
      const ax = f.x + fx * ahead;
      const az = f.z + fz * ahead;
      const edge = Math.max((pondField(ax, az) - 0.62) / 0.2, (0.24 - waterDepth(ax, az)) / 0.12);
      if (edge > 0) {
        const home = Math.atan2(POND.x - f.x, POND.z - f.z);
        turn += Math.sign(turnTo(f.heading, home)) * Math.min(1, edge) * 2.6;
      }

      // School loosely: turn with neighbours, and away from any too close.
      let alignX = 0;
      let alignZ = 0;
      for (let j = 0; j < this.fish.length; j++) {
        if (j === i) continue;
        const o = this.fish[j];
        const dx = o.x - f.x;
        const dz = o.z - f.z;
        const d = Math.hypot(dx, dz);
        // A body length apart, or near enough: never stacked on one another,
        // even crowding under a hand.
        const room = (f.length + o.length) * 0.65;
        if (d < room && d > 1e-4) {
          // Which side the other is on decides which way to turn away.
          const side = fx * dz - fz * dx;
          turn -= Math.sign(side) * (room - d) * 12;
          // And the one behind gives way.
          if (dx * fx + dz * fz > 0) f.speed *= 1 - Math.min(0.5, dt * 3);
        } else if (d < 1.2) {
          alignX += Math.sin(o.heading);
          alignZ += Math.cos(o.heading);
        }
      }
      if (alignX !== 0 || alignZ !== 0) turn += turnTo(f.heading, Math.atan2(alignX, alignZ)) * 0.35;

      let want = f.cruise;

      // Come to a hand over the water — slowing to mill about under it.
      if (lure && frozen < 0.5) {
        const dx = lure.x - f.x;
        const dz = lure.z - f.z;
        const d = Math.hypot(dx, dz);
        if (d < 4.5) {
          turn += turnTo(f.heading, Math.atan2(dx, dz)) * (d > 0.4 ? 1.6 : 0.4);
          want = d > 0.6 ? f.cruise * 1.8 : f.cruise * 0.6;
        }
      }

      // Shy from a duck that is paddling close.
      for (const w of ducks) {
        const moving = Math.abs(w.z) + Math.abs(w.w) > 0.002;
        if (!moving) continue;
        const dx = f.x - w.x;
        const dz = f.z - w.y;
        const d = Math.hypot(dx, dz);
        if (d < 0.8) {
          turn += turnTo(f.heading, Math.atan2(dx, dz)) * 3;
          f.speed = Math.max(f.speed, 0.55);
        }
      }

      // Now and then a dart: a quick flick, then a glide back to cruising.
      f.dartIn -= dt;
      if (f.dartIn <= 0) {
        f.speed = Math.max(f.speed, 0.42 + r() * 0.25);
        f.heading += (r() - 0.5) * 1.2;
        f.dartIn = 6 + r() * 12;
      }

      // Cold water: almost still.
      want *= 1 - frozen * 0.85;
      turn *= 1 - frozen * 0.8;

      f.heading += Math.max(-2.4, Math.min(2.4, turn)) * dt;
      f.speed = ease(f.speed, want, 0.9, dt);
      f.x += Math.sin(f.heading) * f.speed * dt;
      f.z += Math.cos(f.heading) * f.speed * dt;

      // Never through the bank, whatever the steering did.
      if (pondField(f.x, f.z) > 0.82) {
        const k = 0.82 / pondField(f.x, f.z);
        f.x = POND.x + (f.x - POND.x) * k;
        f.z = POND.z + (f.z - POND.z) * k;
      }

      // Depth: a level of its own, kept clear of the bed; down by the bottom
      // under ice; and, every so often in open water, up to the surface.
      f.riseIn -= dt;
      if (!f.rising && f.riseIn <= 0 && frozen === 0) {
        f.rising = true;
        f.riseIn = 18 + r() * 40;
      }
      if (r() < dt * 0.05) f.goal = 0.1 + r() * 0.2;
      const floor = Math.max(0.06, bed - 0.08);
      let target = Math.min(f.goal, floor);
      if (frozen > 0) target = target + (floor - target) * frozen;
      if (f.rising) {
        target = 0.015;
        if (f.depth < 0.035) {
          f.rising = false;
          f.ring = 0;
          // Where its mouth is, which is where the ring starts.
          f.ringX = f.x + Math.sin(f.heading) * f.length * 0.45;
          f.ringZ = f.z + Math.cos(f.heading) * f.length * 0.45;
        }
      }
      f.depth = ease(f.depth, target, f.rising ? 0.5 : 2.5, dt);
      if (f.ring >= 0) {
        f.ring += dt;
        if (f.ring > 2.4) f.ring = -1;
      }

      // The tail beats faster the harder it swims.
      f.beat += dt * (3.2 + f.speed * 22);

      this.pose[i].set(f.x, f.z, Math.sin(f.heading), Math.cos(f.heading));
      this.look[i].set(f.depth, f.length, f.beat, 0);
      this.rings[i].set(f.ringX, f.ringZ, f.ring, 0);
    }
  }
}
