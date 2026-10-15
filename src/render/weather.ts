/**
 * Falling snow.
 *
 * One merged mesh of camera-facing quads, animated entirely on the GPU: every
 * flake's whole life is a function of `time` and four baked constants, so the
 * CPU never touches it after it is built and a blizzard costs the same as a
 * clear sky.
 *
 * Flakes cycle through a fixed box around the tree rather than being respawned.
 * The cycle is one `fract`, and the horizontal drift is driven off that *same*
 * fraction — so when a flake reaches the bottom and wraps back to the top, it
 * returns to its starting column in the same instant. Driving the drift off
 * `time` directly is the obvious version and it is wrong: flakes walk steadily
 * downwind, the upwind side of the box empties out, and the whole snowfall
 * slides off the scene over a minute or two.
 */
import { BufferAttribute, BufferGeometry, Mesh } from 'three';
import { DoubleSide } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  float,
  mix,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  step,
  time,
  uv,
  vec3,
} from 'three/tsl';
import { mulberry32 } from '../lib/rng';
import type { TreeUniforms } from '../engine/materials/shared';

export interface SnowfallOptions {
  count: number;
  /** Half-width of the column the flakes cycle through. */
  radius: number;
  /** How far they fall before wrapping back to the top. */
  height: number;
  seed: number;
}

const DEFAULTS: SnowfallOptions = {
  count: 5200,
  radius: 34,
  height: 26,
  seed: 20261006,
};

/**
 * `aFlake` is (x, z, phase, size): where the flake's column stands, where in
 * its cycle it starts, and how big it is. Speed is derived from size — a bigger
 * flake falls faster — which is one fewer channel to carry and is also true.
 */
function snowGeometry(o: SnowfallOptions): BufferGeometry {
  const rng = mulberry32(o.seed);

  const position = new Float32Array(o.count * 4 * 3);
  const uvs = new Float32Array(o.count * 4 * 2);
  const flake = new Float32Array(o.count * 4 * 4);
  const index = new Uint32Array(o.count * 6);

  // The corners, in the quad's own plane. The shader turns these into world
  // offsets along the camera's right and up.
  const corners = [-1, -1, 1, -1, 1, 1, -1, 1];

  for (let i = 0; i < o.count; i++) {
    // Square root of a uniform draw, so the flakes spread evenly over the disc
    // instead of crowding the middle.
    const r = Math.sqrt(rng()) * o.radius;
    const a = rng() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const phase = rng();
    const size = 0.03 + rng() * rng() * 0.075;

    for (let c = 0; c < 4; c++) {
      const v = i * 4 + c;
      position[v * 3] = corners[c * 2];
      position[v * 3 + 1] = corners[c * 2 + 1];
      position[v * 3 + 2] = 0;
      uvs[v * 2] = corners[c * 2] * 0.5 + 0.5;
      uvs[v * 2 + 1] = corners[c * 2 + 1] * 0.5 + 0.5;
      flake[v * 4] = x;
      flake[v * 4 + 1] = z;
      flake[v * 4 + 2] = phase;
      flake[v * 4 + 3] = size;
    }

    const b = i * 4;
    index.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(position, 3));
  // The corner again, as a uv. The fragment stage cannot read it off
  // `positionLocal`: assigning `positionNode` *replaces* `positionLocal` for
  // everything downstream, so by the time the shape mask is evaluated that node
  // holds the flake's position out in the world, not its corner. Reading it
  // there gave every flake an opacity of zero — the quads were the right size
  // in the right places, and completely invisible, except for the handful that
  // happened to drift within a unit of the origin.
  g.setAttribute('uv', new BufferAttribute(uvs, 2));
  g.setAttribute('aFlake', new BufferAttribute(flake, 4));
  g.setIndex(new BufferAttribute(index, 1));
  // Every vertex is relocated in the shader, so the baked bounds mean nothing.
  g.boundingSphere = null;
  return g;
}

