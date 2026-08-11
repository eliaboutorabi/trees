/**
 * Arbor — a parametric L-system tree engine for three.js.
 *
 * This module is the whole public surface, and it deliberately depends on
 * nothing above it: no renderer, no camera, no post-processing, no landscape,
 * no UI framework. Everything in `src/render` and `src/app` is one particular
 * application built on top of it.
 *
 * The short version:
 *
 *   import { Tree, getPreset } from './engine';
 *
 *   const tree = new Tree();
 *   scene.add(tree.group);
 *   tree.applyPreset(getPreset('oak'));
 *   tree.setSun(sunDirection, sunColour);
 *
 *   // animation loop
 *   tree.setGrowth(elapsed / 3);
 *
 * Growth and wind are GPU-side, so an animating tree costs the same as a static
 * one and `setGrowth` is a single uniform write. Rebuilding is only needed when
 * the grammar itself changes — see `LiveParams` for the long list of things
 * that do not need one.
 *
 * The lower-level pieces are exported too, for anyone who wants the skeleton
 * without the meshes (`buildTree`), their own materials over the standard
 * attributes (`buildTreeGeometry`, `createTreeUniforms`), or the growth and
 * wind vertex program on geometry of their own (`growthPosition`).
 */

// The whole tree, ready to add to a scene.
export { Tree } from './tree';
export type { TreeStructure, LiveParams, TreeOptions, TreeInfo } from './tree';

// Grammar: parse, derive, and interpret with a 3D turtle.
export { buildTree, getPreset, DEFAULT_PRESET_ID, PRESETS } from './lsystem';
export type { TreeBuild, GrammarIssue, Module, Production, Skeleton, LeafPlacement } from './lsystem';
export type { Preset, PresetParams, Palette } from './lsystem/presets';

// Meshing, for anyone supplying their own materials. Both meshes carry
// `aOrigin`, `aCenter` and a packed `aParams` vec4 so one vertex program can
// animate all of them.
export { buildTreeGeometry } from './treeGeometry';
export type { TreeGeometryOptions, TreeGeometryResult } from './treeGeometry';
export { CanopyOcclusion } from './occlusion';

// Materials and the shared vertex program.
export { createTreeUniforms, growthPosition, treeParams } from './materials/shared';
export type { TreeUniforms, GrowthOptions } from './materials/shared';
export { createBarkMaterial } from './materials/bark';
export { createLeafMaterial } from './materials/leaf';
export { createFlowerMaterial, createFruitMaterial } from './materials/ornament';
