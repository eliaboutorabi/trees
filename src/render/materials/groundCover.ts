/**
 * Materials for the scattered ground cover — grass, shrubs, the distant
 * treeline.
 *
 * Two ideas do almost all of the work here, and both are borrowed from how
 * games render grass:
 *
 *   Normals point up, not out. A blade's true surface normal is nearly
 *   horizontal, and at golden hour a horizontal normal faces away from a low
 *   sun and renders black. Real grass does not read as a field of black
 *   splinters because the eye takes its shading from the *ground* it covers, so
 *   the blade normals are bent most of the way toward vertical. This is the
 *   single biggest difference between grass that looks like grass and grass
 *   that looks like scattered twigs.
 *
 *   Darkness comes from the root. Grass self-shadows: the base of a clump sits
 *   in near-total occlusion and only the tips are lit. A vertical gradient down
 *   each blade fakes the whole effect for one multiply.
 *
 * The sway shares the tree's wind uniforms, so there is one wind in the scene
 * rather than two that disagree.
 */
import { DoubleSide } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { float, instanceIndex, mix, positionLocal, sin, time, uv, vec3 } from 'three/tsl';
import type { TreeUniforms } from './shared';

export interface GroundCoverOptions {
  /** How far the tip travels sideways, as a fraction of the blade's height. */
  sway?: number;
  /** Shading at the root, where 1 is fully lit. */
  rootShade?: number;
  roughness?: number;
}

export function createGroundCoverMaterial(u: TreeUniforms, options: GroundCoverOptions = {}) {
  const { sway = 0.5, rootShade = 0.3, roughness = 0.94 } = options;

  const material = new MeshStandardNodeMaterial();
  // A blade is a single sheet of triangles; without this, half of every tuft is
  // culled and the field looks thinned out from one side only.
  material.side = DoubleSide;
  material.metalness = 0;
  material.roughness = roughness;

  // Height along the blade, 0 at the root and 1 at the tip.
  const t = uv().y;

  if (sway > 0) {
    // Instance index is the only per-instance value available without spending
    // another vertex buffer. Multiplying by the golden ratio and taking the
    // fraction turns consecutive indices into a well-spread set of phases, so
    // neighbouring tufts never beat in step.
    const phase = instanceIndex.toFloat().mul(0.6180339887).fract().mul(Math.PI * 2);
    const speed = u.windSpeed.mul(1.7);
    const gust = sin(time.mul(speed).add(phase))
      .mul(0.62)
      .add(sin(time.mul(speed.mul(2.3)).add(phase.mul(1.7))).mul(0.38));

    // Displacement proportional to height gives a straight blade a plausible
    // hinge at the root; the y term shortens it so the tip traces an arc
    // instead of stretching.
    const lean = gust.mul(u.wind).mul(sway).mul(t.mul(t).mul(0.65).add(t.mul(0.35)));
    const dir = u.windDir.normalize();
    material.positionNode = vec3(
      positionLocal.x.add(dir.x.mul(lean).mul(positionLocal.y)),
      positionLocal.y.mul(float(1).sub(lean.mul(lean).mul(0.3))),
      positionLocal.z.add(dir.y.mul(lean).mul(positionLocal.y)),
    );
  }

  // Root-to-tip occlusion. `instanceColor` is multiplied in automatically by
  // the node material, so per-clump tint still comes through.
  material.colorNode = vec3(1).mul(mix(rootShade, 1, t.pow(0.75)));

  return material;
}
