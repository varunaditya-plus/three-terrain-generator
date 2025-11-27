import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { getTerrainHeight } from './Terrain'
import vertexShader from '../assets/terrain.vert?raw'
import fragmentShader from '../assets/terrain.frag?raw'

const CHUNK_SIZE = 100
const CHUNK_SEGMENTS = 64
const GRASS_LOAD_DISTANCE = 140 // Distance from player to load grass
const GRASS_FADE_START = 80 // Distance where grass starts fading out
const TERRAIN_LOAD_DISTANCE = 300 // Distance from player to load terrain chunks
const CHUNKS_TO_LOAD = Math.ceil(TERRAIN_LOAD_DISTANCE / CHUNK_SIZE) * 2 + 1

export default function ChunkedTerrain({ scene, camera, noise2D, playerPosition, onMaterialUniformsReady }) {
  const chunksRef = useRef(new Map()) // Map of "x,z" -> chunk data
  const materialUniformsRef = useRef(null)
  const texturesRef = useRef(null)
  const grassMeshesRef = useRef(new Map()) // Map of "x,z" -> grass meshes
  const grassGeometryRef = useRef(null) // Shared grass geometry
  const grassMaterialRef = useRef(null) // Shared grass material
  const lastPlayerChunkRef = useRef({ x: null, z: null })

  useEffect(() => {
    if (!scene || !noise2D) return

    // Load textures once
    const textureLoader = new THREE.TextureLoader()
    const textures = {
      ground: textureLoader.load('/ground/rocky_terrain_02_diff_4k.jpg'),
      rock: textureLoader.load('/rock/rock_face_03_diff_4k.jpg'),
      rockDisplacement: textureLoader.load('/rock/rock_face_03_disp_4k.png')
    }
    
    textures.ground.wrapS = textures.ground.wrapT = THREE.RepeatWrapping
    textures.ground.repeat.set(20, 20)
    textures.ground.colorSpace = THREE.SRGBColorSpace
    
    textures.rock.wrapS = textures.rock.wrapT = THREE.RepeatWrapping
    textures.rock.repeat.set(10, 10)
    textures.rock.colorSpace = THREE.SRGBColorSpace
    
    textures.rockDisplacement.wrapS = textures.rockDisplacement.wrapT = THREE.RepeatWrapping
    textures.rockDisplacement.repeat.set(10, 10)

    texturesRef.current = textures

    // Create material uniforms
    const materialUniforms = {
      grassTexture: { value: textures.ground },
      rockDiffuseTexture: { value: textures.rock },
      rockDisplacementMap: { value: textures.rockDisplacement },
      minRockHeight: { value: 6.0 },
      maxRockHeight: { value: 12.0 },
      displacementScale: { value: 2.0 },
      grassRoughness: { value: 0.8 },
      rockRoughness: { value: 0.9 },
      uCameraPosition: { value: camera.position.clone() }
    }
    materialUniformsRef.current = materialUniforms
    if (onMaterialUniformsReady) onMaterialUniformsReady(materialUniforms)

    const material = new THREE.ShaderMaterial({
      uniforms: materialUniforms,
      vertexShader,
      fragmentShader,
      side: THREE.FrontSide
    })

    // Function to get chunk key
    const getChunkKey = (x, z) => `${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`
    
    // Function to get chunk world position
    const getChunkWorldPos = (chunkX, chunkZ) => ({
      x: chunkX * CHUNK_SIZE,
      z: chunkZ * CHUNK_SIZE
    })

    // Function to create a terrain chunk
    const createTerrainChunk = (chunkX, chunkZ) => {
      const key = `${chunkX},${chunkZ}`
      if (chunksRef.current.has(key)) return // Already exists

      const worldPos = getChunkWorldPos(chunkX, chunkZ)
      const geometry = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SEGMENTS, CHUNK_SEGMENTS)
      const vertices = geometry.attributes.position.array

      // Generate heightmap
      const heights = []
      for (let i = 0; i < vertices.length; i += 3) {
        const localX = vertices[i]
        const localZ = -vertices[i + 1]
        const worldX = worldPos.x + localX
        const worldZ = worldPos.z + localZ
        const terrain = getTerrainHeight(worldX, worldZ, noise2D)
        vertices[i + 2] = terrain.height
        heights.push(terrain.height)
      }

      geometry.computeVertexNormals()
      geometry.setAttribute('height', new THREE.Float32BufferAttribute(heights, 1))

      const terrain = new THREE.Mesh(geometry, material)
      terrain.name = `terrainChunk_${key}`
      terrain.position.set(worldPos.x, 0, worldPos.z)
      terrain.rotation.x = -Math.PI / 2
      terrain.receiveShadow = true
      scene.add(terrain)

      chunksRef.current.set(key, {
        mesh: terrain,
        chunkX,
        chunkZ,
        worldPos,
        hasGrass: false
      })
    }

    const getChunkCenterDistance = (chunk, playerX, playerZ) => {
      const centerX = chunk.worldPos.x + CHUNK_SIZE * 0.5
      const centerZ = chunk.worldPos.z + CHUNK_SIZE * 0.5
      return Math.hypot(centerX - playerX, centerZ - playerZ)
    }

    const applyGrassFade = (chunk, key, playerX, playerZ) => {
      const grassData = grassMeshesRef.current.get(key)
      if (!grassData) return

      const distance = getChunkCenterDistance(chunk, playerX, playerZ)
      const fadeRange = Math.max(1, GRASS_LOAD_DISTANCE - GRASS_FADE_START)
      let targetOpacity = 1

      if (distance > GRASS_FADE_START) {
        const progress = (distance - GRASS_FADE_START) / fadeRange
        targetOpacity = 1 - Math.min(Math.max(progress, 0), 1)
      }

      targetOpacity = Math.max(0, Math.min(1, targetOpacity))
      grassData.material.opacity = targetOpacity
      grassData.material.needsUpdate = true
      grassData.group.visible = targetOpacity > 0.05
    }

    // Function to create grass for a chunk
    const createGrassForChunk = (chunkX, chunkZ) => {
      const key = `${chunkX},${chunkZ}`
      const chunk = chunksRef.current.get(key)
      if (!chunk || chunk.hasGrass) return // Chunk doesn't exist or already has grass

      const worldPos = chunk.worldPos
      
      // Create shared grass geometry and material (only once)
      if (!grassGeometryRef.current) {
        grassGeometryRef.current = new THREE.PlaneGeometry(2.5, 2.5)
      }
      if (!grassMaterialRef.current) {
        // Load grass textures if not already loaded
        if (!texturesRef.current.grassDiffuse) {
          texturesRef.current.grassDiffuse = textureLoader.load('/grass/grass_bermuda_01_diff_4k.jpg')
          texturesRef.current.grassAlpha = textureLoader.load('/grass/grass_bermuda_01_alpha_4k.png')
          texturesRef.current.grassDiffuse.colorSpace = THREE.SRGBColorSpace
        }

        grassMaterialRef.current = new THREE.MeshStandardMaterial({
          map: texturesRef.current.grassDiffuse,
          alphaMap: texturesRef.current.grassAlpha,
          transparent: true,
          alphaTest: 0.1,
          side: THREE.DoubleSide,
          roughness: 0.8,
          metalness: 0.1,
          depthWrite: false,
          envMap: null,
          envMapIntensity: 0
        })
      }

      // Calculate grass count to match original density
      // Original: 100,000 grass in ~45,000 sq units (120 unit radius) = ~2.2 per sq unit
      // Chunk: 100x100 = 10,000 sq units, so we need ~22,000 grass per chunk
      // Using 25,000 to account for some grass being placed on rocky areas
      const grassCount = 25000 // Grass per chunk (matches original density)
      const chunkGrassMaterial = grassMaterialRef.current.clone()
      chunkGrassMaterial.opacity = 0

      const grassMesh1 = new THREE.InstancedMesh(grassGeometryRef.current, chunkGrassMaterial, grassCount)
      const grassMesh2 = new THREE.InstancedMesh(grassGeometryRef.current, chunkGrassMaterial, grassCount)

      const matrix = new THREE.Matrix4()
      const pos = new THREE.Vector3()
      const rot = new THREE.Euler()
      const scl = new THREE.Vector3()

      let placed = 0
      // Try more attempts to place grass, accounting for rocky areas
      const maxAttempts = grassCount * 15
      for (let i = 0; i < maxAttempts && placed < grassCount; i++) {
        const x = worldPos.x + (Math.random() - 0.5) * CHUNK_SIZE
        const z = worldPos.z + (Math.random() - 0.5) * CHUNK_SIZE
        const terrainData = getTerrainHeight(x, z, noise2D)

        if (terrainData.height < materialUniforms.minRockHeight.value) {
          pos.set(x, terrainData.height + (Math.random() - 0.5) * 0.1, z)
          rot.set(0, Math.random() * Math.PI * 2, 0)
          const scale = 0.7 + Math.random() * 0.6
          scl.set(scale, scale, scale)

          matrix.compose(pos, new THREE.Quaternion().setFromEuler(rot), scl)
          grassMesh1.setMatrixAt(placed, matrix)

          rot.y += Math.PI / 2
          matrix.compose(pos, new THREE.Quaternion().setFromEuler(rot), scl)
          grassMesh2.setMatrixAt(placed, matrix)

          placed++
        }
      }
      
      // Update instance count if we didn't place all grass
      if (placed < grassCount) {
        grassMesh1.count = placed
        grassMesh2.count = placed
      }

      grassMesh1.instanceMatrix.needsUpdate = true
      grassMesh2.instanceMatrix.needsUpdate = true
      grassMesh1.castShadow = grassMesh2.castShadow = true

      const grassGroup = new THREE.Group()
      grassGroup.name = `grassChunk_${key}`
      grassGroup.add(grassMesh1, grassMesh2)
      scene.add(grassGroup)

      grassMeshesRef.current.set(key, {
        group: grassGroup,
        material: chunkGrassMaterial,
        meshes: [grassMesh1, grassMesh2]
      })
      chunk.hasGrass = true
    }

    // Function to remove grass from a chunk
    const removeGrassFromChunk = (chunkX, chunkZ) => {
      const key = `${chunkX},${chunkZ}`
      const chunk = chunksRef.current.get(key)
      if (!chunk || !chunk.hasGrass) return

      const grassData = grassMeshesRef.current.get(key)
      if (grassData) {
        grassData.meshes.forEach(mesh => mesh.dispose())
        grassData.material.dispose()
        scene.remove(grassData.group)
        grassMeshesRef.current.delete(key)
        chunk.hasGrass = false
      }
    }

    // Function to remove a terrain chunk
    const removeTerrainChunk = (chunkX, chunkZ) => {
      const key = `${chunkX},${chunkZ}`
      const chunk = chunksRef.current.get(key)
      if (!chunk) return

      // Remove grass first
      removeGrassFromChunk(chunkX, chunkZ)

      // Remove terrain mesh
      chunk.mesh.geometry.dispose()
      scene.remove(chunk.mesh)
      chunksRef.current.delete(key)
    }

    // Function to update chunks based on player position
    const updateChunks = (playerX, playerZ) => {
      const playerChunkX = Math.floor(playerX / CHUNK_SIZE)
      const playerChunkZ = Math.floor(playerZ / CHUNK_SIZE)

      // Check if player moved to a new chunk
      if (lastPlayerChunkRef.current.x === playerChunkX && 
          lastPlayerChunkRef.current.z === playerChunkZ) {
        return // No update needed
      }

      lastPlayerChunkRef.current = { x: playerChunkX, z: playerChunkZ }

      // Determine which chunks should exist
      const chunksToKeep = new Set()
      const loadRadius = Math.ceil(TERRAIN_LOAD_DISTANCE / CHUNK_SIZE)

      for (let dx = -loadRadius; dx <= loadRadius; dx++) {
        for (let dz = -loadRadius; dz <= loadRadius; dz++) {
          const chunkX = playerChunkX + dx
          const chunkZ = playerChunkZ + dz
          const key = `${chunkX},${chunkZ}`
          chunksToKeep.add(key)

          // Create chunk if it doesn't exist
          if (!chunksRef.current.has(key)) {
            createTerrainChunk(chunkX, chunkZ)
          }
        }
      }

      // Remove chunks that are too far away
      const chunksToRemove = []
      chunksRef.current.forEach((chunk, key) => {
        if (!chunksToKeep.has(key)) {
          chunksToRemove.push([chunk.chunkX, chunk.chunkZ])
        }
      })
      chunksToRemove.forEach(([x, z]) => removeTerrainChunk(x, z))

      // Update grass based on distance
      chunksRef.current.forEach((chunk, key) => {
        const chunkDistance = getChunkCenterDistance(chunk, playerX, playerZ)

        if (chunkDistance <= GRASS_LOAD_DISTANCE) {
          if (!chunk.hasGrass) {
            createGrassForChunk(chunk.chunkX, chunk.chunkZ)
          }
        } else {
          if (chunk.hasGrass) {
            removeGrassFromChunk(chunk.chunkX, chunk.chunkZ)
          }
        }

        if (chunk.hasGrass) {
          applyGrassFade(chunk, key, playerX, playerZ)
        }
      })
    }

    // Update camera position uniform
    const updateCameraPosition = () => {
      if (materialUniformsRef.current) {
        materialUniformsRef.current.uCameraPosition.value.copy(camera.position)
      }
    }

    // Initial chunk generation
    if (playerPosition) {
      updateChunks(playerPosition.x, playerPosition.z)
    }

    // Animation loop to update camera position and check for chunk updates
    let animationFrameId
    const animate = () => {
      updateCameraPosition()
      if (playerPosition) {
        updateChunks(playerPosition.x, playerPosition.z)
      }
      animationFrameId = requestAnimationFrame(animate)
    }
    animationFrameId = requestAnimationFrame(animate)

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameId)
      
      // Cleanup all chunks
      chunksRef.current.forEach((chunk) => {
        removeTerrainChunk(chunk.chunkX, chunk.chunkZ)
      })
      chunksRef.current.clear()
      grassMeshesRef.current.clear()

      // Cleanup textures
      if (texturesRef.current) {
        Object.values(texturesRef.current).forEach(texture => {
          if (texture && texture.dispose) texture.dispose()
        })
      }

      // Cleanup shared grass resources
      if (grassGeometryRef.current) {
        grassGeometryRef.current.dispose()
      }
      if (grassMaterialRef.current) {
        grassMaterialRef.current.dispose()
      }

      if (materialUniformsRef.current) {
        material.dispose()
      }
    }
  }, [scene, camera, noise2D, playerPosition, onMaterialUniformsReady])

  return null
}