function snowMaterial(u: TreeUniforms, o: SnowfallOptions): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  // Flakes are unlit, unsorted and everywhere. Writing depth would make each
  // one occlude the ones behind it in whatever order they happen to be drawn,
  // which punches flake-shaped holes in the snowfall.
  material.depthWrite = false;

  const f = attribute<'vec4'>('aFlake', 'vec4');
  // Safe in the vertex stage, where `positionLocal` is still the attribute.
  const corner = positionLocal.xy;
  // What the fragment stage uses instead; see the note on the uv attribute.
  const shape = uv().sub(0.5).mul(2);
  const size = f.w;

  // One cycle: 0 at the top of the column, 1 at the bottom.
  // Snow, not rain: between half and a bit over one metre a second, and the
  // bigger flakes lead.
  const speed = size.mul(6.0).add(0.5);
  const cycle = time.mul(speed).div(o.height).add(f.z).fract();
  const y = float(o.height).mul(cycle.oneMinus()).sub(1.5);

  // Drift and wobble, both off `cycle` so they reset with it. A flake slides
  // downwind as it falls and skids from side to side on the way.
  const wind = vec3(u.windDir.x, 0, u.windDir.y).normalize();
  const across = vec3(wind.z, 0, wind.x.negate());
  const drift = wind.mul(u.wind.mul(10.0).add(1.5)).mul(cycle);
  const wobble = across.mul(sin(cycle.mul(Math.PI * 7).add(f.z.mul(40.0))).mul(0.55));

  const centre = vec3(f.x, y, f.y).add(drift).add(wobble);

  /*
   * Billboard, built from a basis rather than from the camera matrix's columns.
   *
   * The flake is a disc: it has no orientation of its own to preserve, so the
   * only requirement is that the quad faces the camera and stays the same size
   * on screen. `right` is horizontal by construction, which also keeps the
   * snowfall from rolling when the camera does.
   */
  const fwd = cameraPosition.sub(centre).normalize();
  const right = vec3(fwd.z, 0, fwd.x.negate()).normalize();
  const up = fwd.cross(right);

  // Intensity is how many flakes, not how big: each flake has its own
  // threshold, and one below it collapses to nothing — which the hardware drops
  // before rasterising, so a light snowfall is cheaper than a heavy one.
  const falling = step(f.z.mul(7.31).fract(), u.snowfall).mul(step(0.001, u.snowfall));
  const span = size.mul(falling);
  material.positionNode = centre.add(right.mul(corner.x.mul(span))).add(up.mul(corner.y.mul(span)));

  material.colorNode = u.snowColor;

  // A round, soft flake, faded out well before the near plane and again at the
  // far edge of the column so the boundary of the box is never a visible wall
  // of snow. The near fade has to start further out than feels necessary: the
  // depth of field turns a flake a metre from the lens into a soft disc the
  // size of a fist, and a dozen of those is a smeared lens, not weather.
  const dot = smoothstep(1.0, 0.15, shape.length());
  const dist = cameraPosition.sub(positionWorld).length();
  material.opacityNode = dot
    .mul(smoothstep(2.5, 6.5, dist))
    .mul(smoothstep(o.radius * 1.15, o.radius * 0.6, dist))
    .mul(0.95);

  return material;
}

/** A column of falling snow around the origin. Add it to the scene once. */
export function createSnowfall(u: TreeUniforms, options: Partial<SnowfallOptions> = {}): Mesh {
  const o = { ...DEFAULTS, ...options };
  const mesh = new Mesh(snowGeometry(o), snowMaterial(u, o));
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // After the scene, before nothing: it is transparent and must not be sorted
  // against the foliage it drifts through.
  mesh.renderOrder = 4;
  return mesh;
}

// --------------------------------------------------------------------- rain

export interface RainfallOptions {
  count: number;
  /** Half-width of the column the drops fall through. */
  radius: number;
  /** Where they start, above the ground. */
  height: number;
  seed: number;
}

const RAIN_DEFAULTS: RainfallOptions = {
  count: 9000,
  radius: 30,
  height: 22,
  seed: 20261014,
};

/** How long a splash lasts, in seconds. */
const SPLASH = 0.22;

/**
 * `aDrop` is (x, z, phase, length): the column, where in its cycle it starts,
 * and how long its streak is. Speed follows length — the long streaks are the
 * fast, heavy drops — which is one channel fewer and is also what the eye
 * expects, since a streak *is* the distance a drop covered while the shutter
 * was open.
 */
function rainGeometry(o: RainfallOptions): BufferGeometry {
  const rng = mulberry32(o.seed);
  const position = new Float32Array(o.count * 12);
  const uvs = new Float32Array(o.count * 8);
  const drop = new Float32Array(o.count * 16);
  const index = new Uint32Array(o.count * 6);
  const corners = [-1, -1, 1, -1, 1, 1, -1, 1];

  for (let i = 0; i < o.count; i++) {
    const r = Math.sqrt(rng()) * o.radius;
    const a = rng() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const phase = rng();
    const length = 0.32 + rng() * 0.4;
    for (let c = 0; c < 4; c++) {
      const v = i * 4 + c;
      position[v * 3] = corners[c * 2];
      position[v * 3 + 1] = corners[c * 2 + 1];
      uvs[v * 2] = corners[c * 2] * 0.5 + 0.5;
      uvs[v * 2 + 1] = corners[c * 2 + 1] * 0.5 + 0.5;
      drop.set([x, z, phase, length], v * 4);
    }
    const b = i * 4;
    index.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(position, 3));
  // Same reason as the snow: the fragment stage cannot read the corner off
  // `positionLocal` once `positionNode` has replaced it.
  g.setAttribute('uv', new BufferAttribute(uvs, 2));
  g.setAttribute('aDrop', new BufferAttribute(drop, 4));
  g.setIndex(new BufferAttribute(index, 1));
  g.boundingSphere = null;
  return g;
}

