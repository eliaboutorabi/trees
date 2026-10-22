/**
 * Fireflies, for the night.
 *
 * A hundred and some small lights low over the meadow, each drifting on its
 * own slow loop and blinking at its own pace: a long dark, a soft swell of
 * green-gold, dark again. They are one instanced sprite, entirely animated on
 * the GPU from `time` and a per-firefly phase, so they cost nothing on the
 * CPU, and they are only drawn at all while it is (at least partly) night.
 */
import { AdditiveBlending, InstancedBufferAttribute, Sprite } from 'three';
import { SpriteNodeMaterial } from 'three/webgpu';
import { cos, float, fract, instancedBufferAttribute, mix, sin, smoothstep, time, uv, vec3 } from 'three/tsl';
import { mulberry32 } from '../lib/rng';
import type { TreeUniforms } from '../engine/materials/shared';

export function createFireflies(u: TreeUniforms, count = 140, seed = 4207): Sprite {
  const rng = mulberry32(seed);
  // x, y, z and a phase in 0–1, per firefly.
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    // Thicker near the tree, where the grass is long, and thinning outward.
    const r = 1.6 + Math.pow(rng(), 1.6) * 15;
    const a = rng() * Math.PI * 2;
    data[i * 4] = Math.cos(a) * r;
    data[i * 4 + 1] = 0.3 + Math.pow(rng(), 1.8) * 2.4;
    data[i * 4 + 2] = Math.sin(a) * r;
    data[i * 4 + 3] = rng();
  }
  const fly = instancedBufferAttribute<'vec4'>(new InstancedBufferAttribute(data, 4), 'vec4');
  const phase = fly.w;

  const material = new SpriteNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = AdditiveBlending;
  // A light, not a surface: the haze must not tint it.
  material.fog = false;

  // A slow wandering loop of its own, a little up and down as it goes.
  const t = time.mul(mix(float(0.18), float(0.32), fract(phase.mul(13.7)))).add(phase.mul(6.283));
  const wander = vec3(sin(t.mul(1.1)).mul(0.9), sin(t.mul(0.7).add(1.3)).mul(0.35), cos(t.mul(0.9)).mul(0.9));
  material.positionNode = fly.xyz.add(wander);

  // Mostly dark; a soft swell of light every few seconds, each at its own rate.
  const rate = mix(float(0.45), float(0.9), fract(phase.mul(7.31)));
  const blink = sin(time.mul(rate).add(phase.mul(40))).max(0).pow(7);
  const core = smoothstep(0.5, 0.0, uv().sub(0.5).length());
  material.colorNode = vec3(0.78, 1.0, 0.38).mul(core.pow(2.2)).mul(blink.mul(2.6).add(0.04)).mul(u.night);
  material.scaleNode = float(0.11);

  const sprite = new Sprite(material);
  sprite.count = count;
  sprite.frustumCulled = false;
  sprite.visible = false;
  return sprite;
}
