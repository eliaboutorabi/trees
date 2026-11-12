/**
 * The pond beside the tree.
 *
 * A small one, a few strides across, in a hollow of its own to the right of
 * the tree and a little behind it as the camera first finds it. Where it is
 * and how deep comes from one outline (see `pondShape.ts`); this is the
 * water, its mirror, and what lives on and around it: stones and reeds on the
 * bank (`pondShore.ts`), lilies and fallen leaves on the surface
 * (`pondSurface.ts`).
 */
import { BufferAttribute, BufferGeometry, Group, Mesh, Sphere, Vector3, type Object3D, type PerspectiveCamera, type Scene, type Texture } from 'three';
import { MeshPhysicalNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import {
  cameraPosition,
  cameraViewMatrix,
  float,
  mix,
  output,
  positionWorld,
  screenUV,
  smoothstep,
  texture,
  time,
  uniform,
  uniformArray,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { PlanarReflection } from './reflection';
import type { SkyUniforms } from './sky';
import { createPondShore } from './pondShore';
import { createPondSurface } from './pondSurface';
import { MAX_DUCKS, PondLife, type DuckSeason } from './pondLife';
import { MAX_FISH, PondFish } from './pondFish';
import { stoneTops } from './pondShore';
import { createNoiseTexture } from '../lib/noiseTexture';
import { COS, groundNode, POND, pondFieldNode, SIN, wander } from './pondShape';

// TSL nodes are proxied at runtime and their typings do not follow chains
// through swizzles; loosely typed here, as in dof.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;
import type { TreeUniforms } from '../engine/materials/shared';

/**
 * The water's mesh: a disc over the whole hollow out to a little past the
 * outline, so the real shoreline — where the bank rises through the surface —
 * always falls inside it. Polar about the centre, finer round than across.
 */
function waterGeometry(): BufferGeometry {
  const rings = 16;
  const sectors = 96;
  const reach = 1.3;
  const positions: number[] = [];
  const index: number[] = [];
  positions.push(POND.x, POND.level, POND.z);
  for (let j = 1; j <= rings; j++) {
    const t = (j / rings) * reach;
    for (let k = 0; k < sectors; k++) {
      const theta = (k / sectors) * Math.PI * 2;
      const r = t * wander(theta);
      const u = Math.cos(theta) * r * POND.rx;
      const v = Math.sin(theta) * r * POND.rz;
      positions.push(POND.x + u * COS - v * SIN, POND.level, POND.z + u * SIN + v * COS);
    }
  }
  const ring = (j: number, k: number) => 1 + (j - 1) * sectors + (k % sectors);
  for (let k = 0; k < sectors; k++) index.push(0, ring(1, k + 1), ring(1, k));
  for (let j = 1; j < rings; j++) {
    for (let k = 0; k < sectors; k++) {
      const a = ring(j, k);
      const b = ring(j, k + 1);
      const c = ring(j + 1, k);
      const d = ring(j + 1, k + 1);
      index.push(a, b, c, b, d, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  const normals = new Float32Array(positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  g.setAttribute('normal', new BufferAttribute(normals, 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

/**
 * The water. Lit like any other surface, so it takes the tree's shadow, the
 * sun's glint and the sky's reflection from the same light everything else
 * has; what makes it water is the rest:
 *
 * - Its colour is what you see *into* it: the silty bank where it is shallow,
 *   going down through green into a dark teal where it is deep — from the
 *   bed's depth at that point, worked out from the outline rather than read
 *   back from the depth buffer.
 * - It fades out over the last few centimetres of depth, so the edge is a
 *   soft, wet line along the bank rather than where a sheet cuts the ground.
 * - The surface is never quite still: two drifting layers of noise tilt its
 *   normal a little, more as the wind gets up, so reflections shiver.
 * - Over all that goes the mirror image of what stands above it — the tree,
 *   the stones on the bank, the hills, a passing bird — sampled where the
 *   ripples push it, and stronger the more glancing the view, as water is.
 */
/** The fish, as the water's shader is handed them: see `PondFish`. */
interface FishNodes {
  pose: N;
  look: N;
  rings: N;
}

/**
 * How each fish is coloured, seen from above: the red of its back, the
 * brighter orange of its flanks and fins, and how much of it is white — a
 * kohaku koi's patches, or a goldfish's none. Mostly red, as asked for.
 */
const FISH_COATS: { back: [number, number, number]; flank: [number, number, number]; white: number }[] = [
  { back: [0.8, 0.12, 0.04], flank: [1.0, 0.42, 0.12], white: 0 },
  { back: [0.66, 0.05, 0.03], flank: [0.96, 0.24, 0.08], white: 0 },
  { back: [0.8, 0.1, 0.04], flank: [1.0, 0.34, 0.1], white: 0.62 },
  { back: [0.92, 0.32, 0.05], flank: [1.0, 0.62, 0.2], white: 0 },
  { back: [0.74, 0.08, 0.04], flank: [0.98, 0.3, 0.1], white: 0 },
  { back: [0.82, 0.14, 0.05], flank: [1.0, 0.4, 0.12], white: 0.32 },
  { back: [0.86, 0.2, 0.06], flank: [1.0, 0.5, 0.16], white: 0 },
  { back: [0.72, 0.07, 0.04], flank: [0.97, 0.28, 0.1], white: 0.5 },
];

function waterMaterial(u: TreeUniforms, mirror: Texture, pond: PondUniforms, wakes: N, sky: SkyUniforms, fish: FishNodes): MeshPhysicalNodeMaterial {
  const material = new MeshPhysicalNodeMaterial();
  // The sky's reflection is worked out below, exactly; the lighting's own
  // would only wash the water's colour out, so it is kept to a glint.
  material.specularIntensity = 0.22;
  material.transparent = true;
  material.depthWrite = false;

  const noise = createNoiseTexture(256, 41017);
  const p = positionWorld;
  const field = pondFieldNode(p.xz);
  const depth = float(POND.level).sub(groundNode(field)).max(0);
  const ice = pond.ice;
  const open = ice.oneMinus();

  // Ripples: two layers of the noise at different scales, drifting different
  // ways, read as slopes. Calm water still moves a little; ice does not.
  const drift = time.mul(0.035);
  const a = texture(noise, p.xz.mul(0.55).add(vec2(drift, drift.mul(0.6))));
  const b = texture(noise, p.xz.mul(1.3).add(vec2(drift.mul(-0.7), drift.mul(0.9))));
  const ripple = u.wind.mul(0.07).add(0.035).add(u.rainfall.mul(0.05));
  let slope: N = vec2(a.g.add(b.b).sub(1), a.b.add(b.g).sub(1)).mul(ripple).mul(open);

  /*
   * Rain. Every drop that lands throws a ring: the surface is cut into cells
   * a third of a metre across, two grids of them offset from each other, and
   * in each a ring grows from a point of its own and fades as it goes, each
   * on its own clock, so the pond is pocked with rings that never fall in
   * step. A ring is a slope pointing out from its middle, which is all a
   * ripple is to the light.
   */
  const rings = (scale: number, rate: number, seed: number) => {
    const q = p.xz.mul(scale).add(seed);
    const cell = q.floor();
    const h = cell.dot(vec2(127.1, 311.7)).sin().mul(43758.5453).fract();
    const h2 = cell.dot(vec2(269.5, 183.3)).sin().mul(43758.5453).fract();
    const t = time.mul(rate).add(h).fract();
    const centre = vec2(h, h2).mul(0.6).add(0.2);
    const off = q.fract().sub(centre);
    const d = off.length();
    const ring = d.sub(t.mul(0.42)).div(0.05);
    const wave = ring.mul(ring).negate().exp().mul(t.oneMinus()).mul(ring.mul(3.1).sin());
    return off.div(d.max(0.001)).mul(wave);
  };
  const drops = rings(3.1, 0.9, 0).add(rings(2.3, 0.7, 17.3));
  slope = slope.add(drops.mul(u.rainfall).mul(0.6).mul(open));

  /*
   * Wakes. Every duck trails a V behind it — two arms opening at the angle
   * a wake does on any water, nineteen and a half degrees either side, with
   * crests running back along them — and pushes a few small rings out round
   * its breast. All of it scales with how fast the bird is going, so a duck
   * that stops to dabble leaves the water to settle.
   */
  // Crests also catch the light a little: a slope alone hardly shows on water
  // that mostly shows its own colour.
  let sheen: N = float(0);
  for (let i = 0; i < MAX_DUCKS; i++) {
    const w = wakes.element(i);
    const rel = p.xz.sub(w.xy);
    const v = vec2(w.z, w.w);
    const sp = v.length();
    const dir = v.div(sp.max(1e-4));
    const behind = rel.dot(dir).negate();
    const side = rel.x.mul(dir.y).sub(rel.y.mul(dir.x));
    const arm = side.abs().sub(behind.mul(0.354)).abs();
    const reach = behind.mul(-1.4).exp().mul(smoothstep(0, 0.06, behind));
    const crest = behind.mul(34).sub(time.mul(6)).sin().mul(arm.mul(arm).div(-0.0022).exp());
    slope = slope.add(vec2(dir.y.negate(), dir.x).mul(side.sign()).mul(crest).mul(reach).mul(sp).mul(1.6));
    sheen = sheen.add(arm.mul(arm).div(-0.0035).exp().mul(reach).mul(sp.mul(9).clamp(0, 1)).mul(behind.mul(30).sub(time.mul(5)).sin().mul(0.3).add(0.7)));
    const r = rel.length();
    const bow = r.mul(46).sub(time.mul(5)).sin().mul(r.mul(-9).exp()).mul(sp).mul(0.9);
    slope = slope.add(rel.div(r.max(0.01)).mul(bow));
  }

  /*
   * Where a fish came up to the surface, a ring spreads from its mouth: the
   * same kind of ring a raindrop throws, one at a time and slower.
   */
  for (let i = 0; i < MAX_FISH; i++) {
    const ring = fish.rings.element(i);
    const rel = p.xz.sub(ring.xy);
    const r = rel.length();
    const age = ring.z;
    const front = r.sub(age.mul(0.3)).div(0.03);
    const fade = age.div(2.4).oneMinus().clamp(0, 1).mul(smoothstep(-0.01, 0.0, age));
    const wave = front.mul(front).negate().exp().mul(front.mul(2.6).sin()).mul(fade);
    slope = slope.add(rel.div(r.max(0.01)).mul(wave).mul(0.45).mul(open));
  }

  const normal = vec3(slope.x, 1, slope.y).normalize();
  material.normalNode = cameraViewMatrix.mul(vec4(normal, 0)).xyz.normalize();

  // A clear, saturated teal: green in the shallows, deepening to blue.
  const shallow = vec3(0.2, 0.44, 0.3);
  const mid = vec3(0.05, 0.44, 0.45);
  const deep = vec3(0.02, 0.29, 0.37);
  // Under a closed sky the colour goes out of it: a dark slate teal, with the
  // silt rain stirs up.
  const clearWater = mix(mix(shallow, mid, smoothstep(0.0, 0.14, depth)), deep, smoothstep(0.12, 0.5, depth));
  const slate = vec3(clearWater.y.mul(0.42), clearWater.y.mul(0.72), clearWater.y.mul(0.78));
  const bare = mix(clearWater, slate, sky.overcast).mul(mix(float(1), float(0.5), sky.overcast)).mul(u.rainfall.mul(0.25).oneMinus());

  /*
   * The fish. Each is drawn where you would see it *through* the surface:
   * the view ray bends as it enters the water (by Snell's law, through the
   * rippled surface, so the fish shimmer as the ripples pass over them), and
   * carries on down to the fish's depth — which is why a fish slides against
   * the surface as you walk round the pond, as a real one does. The deeper it
   * swims the more water there is in front of it, so the more it takes the
   * water's own colour. Below each, on the bed, lies its shadow, cast along
   * the sun's ray bent the same way, soft with the distance down to it.
   */
  const eye = cameraPosition.sub(p).normalize();
  const cosEye = normal.dot(eye).clamp(0, 1);
  const eta = 1 / 1.33;
  const bendEye = float(1).sub(cosEye.mul(cosEye).oneMinus().mul(eta * eta)).max(0).sqrt();
  const into = eye.negate().mul(eta).add(normal.mul(cosEye.mul(eta).sub(bendEye)));
  // How far sideways the ray goes for each metre it goes down.
  const reach = into.xz.div(into.y.negate().max(0.25));
  const sunUp = sky.sunDir.y.max(0.08);
  const bendSun = float(1).sub(sunUp.mul(sunUp).oneMinus().mul(eta * eta)).sqrt();
  const sunInto = sky.sunDir.negate().mul(eta).add(vec3(0, 1, 0).mul(sunUp.mul(eta).sub(bendSun)));
  const sunReach = sunInto.xz.div(sunInto.y.negate().max(0.2));
  const bed = p.xz.add(reach.mul(depth));

  let fishColour: N = vec3(0, 0, 0);
  let fishCover: N = float(0);
  let fishShade: N = float(0);
  for (let i = 0; i < MAX_FISH; i++) {
    const coat = FISH_COATS[i % FISH_COATS.length];
    const pose = fish.pose.element(i);
    const look = fish.look.element(i);
    const deep = look.x;
    const len = look.y.max(0.01);
    const fwd = vec2(pose.z, pose.w);

    // Into the fish's own frame: `s` runs 0 at the tail's tip to 1 at the nose.
    const rel = p.xz.add(reach.mul(deep)).sub(pose.xy);
    const along = rel.dot(fwd);
    const side = rel.x.mul(fwd.y).sub(rel.y.mul(fwd.x));
    const s = along.div(len).add(0.5);
    // It swims by sending a wave down its body, growing toward the tail.
    const tailward = s.oneMinus().clamp(0, 1);
    const sway = look.z.sub(s.mul(5)).sin().mul(len.mul(0.075)).mul(tailward.mul(tailward));
    const lat = side.sub(sway).abs();

    // A round head, a full body broadest behind it, tapering to a slim
    // wrist where the tail joins.
    const b = s.sub(0.25).div(0.75).clamp(0, 1);
    const head = b.sub(0.55).div(0.45).clamp(0, 1);
    const front = head.mul(head).oneMinus().sqrt();
    const back = b.div(0.55).clamp(0, 1).mul(Math.PI / 2).sin().mul(0.74).add(0.26);
    const halfW = len.mul(0.15).mul(mix(back, front, smoothstep(0.54, 0.56, b))).max(1e-4);
    const inBody = smoothstep(0.24, 0.27, s).mul(smoothstep(1.0, 0.985, s));
    const body = smoothstep(halfW, halfW.mul(0.7), lat).mul(inBody);
    // A forked tail fin behind it, wide and thin, lighter than the body.
    const t = s.div(0.28).clamp(0, 1);
    const tailW = len.mul(0.15).mul(t.oneMinus().pow(0.9)).add(len.mul(0.014));
    const fork = t.div(0.55).oneMinus().clamp(0, 1);
    const notch = smoothstep(tailW.mul(fork).mul(0.5), tailW.mul(fork).mul(0.3), lat).mul(smoothstep(0, 0.02, fork));
    const inTail = smoothstep(-0.01, 0.01, s).mul(smoothstep(0.3, 0.26, s));
    const tail = smoothstep(tailW, tailW.mul(0.75), lat).mul(inTail).mul(notch.oneMinus());

    // Darker red down the back, brighter on the flanks, a touch paler at the
    // head; white patches on the koi.
    const flank = lat.div(halfW).clamp(0, 1);
    let colour: N = mix(vec3(...coat.back).mul(0.82), vec3(...coat.flank), flank.pow(1.6));
    colour = mix(colour, vec3(...coat.flank), smoothstep(0.82, 1.0, s).mul(0.35));
    if (coat.white > 0) {
      const blot = s.mul(7.5).add(i * 2.3).sin().mul(side.div(len).mul(14).add(i * 1.7).sin().mul(0.6).add(0.4)).add(s.mul(3.4).add(i).sin().mul(0.45));
      colour = mix(colour, vec3(0.95, 0.93, 0.87), smoothstep(0.55 - coat.white, 0.75 - coat.white, blot).mul(body));
    }
    colour = mix(colour, vec3(...coat.flank).mul(1.05), tail.mul(body.oneMinus()));
    // Pectoral fins, a little pair just behind the head, as clear as the tail.
    const finS = s.sub(0.68).div(0.07);
    const finL = lat.sub(len.mul(0.165)).div(len.mul(0.045));
    const fins = smoothstep(1.0, 0.6, finS.mul(finS).add(finL.mul(finL)));
    colour = mix(colour, vec3(...coat.flank).mul(1.05), fins.mul(body.oneMinus()));
    const cover = body.max(tail.mul(0.62)).max(fins.mul(0.5));
    // The water between it and the eye.
    const clearness = deep.mul(-3.4).exp();
    const a = cover.mul(clearness);
    fishColour = fishColour.add(colour.mul(a).mul(fishCover.oneMinus()));
    fishCover = fishCover.add(a.mul(fishCover.oneMinus()));

    // Its shadow on the bed: what of the fish the sun's ray from here passes.
    const toFish = depth.sub(deep).max(0);
    const sh = bed.sub(sunReach.mul(toFish)).sub(pose.xy);
    const sa = sh.dot(fwd).div(len.mul(0.46));
    const ss2 = sh.x.mul(fwd.y).sub(sh.y.mul(fwd.x)).div(len.mul(0.12).add(toFish.mul(0.05)));
    const blob = sa.mul(sa).add(ss2.mul(ss2));
    fishShade = fishShade.max(smoothstep(1.3, 0.4, blob).mul(toFish.mul(-1.6).exp()));
  }
  // Silt stirred up by rain hides them, and so does a dull sky's glare.
  const seen = u.rainfall.mul(0.6).oneMinus().mul(sky.overcast.mul(0.25).oneMinus()).mul(open);
  const sunlit = sky.overcast.oneMinus().mul(sky.night.oneMinus()).mul(smoothstep(0.02, 0.15, sky.sunDir.y));
  const water = bare
    .mul(fishCover.mul(seen).oneMinus())
    .add(fishColour.mul(seen))
    .mul(fishShade.mul(sunlit).mul(0.28).oneMinus());

  /*
   * Ice. It forms from the bank inward, so it is white and frosted round the
   * rim and clearer toward the middle, where it is dark with the water under
   * it; a few long cracks run through it; and snow drifts onto it in patches,
   * thickest by the shore.
   */
  const grain = texture(noise, p.xz.mul(0.9).add(0.31));
  // A jagged, crunchy front between the frosted rim and the clear middle.
  const fine = texture(noise, p.xz.mul(3.1).add(0.13));
  const frost = smoothstep(0.68, 0.8, field.add(grain.r.sub(0.5).mul(0.3)).add(fine.g.sub(0.5).mul(0.14)));
  const crackField = texture(noise, p.xz.mul(0.32).add(0.77)).g;
  const crack = smoothstep(0.012, 0.0, crackField.sub(0.5).abs()).mul(frost.oneMinus().mul(0.6).add(0.4));
  // Under clear ice the fish still show, dimly, idling near the bottom.
  const underIce = fishCover.mul(frost.oneMinus()).mul(0.55);
  const clear = vec3(0.16, 0.24, 0.28).mul(underIce.oneMinus()).add(fishColour.mul(frost.oneMinus()).mul(0.55));
  const rime = vec3(0.86, 0.9, 0.94).mul(fine.b.mul(0.22).add(0.86));
  const iceColour = mix(clear, rime, frost).add(crack.mul(0.18));
  // Snow lies on the frost by the shore and leaves the clear ice to the sky.
  const drifts = smoothstep(0.55, 0.85, grain.g.mul(0.5).add(frost.mul(0.62))).mul(u.snow);
  const iceTop = mix(iceColour, u.snowColor, drifts);
  material.colorNode = mix(water, iceTop, ice);

  // Smooth water; ice glossy where it is clear and matte where it is frosted.
  const waterRough = float(0.05).add(u.wind.mul(0.04)).add(u.rainfall.mul(0.08));
  const iceRough = mix(float(0.12), float(0.7), frost.max(drifts));
  material.roughnessNode = mix(waterRough, iceRough, ice);
  material.metalnessNode = float(0);
  material.opacityNode = smoothstep(0.0, 0.045, depth);

  /*
   * The reflection. What stands above the water comes from the mirror,
   * flipped left to right (see `PlanarReflection`) and nudged by the ripples;
   * everywhere else the water reflects the sky itself — the same shader,
   * asked about the reflected ray, so sunset, cloud and stars all land in it.
   * Sky is laid on lightly, so the water keeps its colour until the view is
   * glancing; what stands over it reads clearly at any angle. Ice reflects
   * strongly where it is clear, and not at all where frost or snow lie on it.
   */
  const reflected = texture(mirror, vec2(screenUV.x.oneMinus(), screenUV.y).add(slope.mul(0.32)));
  const view = cameraPosition.sub(p).normalize();
  const cosine = normal.dot(view).clamp(0, 1);
  const glance = cosine.oneMinus();
  const ray = view.negate().add(normal.mul(cosine.mul(2)));
  // The sky along that ray: its gradient, the sun's glow, the cloud's grey and
  // the night, from the sky's own colours. Not the sky's whole shader, whose
  // fractal noise made this one take a minute to compile on a first visit, for
  // detail no ripple would ever show.
  const rise = ray.y.abs().clamp(0, 1).pow(float(0.42).add(sky.haze.mul(0.3)));
  const toSun = ray.dot(sky.sunDir).clamp(0, 1);
  const clearSky = mix(sky.horizon, sky.zenith, rise).add(sky.sunTint.mul(toSun.pow(16).mul(0.5).add(toSun.pow(4).mul(0.11))));
  const closedSky = mix(clearSky, mix(sky.cloudLow, sky.cloudHigh, rise), sky.overcast);
  const skyLight = mix(closedSky, vec3(0.018, 0.028, 0.06), sky.night).mul(sky.intensity) as N;
  // Frozen, the image of what stands over it is only a faint darkening.
  const image = mix(skyLight, reflected.rgb, reflected.a.mul(mix(float(1), float(0.22), ice)));
  const onSky = mix(float(0.05), float(0.45), glance.mul(glance).mul(glance).mul(glance));
  const onThings = mix(float(0.55), float(0.92), glance.mul(glance));
  const openMirror = mix(onSky, onThings, reflected.a);
  const iceMirror = frost.max(drifts).oneMinus().mul(0.88);
  const surfaceLight = sheen.mul(0.55).add(drops.length().mul(u.rainfall).mul(1.1)).mul(open).clamp(0, 0.7);
  material.outputNode = vec4(mix(mix(output.rgb, image, mix(openMirror, iceMirror, ice)), skyLight.mul(1.15), surfaceLight), output.a);

  return material;
}

/** What the season says about the pond, eased by the studio. */
function pondUniforms() {
  return {
    /** Frozen over, 0–1. */
    ice: uniform(0),
    /** How many lily pads are out, 0–1. */
    pads: uniform(1),
    /** How many of them are in flower, 0–1. */
    flowers: uniform(1),
    /** Seconds of open water: the clock what floats on the pond drifts by, stopped while it is frozen. */
    flow: uniform(0),
  };
}
export type PondUniforms = ReturnType<typeof pondUniforms>;

export interface Pond {
  /** Add to the scene: the water, and the stones and reeds round it. */
  group: Group;
  water: Mesh;
  uniforms: PondUniforms;
  /** The creatures: who is about this season, and where the pointer is on the water, if it is. */
  update(dt: number, season: DuckSeason, lure: Vector3 | null): void;
  /** How many ducklings the hen has, in their season, and how big the ducks are. */
  setDucks(ducklings: number, size: number): void;
  /** Leave these out of the water's reflection: too small to read in it, or not standing in the world. */
  hideFromReflection(...objects: Object3D[]): void;
  /** Draw the reflection for this frame's view, before the frame itself. */
  reflect(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera): void;
  dispose(): void;
}

export function createPond(u: TreeUniforms, sky: SkyUniforms): Pond {
  const geometry = waterGeometry();
  const bounds = new Sphere(new Vector3(POND.x, POND.level, POND.z), POND.rx * 1.5);
  const mirror = new PlanarReflection(POND.level, bounds);
  const uniforms = pondUniforms();
  const life = new PondLife();
  const wakes = uniformArray(life.wakes, 'vec4');
  const fish = new PondFish();
  const fishNodes: FishNodes = {
    pose: uniformArray(fish.pose, 'vec4'),
    look: uniformArray(fish.look, 'vec4'),
    rings: uniformArray(fish.rings, 'vec4'),
  };
  const material = waterMaterial(u, mirror.texture, uniforms, wakes, sky, fishNodes);
  const perches = stoneTops();
  const water = new Mesh(geometry, material);
  // The water is not in its own reflection.
  mirror.hidden.push(water);
  const shore = createPondShore(u);
  const surface = createPondSurface(u, uniforms);
  // Lying flat on the water, they have no reflection worth drawing.
  mirror.hidden.push(surface.lilies, surface.leaves);
  const group = new Group();
  group.add(shore.stones, shore.reeds, shore.mushrooms, surface.lilies, surface.leaves, life.group, water);
  mirror.hidden.push(shore.mushrooms);
  water.receiveShadow = true;
  water.castShadow = false;
  // After the ground and everything standing in the water, so its soft edge
  // resolves against the bank under it.
  water.renderOrder = 1;
  return {
    group,
    water,
    uniforms,
    setDucks(ducklings, size) {
      life.setDucks(ducklings, size);
    },
    update(dt, season, lure) {
      life.update(dt, season, uniforms.ice.value, perches);
      fish.update(dt, uniforms.ice.value, life.wakes, lure);
      // The arrays are not watched for changes; they are pushed each frame,
      // once the water's shader has been built and they have storage.
      for (const array of [wakes, fishNodes.pose, fishNodes.look, fishNodes.rings]) {
        const node = array as unknown as { value: unknown; update(): void };
        if (node.value !== null) node.update();
      }
    },
    hideFromReflection(...objects: Object3D[]) {
      for (const o of objects) if (!mirror.hidden.includes(o)) mirror.hidden.push(o);
    },
    reflect(renderer, scene, camera) {
      mirror.render(renderer, scene, camera);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mirror.dispose();
      shore.dispose();
      surface.dispose();
      life.dispose();
    },
  };
}