function rainMaterial(u: TreeUniforms, o: RainfallOptions): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.side = DoubleSide;

  const d = attribute<'vec4'>('aDrop', 'vec4');
  const corner = positionLocal.xy;
  const st = uv();
  const length = d.w;

  /*
   * One cycle is a fall and then a splash. The fall is a straight line at
   * terminal velocity — a raindrop reaches it within a couple of metres — down
   * and downwind, and the splash is a ring spreading where it hit. Both run off
   * one `fract`, so a drop that has splashed is already at the top of its next
   * fall, and the column never thins out or drifts away.
   */
  const speed = length.sub(0.32).mul(6).add(7.2);
  const fallTime = float(o.height).div(speed);
  const period = fallTime.add(SPLASH);
  const clock = time.div(period).add(d.z).fract().mul(period);
  const splashing = step(fallTime, clock);
  const flight = clock.min(fallTime);

  const wind = vec3(u.windDir.x, 0, u.windDir.y).normalize();
  const sideways = wind.mul(u.wind.mul(6.5).add(0.4));
  // Started upwind by half the drift, so the column lands where it was placed
  // rather than all of it ending up downwind of the tree.
  const start = vec3(d.x, o.height, d.y).sub(sideways.mul(fallTime.mul(0.5)));
  const velocity = sideways.sub(vec3(0, speed, 0));
  const centre = start.add(velocity.mul(flight));

  // The streak: a thin quad along the velocity, turned about it to face the
  // camera. Never thinner than about a pixel, or distant rain aliases into a
  // shimmer; the opacity below gives back what the extra width adds.
  const dist = cameraPosition.sub(centre).length();
  const axis = velocity.normalize();
  const side = axis.cross(cameraPosition.sub(centre)).normalize();
  const width = dist.mul(0.0011).max(0.006);
  const streak = centre
    .add(axis.mul(corner.y.mul(length).mul(0.5)))
    .add(side.mul(corner.x.mul(width)));

  // The splash: a flat ring on the ground, opening outward.
  const spread = clock.sub(fallTime).div(SPLASH).clamp(0, 1);
  const ring = spread.mul(0.13).add(0.03);
  const landed = vec3(centre.x, 0.025, centre.z);
  const splash = landed.add(vec3(corner.x.mul(ring), 0, corner.y.mul(ring)));

  // Intensity thins the drops by threshold, like the snow. A drop that is not
  // falling collapses to a point, which is dropped before rasterising.
  const raining = step(d.z.mul(7.31).fract(), u.rainfall).mul(step(0.001, u.rainfall));
  material.positionNode = mix(streak, splash, splashing).mul(raining);

  material.colorNode = u.rainColor;

  // Streak: soft across its width, tapered at both ends. Splash: a thin ring
  // that fades as it opens. Faded close to the lens and at the column's edge.
  const across = st.x.sub(0.5).abs().mul(2).oneMinus();
  const taper = smoothstep(0, 0.4, st.y).mul(smoothstep(1, 0.6, st.y));
  const radial = st.sub(0.5).mul(2).length();
  const ringMask = smoothstep(0.5, 0.78, radial).mul(smoothstep(1.0, 0.82, radial)).mul(spread.oneMinus());
  const thinning = float(0.006).div(width);
  const shape = mix(across.mul(taper).mul(thinning).mul(0.42), ringMask.mul(0.55), splashing);
  const seen = cameraPosition.sub(positionWorld).length();
  material.opacityNode = shape
    .mul(smoothstep(1.8, 4.5, seen))
    .mul(smoothstep(o.radius * 1.1, o.radius * 0.55, seen));

  return material;
}

/** Rain, falling through a column around the origin. Add it to the scene once. */
export function createRainfall(u: TreeUniforms, options: Partial<RainfallOptions> = {}): Mesh {
  const o = { ...RAIN_DEFAULTS, ...options };
  const mesh = new Mesh(rainGeometry(o), rainMaterial(u, o));
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 4;
  return mesh;
}
