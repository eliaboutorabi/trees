/**
 * A mirror for still water: the scene seen from under a horizontal plane.
 *
 * A second camera, the first one reflected through the plane, renders the
 * scene into a small texture, and the water samples it where it is drawn. A
 * planar reflection is the right answer for a pond — the surface is flat, so
 * the mirror image is exact, and nothing screen-space can show what is behind
 * the camera's view of the tree, or under the leaves.
 *
 * What makes it affordable:
 *
 * - **Half the screen's resolution.** Ripples break the image up anyway.
 * - **Only what reflects.** Grass, flowers, butterflies and falling rain are
 *   hidden for the pass — tens of thousands of instances, none of which would
 *   read in a ripple. The tree, the stones, the hills and the birds stay.
 * - **No sky.** The pass clears to transparent, and the water's own lighting
 *   already reflects the sky; the mirror only lays what stands *in front of*
 *   it on top.
 * - **Nothing at all when the water is out of view**, or the camera is below
 *   the plane.
 *
 * The clipping plane is made oblique (Lengyel's method, as three's own
 * reflector does) so nothing under the water leaks into the image of what is
 * above it.
 */
import {
  Color,
  Frustum,
  HalfFloatType,
  Matrix4,
  PerspectiveCamera,
  Plane,
  RenderTarget,
  Sphere,
  Vector2,
  Vector3,
  Vector4,
  WebGPUCoordinateSystem,
  type Object3D,
  type Scene,
  type Texture,
} from 'three';
import type { WebGPURenderer } from 'three/webgpu';

const _frustum = new Frustum();
const _matrix = new Matrix4();
const _size = new Vector2();
const _position = new Vector3();
const _target = new Vector3();
const _up = new Vector3();
const _plane = new Plane();
const _clip = new Vector4();
const _q = new Vector4();

export class PlanarReflection {
  private readonly target = new RenderTarget(1, 1, { type: HalfFloatType });
  private readonly mirror = new PerspectiveCamera();
  /** Left out of the reflection: too small to read in it, or not in the sky. */
  readonly hidden: Object3D[] = [];
  /** Whether the last frame drew a reflection; the water shows none when not. */
  visible = false;

  /**
   * @param height  the plane, y = height
   * @param bounds  the water, for deciding whether it is in view at all
   * @param scale   of the screen's CSS resolution
   */
  constructor(
    private readonly height: number,
    private readonly bounds: Sphere,
    private readonly scale = 0.5,
  ) {}

  /** The mirror image. Sample it at the screen position flipped left to right. */
  get texture(): Texture {
    return this.target.texture;
  }

  /** Draw this frame's reflection, for the camera about to render the scene. */
  render(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera): void {
    camera.updateMatrixWorld();
    _matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_matrix, camera.coordinateSystem);
    _position.setFromMatrixPosition(camera.matrixWorld);
    this.visible = _position.y > this.height + 0.02 && _frustum.intersectsSphere(this.bounds);
    if (!this.visible) return;

    renderer.getSize(_size);
    const w = Math.max(1, Math.round(_size.x * this.scale));
    const h = Math.max(1, Math.round(_size.y * this.scale));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);

    // The camera, through the plane: its position, where it looks and which
    // way is up, each reflected. Looking at the reflected target makes a
    // proper rotation rather than a reflection, so the image comes out
    // mirrored left to right — which the water undoes when it samples it.
    const mirror = this.mirror;
    const y = this.height;
    camera.getWorldDirection(_target).add(_position);
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    mirror.position.set(_position.x, 2 * y - _position.y, _position.z);
    mirror.up.set(_up.x, -_up.y, _up.z);
    mirror.lookAt(_target.x, 2 * y - _target.y, _target.z);
    mirror.near = camera.near;
    mirror.far = camera.far;
    mirror.coordinateSystem = camera.coordinateSystem;
    mirror.layers.mask = camera.layers.mask;
    mirror.updateMatrixWorld();
    mirror.projectionMatrix.copy(camera.projectionMatrix);

    // Clip at the water rather than at the near plane: the plane in the
    // mirror camera's view space replaces the projection's near row.
    _plane.setFromNormalAndCoplanarPoint(_up.set(0, 1, 0), _target.set(0, y, 0));
    _plane.applyMatrix4(mirror.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const e = mirror.projectionMatrix.elements;
    _q.x = (Math.sign(_clip.x) + e[8]) / e[0];
    _q.y = (Math.sign(_clip.y) + e[9]) / e[5];
    _q.z = -1;
    _q.w = (1 + e[10]) / e[14];
    _clip.multiplyScalar(1 / _clip.dot(_q));
    e[2] = _clip.x;
    e[6] = _clip.y;
    // WebGPU's depth runs 0–1, so no shift by one as in GL.
    e[10] = renderer.coordinateSystem === WebGPUCoordinateSystem ? _clip.z : _clip.z + 1;
    e[14] = _clip.w;
    mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();

    // Only what reflects, against nothing.
    const shown = this.hidden.filter((o) => o.visible);
    for (const o of shown) o.visible = false;
    const background = scene.background;
    const backgroundNode = scene.backgroundNode;
    scene.background = null;
    scene.backgroundNode = null;
    const clear = renderer.getClearColor(_clearColor);
    const clearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);

    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, mirror);
    renderer.setRenderTarget(previous);

    renderer.setClearColor(clear, clearAlpha);
    scene.background = background;
    scene.backgroundNode = backgroundNode;
    for (const o of shown) o.visible = true;
  }

  dispose(): void {
    this.target.dispose();
  }
}

const _clearColor = new Color();
