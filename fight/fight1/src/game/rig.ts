import * as THREE from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'

/** One skinned character extracted from the shared GLB, with clips retargeted to its own bones. */
export type Rig = {
  /** Original root node from the GLB (keeps its authored rotation and 0.01 scale). */
  model: THREE.Object3D
  bones: Map<string, THREE.Bone>
  meshes: THREE.SkinnedMesh[]
  clips: Map<string, THREE.AnimationClip>
}

/** `mixamorig:LeftHand` → `LeftHand` (also strips numbered namespaces like `mixamorig1:`). */
export function canonicalBoneName(original: string): string {
  return THREE.PropertyBinding.sanitizeNodeName(original.replace(/^mixamorig\d*:/, ''))
}

type Owner = { rig: string; canonical: string }

/**
 * GLTFLoader makes duplicate node names unique (`mixamorigHips`, `mixamorigHips_1`...), so the two
 * skeletons in this file cannot share clips by name. We look up every node's original glTF name via
 * `parser.associations`, rename bones to canonical names (unique inside each rig) and rewrite every
 * clip's tracks to those names. Any clip can then drive either rig.
 */
export function extractRigs(gltf: GLTF, rootNames: readonly string[]): Map<string, Rig> {
  const json = gltf.parser.json as { nodes?: { name?: string }[] }
  const assoc = gltf.parser.associations as Map<THREE.Object3D, { nodes?: number }>
  const originalName = (obj: THREE.Object3D): string => {
    const index = assoc.get(obj)?.nodes
    return (index !== undefined ? json.nodes?.[index]?.name : undefined) ?? obj.name
  }

  const owners = new Map<string, Owner>()
  const rigs = new Map<string, Rig>()
  for (const rootName of rootNames) {
    const model = gltf.scene.getObjectByName(rootName)
    if (!model) throw new Error(`Character "${rootName}" not found in model`)
    const bones = new Map<string, THREE.Bone>()
    const meshes: THREE.SkinnedMesh[] = []
    model.traverse(obj => {
      if ((obj as THREE.Bone).isBone) {
        const canonical = canonicalBoneName(originalName(obj))
        owners.set(obj.name, { rig: rootName, canonical })
        obj.name = canonical
        bones.set(canonical, obj as THREE.Bone)
      } else if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
        meshes.push(obj as THREE.SkinnedMesh)
      }
    })
    rigs.set(rootName, { model, bones, meshes, clips: new Map() })
  }

  for (const clip of gltf.animations) {
    // Group the clip's tracks by the rig they were authored on; some clips animate both rigs with
    // the same motion, so keep the rig with the most tracks as the canonical source.
    const byRig = new Map<string, THREE.KeyframeTrack[]>()
    for (const track of clip.tracks) {
      const parsed = THREE.PropertyBinding.parseTrackName(track.name)
      const owner = owners.get(parsed.nodeName)
      if (!owner || parsed.propertyName === 'scale') continue
      const renamed = track.clone()
      renamed.name = `${owner.canonical}.${parsed.propertyName}`
      const list = byRig.get(owner.rig) ?? []
      list.push(renamed)
      byRig.set(owner.rig, list)
    }
    let source: THREE.KeyframeTrack[] = []
    for (const list of byRig.values()) if (list.length > source.length) source = list
    for (const rig of rigs.values()) {
      const tracks = source.filter(t => rig.bones.has(t.name.slice(0, t.name.lastIndexOf('.'))))
      rig.clips.set(clip.name, new THREE.AnimationClip(clip.name, -1, tracks))
    }
  }
  return rigs
}

/** Make the Tripo materials render opaque and cast shadows; skinned bounds are not trusted for culling. */
export function prepareMeshes(rig: Rig): void {
  for (const mesh of rig.meshes) {
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) {
      mat.transparent = false
      mat.depthWrite = true
      mat.alphaTest = 0
      mat.needsUpdate = true
    }
  }
}
