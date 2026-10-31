/**
 * The pond beside the tree.
 *
 * A small one, a few strides across, in a hollow of its own to the right of
 * the tree and a little behind it as the camera first finds it. Everything
 * about where it is comes from one outline: an ellipse whose edge wanders in
 * and out on a few slow harmonics, so it is kidney-shaped rather than a
 * puddle-shaped circle. The same outline, as a function, carves the hollow in
 * the terrain, keeps the grass and the flowers out of the water, sends the
 * doves round it rather than through it, and tells the water how deep it is
 * at every point — so the shore, where the water thins to nothing over the
 * bank, is smooth however coarse the ground mesh is under it.
 */
import { BufferAttribute, BufferGeometry, Mesh, Sphere, Vector3, type Object3D, type PerspectiveCamera, type Scene, type Texture } from 'three';
import { MeshStandardNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import {
  atan,
  cameraPosition,
  cameraViewMatrix,
  float,
  mix,
  output,
  positionWorld,
  screenUV,
  sin,
  smoothstep,
  texture,
  time,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { PlanarReflection } from './reflection';
import { createNoiseTexture } from '../lib/noiseTexture';
import type { TreeUniforms } from '../engine/materials/shared';

// TSL nodes are proxied at runtime and their typings do not follow chains
// through swizzles; loosely typed here, as in dof.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

export const POND = {
  /**
   * Centre, in metres from the trunk: as the camera first finds the tree,
   * about four metres to its right and four behind it, so the near end of
   * the pond tucks in behind the trunk.
   */
  x: 0.55,
  z: -5.6,
  /** Its long axis runs across the first view: a bearing about +Y, radians. */
  angle: -0.6435,
  /** Half-length and half-width, before the edge wanders. */
  rx: 3.8,
  rz: 2.5,
  /** The water's surface, a hand's breadth below the meadow. */
  level: -0.06,
  /** How far the bed falls below that in the middle. */
  depth: 0.55,
};

const COS = Math.cos(POND.angle);
const SIN = Math.sin(POND.angle);

/** The edge's wander, as a multiple of the ellipse, by angle round it. */
function wander(theta: number): number {
  return 1 + 0.11 * Math.sin(2 * theta + 0.6) + 0.07 * Math.sin(3 * theta + 2.2) + 0.035 * Math.sin(5 * theta + 4.1);
}

/**
 * Where (x, z) is relative to the shore: below 1 inside the outline, 1 on it,
 * above 1 outside — a stretched distance, so 1.3 is a little way up the bank
 * wherever you are round it.
 */
export function pondField(x: number, z: number): number {
  const dx = x - POND.x;
  const dz = z - POND.z;
  const u = (dx * COS + dz * SIN) / POND.rx;
  const v = (-dx * SIN + dz * COS) / POND.rz;
  return Math.hypot(u, v) / wander(Math.atan2(v, u));
}

const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The ground's height in and around the pond, as an offset to add to the
 * meadow's: nothing past the top of the bank; a gentle slope down to just
 * under the water at the outline; and on down to the bed in the middle.
 */
export function pondGround(x: number, z: number): number {
  if (Math.abs(x - POND.x) > POND.rx * 2 || Math.abs(z - POND.z) > POND.rx * 2) return 0;
  return groundAt(pondField(x, z));
}

function groundAt(f: number): number {
  const under = POND.level - 0.02 - POND.depth * ss(1, 0.45, f);
  return under * (1 - ss(1, 1.38, f));
}

/** The same outline, in a shader: `pondField` for a world-space xz node. */
export function pondFieldNode(xz: N): N {
  const d = xz.sub(vec2(POND.x, POND.z));
  const u = d.x.mul(COS).add(d.y.mul(SIN)).div(POND.rx);
  const v = d.x.mul(-SIN).add(d.y.mul(COS)).div(POND.rz);
  const theta = atan(v, u);
  const w = sin(theta.mul(2).add(0.6))
    .mul(0.11)
    .add(sin(theta.mul(3).add(2.2)).mul(0.07))
    .add(sin(theta.mul(5).add(4.1)).mul(0.035))
    .add(1);
  return vec2(u, v).length().div(w);
}

/** The bed's height under the water, from the field: `groundAt` in a shader. */
function groundNode(f: N): N {
  const under = float(POND.level - 0.02).sub(smoothstep(1, 0.45, f).mul(POND.depth));
  return under.mul(smoothstep(1, 1.38, f).oneMinus());
}

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
function waterMaterial(u: TreeUniforms, mirror: Texture): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;

  const noise = createNoiseTexture(256, 41017);
  const p = positionWorld;
  const field = pondFieldNode(p.xz);
  const depth = float(POND.level).sub(groundNode(field)).max(0);

  // Ripples: two layers of the noise at different scales, drifting different
  // ways, read as slopes. Calm water still moves a little.
  const drift = time.mul(0.035);
  const a = texture(noise, p.xz.mul(0.55).add(vec2(drift, drift.mul(0.6))));
  const b = texture(noise, p.xz.mul(1.3).add(vec2(drift.mul(-0.7), drift.mul(0.9))));
  const ripple = u.wind.mul(0.07).add(0.035);
  const slope = vec2(a.g.add(b.b).sub(1), a.b.add(b.g).sub(1)).mul(ripple);
  const normal = vec3(slope.x, 1, slope.y).normalize();
  material.normalNode = cameraViewMatrix.mul(vec4(normal, 0)).xyz.normalize();

  const shallow = vec3(0.12, 0.115, 0.075);
  const mid = vec3(0.07, 0.13, 0.1);
  const deep = vec3(0.03, 0.105, 0.11);
  const body = mix(mix(shallow, mid, smoothstep(0.0, 0.14, depth)), deep, smoothstep(0.12, 0.5, depth));
  material.colorNode = body;
  material.roughnessNode = float(0.05).add(u.wind.mul(0.04));
  material.metalnessNode = float(0);
  material.opacityNode = smoothstep(0.0, 0.045, depth);

  // The mirror: flipped left to right (see `PlanarReflection`), nudged by the
  // ripples, and laid over the lit water where something stands above it.
  // Water reflects little looking straight down and nearly everything at a
  // glance; a pond seen from a few metres up sits between, and reads most
  // like a pond when the reflection is clear, so it is weighted toward the
  // glancing end.
  const reflected = texture(mirror, vec2(screenUV.x.oneMinus(), screenUV.y).add(slope.mul(0.32)));
  const view = cameraPosition.sub(p).normalize();
  const glance = normal.dot(view).clamp(0, 1).oneMinus();
  const strength = mix(float(0.5), float(0.92), glance.mul(glance)).mul(reflected.a);
  material.outputNode = vec4(mix(output.rgb, reflected.rgb, strength), output.a);

  return material;
}

export interface Pond {
  /** Add to the scene. */
  water: Mesh;
  /** Leave these out of the water's reflection: too small to read in it, or not standing in the world. */
  hideFromReflection(...objects: Object3D[]): void;
  /** Draw the reflection for this frame's view, before the frame itself. */
  reflect(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera): void;
  dispose(): void;
}

export function createPond(u: TreeUniforms): Pond {
  const geometry = waterGeometry();
  const bounds = new Sphere(new Vector3(POND.x, POND.level, POND.z), POND.rx * 1.5);
  const mirror = new PlanarReflection(POND.level, bounds);
  const material = waterMaterial(u, mirror.texture);
  const water = new Mesh(geometry, material);
  // The water is not in its own reflection.
  mirror.hidden.push(water);
  water.receiveShadow = true;
  water.castShadow = false;
  // After the ground and everything standing in the water, so its soft edge
  // resolves against the bank under it.
  water.renderOrder = 1;
  return {
    water,
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
    },
  };
}

