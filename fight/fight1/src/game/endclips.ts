import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { canonicalBoneName } from './rig'

/**
 * End-of-match clips authored as Mixamo FBX (cm units, `mixamorig:` bone names). They are loaded,
 * remapped onto the fighters' canonical bone names and unit-normalised so the same clip drives
 * either rig. Position magnitudes are scaled against a reference clip from the GLB, which removes
 * any FBX unit ambiguity (Mixamo cm vs the GLB's baked metres).
 */
export type EndClips = { win: THREE.AnimationClip; lose: THREE.AnimationClip }

export async function loadEndClips(
  winUrl: string,
  loseUrl: string,
  bones: Set<string>,
  referenceClip: THREE.AnimationClip,
): Promise<EndClips> {
  const loader = new FBXLoader()
  const [winFbx, loseFbx] = await Promise.all([
    loader.loadAsync(winUrl),
    loader.loadAsync(loseUrl),
  ])
  const refScale = hipsPositionScale(referenceClip)
  const winRaw = pickClip(winFbx.animations, 'Victory')
  const loseRaw = pickClip(loseFbx.animations, 'Defeat')
  const win = remap(winRaw, bones, unitRatio(winRaw, refScale))
  const lose = remap(loseRaw, bones, unitRatio(loseRaw, refScale))
  return { win, lose }
}

/** Longest clip in the FBX (the files ship a single action each). */
function pickClip(clips: THREE.AnimationClip[], fallback: string): THREE.AnimationClip {
  if (!clips.length) throw new Error(`No animation found for ${fallback}`)
  let best = clips[0]
  for (const c of clips) if (c.duration > best.duration) best = c
  return best
}

/**
 * Rewrite an FBX clip's tracks onto the canonical bone names and drop anything the rig does not
 * have (FBX helper nodes, scale curves). Returns null when the clip matches no bones at all.
 */
function remap(source: THREE.AnimationClip, bones: Set<string>, posScale: number): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = []
  for (const track of source.tracks) {
    const parsed = THREE.PropertyBinding.parseTrackName(track.name)
    // FBXLoader pre-sanitizes names ("mixamorigHips"), GLTFLoader keeps the colon ("mixamorig:Hips").
    const bone = canonicalBoneName(parsed.nodeName.replace(/^mixamorig\d*:?/, ''))
    if (!bones.has(bone) || parsed.propertyName === 'scale') continue
    const renamed = track.clone()
    renamed.name = `${bone}.${parsed.propertyName}`
    if (parsed.propertyName === 'position' && posScale > 0 && posScale !== 1) {
      const values = renamed.values as Float32Array
      for (let i = 0; i < values.length; i++) values[i] *= posScale
    }
    tracks.push(renamed)
  }
  if (!tracks.length) throw new Error(`No matching bones for clip "${source.name}"`)
  return new THREE.AnimationClip(source.name, source.duration, tracks)
}

/** Typical hip height magnitude of a clip, used as the unit reference (metres in the GLB). */
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

/** Ratio that converts an FBX clip's position units onto the GLB reference units. */
function unitRatio(fbxClip: THREE.AnimationClip, refScale: number): number {
  const fbx = hipsPositionScale(fbxClip)
  return fbx > 1e-6 ? refScale / fbx : 1
}
