import * as THREE from 'three'

const HALF = 3.1
const ROPE_HEIGHTS = [0.42, 0.78, 1.14]

function canvasTexture(): THREE.CanvasTexture {
  const s = 1024
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  g.fillStyle = '#2a2b33'
  g.fillRect(0, 0, s, s)
  // Subtle canvas weave.
  for (let i = 0; i < 9000; i += 1) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`
    g.fillRect(Math.random() * s, Math.random() * s, 2, 2)
  }
  // Centre mark: ring logo slash, very low contrast.
  g.save()
  g.translate(s / 2, s / 2)
  g.strokeStyle = 'rgba(255,255,255,0.07)'
  g.lineWidth = 10
  g.beginPath()
  g.arc(0, 0, 180, 0, Math.PI * 2)
  g.stroke()
  g.rotate(-0.5)
  g.fillStyle = 'rgba(255,210,63,0.12)'
  g.fillRect(-14, -150, 28, 300)
  g.restore()
  // Border stripe.
  g.strokeStyle = 'rgba(255,255,255,0.08)'
  g.lineWidth = 14
  g.strokeRect(30, 30, s - 60, s - 60)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** Boxing ring: canvas, apron, corner posts (black/red/neutral), three ropes per side, lights. */
export class Arena {
  readonly group = new THREE.Group()
  /** Rope groups per side, with their outward normal; front sides fade so they never hide the fight. */
  private readonly sides: { normal: THREE.Vector3; mats: THREE.MeshStandardMaterial[] }[] = []
  readonly keyLight: THREE.SpotLight

  constructor(shadowMapSize: number) {
    const floorMat = new THREE.MeshStandardMaterial({ map: canvasTexture(), roughness: 0.92, metalness: 0 })
    const canvas = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 0.5, 0.12, HALF * 2 + 0.5), floorMat)
    canvas.position.y = -0.06
    canvas.receiveShadow = true
    this.group.add(canvas)

    const apron = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 0.56, 0.9, HALF * 2 + 0.56),
      new THREE.MeshStandardMaterial({ color: '#111116', roughness: 0.8 }))
    apron.position.y = -0.57
    this.group.add(apron)
    const trim = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 0.6, 0.05, HALF * 2 + 0.6),
      new THREE.MeshStandardMaterial({ color: '#ffd23f', roughness: 0.6, emissive: '#ffd23f', emissiveIntensity: 0.12 }))
    trim.position.y = -0.14
    this.group.add(trim)

    const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshStandardMaterial({ color: '#08080b', roughness: 1 }))
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -1.02
    this.group.add(ground)

    // Corner posts: black corner behind the black fighter (−x), red corner behind the robot (+x).
    const postGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.4, 16)
    const padGeo = new THREE.BoxGeometry(0.2, 0.9, 0.2)
    const corners: [number, number, string][] = [
      [-HALF, -HALF, '#15151b'], [-HALF, HALF, '#15151b'], [HALF, -HALF, '#c81e30'], [HALF, HALF, '#c81e30'],
    ]
    for (const [x, z, color] of corners) {
      const post = new THREE.Mesh(postGeo, new THREE.MeshStandardMaterial({ color: '#9aa0aa', metalness: 0.6, roughness: 0.4 }))
      post.position.set(x, 0.7, z)
      post.castShadow = true
      this.group.add(post)
      const pad = new THREE.Mesh(padGeo, new THREE.MeshStandardMaterial({ color, roughness: 0.7 }))
      pad.position.set(x - Math.sign(x) * 0.08, 0.78, z - Math.sign(z) * 0.08)
      this.group.add(pad)
    }

    const ropeColors = ['#e2273a', '#f4f4f6', '#1d4ed8']
    const sideDefs: [THREE.Vector3, number][] = [
      [new THREE.Vector3(0, 0, 1), 0], [new THREE.Vector3(0, 0, -1), 0], [new THREE.Vector3(1, 0, 0), Math.PI / 2], [new THREE.Vector3(-1, 0, 0), Math.PI / 2],
    ]
    for (const [normal, rot] of sideDefs) {
      const mats: THREE.MeshStandardMaterial[] = []
      ROPE_HEIGHTS.forEach((h, i) => {
        const mat = new THREE.MeshStandardMaterial({ color: ropeColors[i], roughness: 0.55, transparent: true, opacity: 1 })
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, HALF * 2, 10), mat)
        rope.rotation.z = Math.PI / 2
        rope.rotation.y = rot
        rope.position.copy(normal).multiplyScalar(HALF).setY(h)
        rope.castShadow = true
        this.group.add(rope)
        mats.push(mat)
      })
      this.sides.push({ normal, mats })
    }

    this.group.add(new THREE.HemisphereLight('#c9d3ff', '#3a2a22', 1.15))
    const key = new THREE.SpotLight('#fff8ee', 72, 14, Math.PI / 5, 0.55, 1.2)
    key.position.set(0.4, 6.2, 1.2)
    key.target.position.set(0, 0, 0)
    key.castShadow = true
    key.shadow.mapSize.set(shadowMapSize, shadowMapSize)
    key.shadow.bias = -0.0004
    key.shadow.normalBias = 0.02
    this.group.add(key, key.target)
    this.keyLight = key
    const rimRed = new THREE.DirectionalLight('#ff4a5a', 1.3)
    rimRed.position.set(4, 2.5, -3)
    const rimGold = new THREE.DirectionalLight('#ffd27a', 1.1)
    rimGold.position.set(-4, 2.5, -3)
    // Front fill from the camera side so faces and dark outfits read clearly.
    const fill = new THREE.DirectionalLight('#e8edff', 1.6)
    fill.position.set(0.6, 2.4, 5)
    const faceFill = new THREE.DirectionalLight('#f4f6ff', 0.85)
    faceFill.position.set(-2.5, 1.6, 4)
    this.group.add(rimRed, rimGold, fill, faceFill)
  }

  /** Fade rope sides that sit between the camera and the fighters. */
  update(camera: THREE.Camera, dt: number): void {
    const view = new THREE.Vector3(camera.position.x, 0, camera.position.z).normalize()
    for (const side of this.sides) {
      const facing = side.normal.dot(view)
      const target = facing > 0.35 ? 0.12 : 1
      for (const m of side.mats) {
        m.opacity += (target - m.opacity) * Math.min(1, dt * 8)
        m.depthWrite = m.opacity > 0.9
      }
    }
  }
}
