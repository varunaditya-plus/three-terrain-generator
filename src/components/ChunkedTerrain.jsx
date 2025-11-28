import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { getTerrainHeight } from './Terrain'

const CHUNK_SIZE = 100
const CHUNK_SEGMENTS = 64
const TERRAIN_LOAD_DISTANCE = 400
const BASE_GROUND_OFFSET = 0.5
const MOUNTAIN_THRESHOLD = 6

export default function ChunkedTerrain({ scene, camera, noise2D, playerPosition, onMaterialUniformsReady }) {
  const materialUniformsRef = useRef(null)
  const texturesRef = useRef(null)
  const chunksRef = useRef(new Map()) // Map key -> { group, groundGeo, mountainGeo }
  const materialsRef = useRef(null) // [groundMat, mountainMat]
  const lastPlayerChunkRef = useRef({ x: null, z: null })

  useEffect(() => {
    if (!scene || !noise2D) return

    const textureLoader = new THREE.TextureLoader()
    const textures = {
      ground: textureLoader.load('/ground/rocky_terrain_02_diff_4k.jpg'),
      mountain: textureLoader.load('/rock/rock_face_03_diff_4k.jpg')
    }
    textures.ground.wrapS = textures.ground.wrapT = THREE.RepeatWrapping
    textures.ground.repeat.set(4, 4)
    textures.ground.colorSpace = THREE.SRGBColorSpace
    textures.mountain.wrapS = textures.mountain.wrapT = THREE.RepeatWrapping
    textures.mountain.repeat.set(2, 2)
    textures.mountain.colorSpace = THREE.SRGBColorSpace
    texturesRef.current = textures

    const materialUniforms = {
      uCameraPosition: { value: camera.position.clone() }
    }
    materialUniformsRef.current = materialUniforms
    if (onMaterialUniformsReady) onMaterialUniformsReady(materialUniforms)

    // Create shared materials
    const groundMaterial = new THREE.MeshStandardMaterial({
      map: textures.ground,
      roughness: 0.9,
      metalness: 0.05,
      side: THREE.DoubleSide
    })
    const mountainMaterial = new THREE.MeshStandardMaterial({
      map: textures.mountain,
      roughness: 0.95,
      metalness: 0.08,
      side: THREE.DoubleSide
    })
    materialsRef.current = [groundMaterial, mountainMaterial]

    // Helper to create geometry subset
    const createSubGeometry = (sourceGeometry, indices) => {
      const geometry = sourceGeometry.clone()
      if (indices.length > 0) {
        const IndexArrayType = (indices.length > 65535) ? Uint32Array : Uint16Array
        geometry.setIndex(new THREE.BufferAttribute(new IndexArrayType(indices), 1))
      } else {
        geometry.setIndex(null)
      }
      geometry.computeVertexNormals()
      return geometry
    }

    const createChunk = (chunkX, chunkZ) => {
      const key = `${chunkX},${chunkZ}`
      if (chunksRef.current.has(key)) return

      const worldX = chunkX * CHUNK_SIZE
      const worldZ = chunkZ * CHUNK_SIZE

      const geometry = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SEGMENTS, CHUNK_SEGMENTS)
      const vertices = geometry.attributes.position.array
      const vertexCount = vertices.length / 3
      const vertexHeights = new Float32Array(vertexCount)
      const vertexMountainMask = new Uint8Array(vertexCount)

      for (let i = 0; i < vertices.length; i += 3) {
        const localX = vertices[i]
        const localZ = -vertices[i + 1]
        const vx = worldX + localX
        const vz = worldZ + localZ
        
        const terrainData = getTerrainHeight(vx, vz, noise2D)
        const h = terrainData.height
        vertexHeights[i / 3] = h
        vertexMountainMask[i / 3] = terrainData.isMountainous ? 1 : 0
        vertices[i + 2] = h - BASE_GROUND_OFFSET
      }

      // Split indices
      const groundIndices = []
      const mountainIndices = []
      
      // If plane geometry has index, use it
      // Standard PlaneGeometry has an index
      const indexArray = geometry.index.array
      const faceCount = indexArray.length / 3

      for (let i = 0; i < faceCount; i++) {
        const a = indexArray[i * 3]
        const b = indexArray[i * 3 + 1]
        const c = indexArray[i * 3 + 2]
        
        const mountainVotes = vertexMountainMask[a] + vertexMountainMask[b] + vertexMountainMask[c]
        if (mountainVotes >= 2) {
          mountainIndices.push(a, b, c)
        } else {
          groundIndices.push(a, b, c)
        }
      }

      const groundGeo = createSubGeometry(geometry, groundIndices)
      const mountainGeo = createSubGeometry(geometry, mountainIndices)
      geometry.dispose() // Dispose base geometry

      const group = new THREE.Group()
      group.position.set(worldX, 0, worldZ)
      group.rotation.x = -Math.PI / 2

      if (groundIndices.length > 0) {
        const mesh = new THREE.Mesh(groundGeo, materialsRef.current[0])
        mesh.receiveShadow = true
        group.add(mesh)
      }
      if (mountainIndices.length > 0) {
        const mesh = new THREE.Mesh(mountainGeo, materialsRef.current[1])
        mesh.receiveShadow = true
        group.add(mesh)
      }

      group.name = `terrainChunk_${key}`
      scene.add(group)
      chunksRef.current.set(key, { group, groundGeo, mountainGeo })
    }

    const removeChunk = (key) => {
      const chunk = chunksRef.current.get(key)
      if (!chunk) return
      scene.remove(chunk.group)
      chunk.groundGeo.dispose()
      chunk.mountainGeo.dispose()
      chunksRef.current.delete(key)
    }

    const updateChunks = () => {
      if (!playerPosition) return

      const px = playerPosition.x
      const pz = playerPosition.z
      const chunkX = Math.floor(px / CHUNK_SIZE)
      const chunkZ = Math.floor(pz / CHUNK_SIZE)

      if (lastPlayerChunkRef.current.x === chunkX && lastPlayerChunkRef.current.z === chunkZ) {
        return
      }
      lastPlayerChunkRef.current = { x: chunkX, z: chunkZ }

      const loadRadius = Math.ceil(TERRAIN_LOAD_DISTANCE / CHUNK_SIZE)
      const keepKeys = new Set()

      for (let dx = -loadRadius; dx <= loadRadius; dx++) {
        for (let dz = -loadRadius; dz <= loadRadius; dz++) {
          const cx = chunkX + dx
          const cz = chunkZ + dz
          const key = `${cx},${cz}`
          keepKeys.add(key)
          createChunk(cx, cz)
        }
      }

      for (const key of chunksRef.current.keys()) {
        if (!keepKeys.has(key)) {
          removeChunk(key)
        }
      }
    }

    // Initial update
    if (playerPosition) updateChunks()

    // Animation loop
    let animationFrameId
    const animate = () => {
      if (materialUniformsRef.current) {
        materialUniformsRef.current.uCameraPosition.value.copy(camera.position)
      }
      if (playerPosition) {
        updateChunks()
      }
      animationFrameId = requestAnimationFrame(animate)
    }
    animationFrameId = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(animationFrameId)
      
      for (const key of chunksRef.current.keys()) {
        removeChunk(key)
      }
      
      if (materialsRef.current) {
        materialsRef.current.forEach(m => m.dispose())
      }
      
      if (texturesRef.current) {
        Object.values(texturesRef.current).forEach(t => t.dispose())
      }
    }
  }, [scene, camera, noise2D, playerPosition, onMaterialUniformsReady])

  return null
}
