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
import { skyNode, type SkyUniforms } from './sky';
import { createPondShore } from './pondShore';
import { createPondSurface } from './pondSurface';
import { MAX_DUCKS, PondLife, type DuckSeason } from './pondLife';
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
function waterMaterial(u: TreeUniforms, mirror: Texture, pond: PondUniforms, wakes: N, sky: SkyUniforms): MeshPhysicalNodeMaterial {
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
  slope = slope.add(rings(3.1, 0.9, 0).add(rings(2.3, 0.7, 17.3)).mul(u.rainfall).mul(0.6).mul(open));

  /*
   * Wakes. Every duck trails a V behind it — two arms opening at the angle
   * a wake does on any water, nineteen and a half degrees either side, with
   * crests running back along them — and pushes a few small rings out round
   * its breast. All of it scales with how fast the bird is going, so a duck
   * that stops to dabble leaves the water to settle.
   */
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
    const r = rel.length();
    const bow = r.mul(46).sub(time.mul(5)).sin().mul(r.mul(-9).exp()).mul(sp).mul(0.9);
    slope = slope.add(rel.div(r.max(0.01)).mul(bow));
  }

  const normal = vec3(slope.x, 1, slope.y).normalize();
  material.normalNode = cameraViewMatrix.mul(vec4(normal, 0)).xyz.normalize();

  // A clear, saturated teal: green in the shallows, deepening to blue.
  const shallow = vec3(0.2, 0.44, 0.3);
  const mid = vec3(0.05, 0.44, 0.45);
  const deep = vec3(0.02, 0.29, 0.37);
  // Rain stirs up the silt and darkens the water a little.
  const water = mix(mix(shallow, mid, smoothstep(0.0, 0.14, depth)), deep, smoothstep(0.12, 0.5, depth)).mul(
    u.rainfall.mul(0.18).oneMinus(),
  );

  /*
   * Ice. It forms from the bank inward, so it is white and frosted round the
   * rim and clearer toward the middle, where it is dark with the water under
   * it; a few long cracks run through it; and snow drifts onto it in patches,
   * thickest by the shore.
   */
  const grain = texture(noise, p.xz.mul(0.9).add(0.31));
  const frost = smoothstep(0.55, 1.0, field.add(grain.r.sub(0.5).mul(0.35)));
  const crackField = texture(noise, p.xz.mul(0.32).add(0.77)).g;
  const crack = smoothstep(0.012, 0.0, crackField.sub(0.5).abs()).mul(frost.oneMinus().mul(0.6).add(0.4));
  const clear = vec3(0.16, 0.24, 0.28);
  const rime = vec3(0.78, 0.84, 0.88);
  const iceColour = mix(clear, rime, frost.mul(0.85)).add(crack.mul(0.18));
  const drifts = smoothstep(0.35, 0.75, grain.g.add(frost.mul(0.4))).mul(u.snow);
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
  const skyLight = skyNode(sky, vec3(ray.x, ray.y.abs(), ray.z) as never) as N;
  const image = mix(skyLight, reflected.rgb, reflected.a);
  const onSky = mix(float(0.05), float(0.45), glance.mul(glance).mul(glance).mul(glance));
  const onThings = mix(float(0.55), float(0.92), glance.mul(glance));
  const openMirror = mix(onSky, onThings, reflected.a);
  const iceMirror = frost.max(drifts).oneMinus().mul(0.88);
  material.outputNode = vec4(mix(output.rgb, image, mix(openMirror, iceMirror, ice)), output.a);

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
  /** The creatures: who is about this season. */
  update(dt: number, season: DuckSeason): void;
  /** How many ducklings the hen has, in their season, and how big the ducks are. */
  setDucks(ducklings: number, size: number): void;
  /** The tree, which the water shows even when the pond lies behind it (see below). */
  reflectTree(tree: Object3D): void;
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
  const material = waterMaterial(u, mirror.texture, uniforms, wakes, sky);
  const perches = stoneTops();
  const water = new Mesh(geometry, material);
  // The water is not in its own reflection.
  mirror.hidden.push(water);
  const shore = createPondShore(u);
  const surface = createPondSurface(u, uniforms);
  // Lying flat on the water, they have no reflection worth drawing.
  mirror.hidden.push(surface.lilies, surface.leaves);
  const group = new Group();
  group.add(shore.stones, shore.reeds, surface.lilies, surface.leaves, life.group, water);
  water.receiveShadow = true;
  water.castShadow = false;
  // After the ground and everything standing in the water, so its soft edge
  // resolves against the bank under it.
  water.renderOrder = 1;
  return {
    group,
    water,
    uniforms,
    reflectTree(tree) {
      /*
       * The tree in the water, when strict optics would leave it out. Water
       * only shows what stands beyond it, so with the pond behind the tree —
       * the view the garden opens on — a true mirror holds hills and sky and
       * no tree at all, and the pond looks disconnected from it. A tree that
       * glows in the water beside it is too good to lose, so for the mirror
       * pass alone the tree stands further off, just where its crown's image
       * lands in the pond. It slides back to where it really is as you walk
       * round to where the true reflection shows.
       */
      const crown = 5.5;
      mirror.stage = (camera) => {
        const cx = camera.position.x;
        const cz = camera.position.z;
        const toPond = Math.hypot(POND.x - cx, POND.z - cz);
        const away = (POND.x * (POND.x - cx) + POND.z * (POND.z - cz)) / (Math.hypot(POND.x, POND.z) * toPond);
        const t = Math.min(1, Math.max(0, (away - 0.1) / 0.5));
        const amount = t * t * (3 - 2 * t);
        // Aim at a point in the pond on the tree's side of its middle.
        const aimX = POND.x * 0.78;
        const aimZ = POND.z * 0.78;
        const reach = (Math.max(1, camera.position.y) + crown) / Math.max(1, camera.position.y);
        tree.position.set((cx + (aimX - cx) * reach) * amount, 0, (cz + (aimZ - cz) * reach) * amount);
        return () => tree.position.set(0, 0, 0);
      };
    },
    setDucks(ducklings, size) {
      life.setDucks(ducklings, size);
    },
    update(dt, season) {
      life.update(dt, season, uniforms.ice.value, perches);
      // The wakes' array is not watched for changes; it is pushed each frame,
      // once the water's shader has been built and the array has storage.
      const node = wakes as unknown as { value: unknown; update(): void };
      if (node.value !== null) node.update();
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

