import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { retargetClip } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { canonicalBoneName } from './rig'

/**
 * End-of-match clips authored as Mixamo FBX (cm units, `mixamorig` bone names). They are retargeted
 * onto a detached clone of a fighter rig with SkeletonUtils.retargetClip, which resolves every
 * bone's rest-pose/hierarchy differences (the GLB rigs hang Hips under a pre-rotated, unit-scaled
 * group; the FBX does not). The retargeted hip positions are then normalised onto the GLB clips'
 * units using a reference clip, since the two exports disagree on overall character scale.
 */
export type EndClips = { win: THREE.AnimationClip; lose: THREE.AnimationClip }

/**
 * @param probeBoneNames canonical bone names present on the fighters' rigs ("Hips", "Spine", ...)
 * @param probe         a detached `SkeletonUtils.clone()` of a fighter's rig model (same bone
 *                      names/rest pose as the live rigs, no animated state)
 * @param referenceClip any GLB fight clip, used purely as the unit reference for hip positions
 */
export async function loadEndClips(
  winUrl: string,
  loseUrl: string,
  probeBoneNames: Set<string>,
  probe: THREE.Object3D,
  referenceClip: THREE.AnimationClip,
): Promise<EndClips> {
  const loader = new FBXLoader()
  const [winFbx, loseFbx] = await Promise.all([
    loader.loadAsync(winUrl),
    loader.loadAsync(loseUrl),
  ])

  // SkeletonUtils.retargetClip wants the target as an Object3D exposing `.skeleton` (a SkinnedMesh
  // of the probe works) and matches source bones by name, so build the canonical -> mixamorig map.
  const targetMesh = findSkinnedMesh(probe)
  const names: Record<string, string> = {}
  for (const b of probeBoneNames) names[b] = `mixamorig${b}`
  const options = { hip: 'mixamorigHips', names }

  const winRaw = pickClip(winFbx.animations, 'Victory')
  const loseRaw = pickClip(loseFbx.animations, 'Defeat')
  // retargetClip expects the source to expose `.skeleton` (the animation-only FBX ships bones but
  // no mesh), so graft a Skeleton built from its bones onto the root.
  const winSource = withSkeleton(winFbx)
  const loseSource = withSkeleton(loseFbx)
  const win = renameTracks(retargetClip(targetMesh, winSource, winRaw, options))
  const lose = renameTracks(retargetClip(targetMesh, loseSource, loseRaw, options))

  // One unit ratio, measured on the standing clip (the fall clip's hips are lower by design, so
  // measuring per-clip would over-scale it).
  const refScale = hipsPositionScale(referenceClip)
  const ratio = hipsPositionScale(win) > 1e-6 ? refScale / hipsPositionScale(win) : 1
  if (Math.abs(ratio - 1) > 1e-4) scaleHips(win, ratio)
  if (Math.abs(ratio - 1) > 1e-4) scaleHips(lose, ratio)
  return { win, lose }
}

function findSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh {
  let mesh: THREE.SkinnedMesh | null = null
  root.traverse(o => {
    if (!mesh && (o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh
  })
  if (!mesh) throw new Error('Fighter rig probe contains no skinned mesh')
  return mesh
}

/** Graft a Skeleton built from the FBX's bones onto its root so retargetClip can enumerate bones. */
function withSkeleton(fbx: THREE.Group): THREE.Group & { skeleton: THREE.Skeleton } {
  const bones: THREE.Bone[] = []
  fbx.traverse(o => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone)
  })
  if (!bones.length) throw new Error('FBX contains no bones')
  return Object.assign(fbx, { skeleton: new THREE.Skeleton(bones) }) as THREE.Group & { skeleton: THREE.Skeleton }
}

/** Longest clip in the FBX (the files ship a single action each). */
function pickClip(clips: THREE.AnimationClip[], fallback: string): THREE.AnimationClip {
  if (!clips.length) throw new Error(`No animation found for ${fallback}`)
  let best = clips[0]
  for (const c of clips) if (c.duration > best.duration) best = c
  return best
}

function scaleHips(clip: THREE.AnimationClip, ratio: number): void {
  const track = clip.tracks.find(t => t.name === 'Hips.position')
  if (!track) return
  const values = track.values as Float32Array
  for (let i = 0; i < values.length; i++) values[i] *= ratio
}

/**
 * retargetClip names its tracks with the `.bones[Name].prop` selector, which PropertyBinding only
 * resolves when the mixer root itself carries a skeleton. Our fighters' mixers root at a plain
 * group, so rewrite the names to plain `Name.prop` bone lookups.
 */
function renameTracks(clip: THREE.AnimationClip): THREE.AnimationClip {
  for (const track of clip.tracks) {
    const m = /^\.bones\[(.+)\]\.(position|quaternion|scale)$/.exec(track.name)
    if (m) track.name = `${m[1]}.${m[2]}`
  }
  return clip
}

/** Typical hip height magnitude of a clip, used as the unit reference. */
function hipsPositionScale(clip: THREE.AnimationClip): number {
  const track = clip.tracks.find(t => t.name === 'Hips.position') ?? clip.tracks.find(t => t.name.endsWith('.position'))
  if (!track || track.values.length < 3) return 1
  let sum = 0
  let n = 0
  for (let i = 0; i + 2 < track.values.length; i += 3) {
    sum += Math.hypot(track.values[i], track.values[i + 1], track.values[i + 2])
    n++
  }
  return n > 0 ? sum / n : 1
}

// canonicalBoneName is re-exported for callers that need to build bone name sets.
export { canonicalBoneName }
