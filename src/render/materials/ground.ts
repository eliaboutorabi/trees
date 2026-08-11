/** Dry-grass ground plane that dissolves into haze at the horizon. */
import { Color } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { float, mix, mx_fractal_noise_float, positionWorld, smoothstep, uniform, vec3 } from 'three/tsl';

export type GroundUniforms = ReturnType<typeof createGroundMaterial>['uniforms'];

export function createGroundMaterial() {
  const uniforms = {
    near: uniform(new Color(0x7d7040)),
    far: uniform(new Color(0xa8965e)),
    horizon: uniform(new Color(0xd8b183)),
    /** Radius over which the ground fades into the horizon haze. */
    fadeStart: uniform(14),
    fadeEnd: uniform(58),
  };

  const material = new MeshStandardNodeMaterial();

  const p = positionWorld;
  const dist = p.xz.length();

  const broad = mx_fractal_noise_float(vec3(p.x.mul(0.16), 0, p.z.mul(0.16)), 4, 2.0, 0.55, 1.0).mul(0.5).add(0.5);
  const fine = mx_fractal_noise_float(vec3(p.x.mul(1.6), 0, p.z.mul(1.6)), 3, 2.0, 0.5, 1.0).mul(0.5).add(0.5);

  const grass = mix(uniforms.near, uniforms.far, broad.mul(0.75).add(fine.mul(0.25)));

  // A soft pool of darkening where the trunk meets the ground — cheap contact
  // shading that survives even when the shadow map softens out.
  const contact = smoothstep(2.6, 0.0, dist).mul(0.35);
  const shaded = grass.mul(float(1).sub(contact));

  material.colorNode = mix(shaded, uniforms.horizon, smoothstep(uniforms.fadeStart, uniforms.fadeEnd, dist));
  material.roughnessNode = float(0.96).sub(fine.mul(0.08));
  material.metalnessNode = float(0);

  return { material, uniforms };
}
