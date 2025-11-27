import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { getTerrainHeight } from './Terrain'
import vertexShader from '../assets/terrain.vert?raw'
import fragmentShader from '../assets/terrain.frag?raw'

export default function Terrain({ scene, camera, noise2D, terrainSize = 200, onMaterialUniformsReady }) {
  const materialUniformsRef = useRef(null)

  useEffect(() => {
    if (!scene || !noise2D) return

    const segments = 128
    const geometry = new THREE.PlaneGeometry(terrainSize, terrainSize, segments, segments)
    const vertices = geometry.attributes.position.array

    // Generate heightmap
    const heights = []
    for (let i = 0; i < vertices.length; i += 3) {
      const x = vertices[i]
      const z = -vertices[i + 1]
      const terrain = getTerrainHeight(x, z, noise2D)
      vertices[i + 2] = terrain.height
      heights.push(terrain.height)
    }

    geometry.computeVertexNormals()
    geometry.setAttribute('height', new THREE.Float32BufferAttribute(heights, 1))

    // Load textures
    const textureLoader = new THREE.TextureLoader()

    const groundTexture = textureLoader.load('/ground/rocky_terrain_02_diff_4k.jpg')
    groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping
    groundTexture.repeat.set(20, 20)
    groundTexture.colorSpace = THREE.SRGBColorSpace

    const rockTexture = textureLoader.load('/rock/rock_face_03_diff_4k.jpg')
    rockTexture.wrapS = rockTexture.wrapT = THREE.RepeatWrapping
    rockTexture.repeat.set(10, 10)
    rockTexture.colorSpace = THREE.SRGBColorSpace

    const rockDisplacementTexture = textureLoader.load('/rock/rock_face_03_disp_4k.png')
    rockDisplacementTexture.wrapS = rockDisplacementTexture.wrapT = THREE.RepeatWrapping
    rockDisplacementTexture.repeat.set(10, 10)

    // Create material
    const materialUniforms = {
      grassTexture: { value: groundTexture },
      rockDiffuseTexture: { value: rockTexture },
      rockDisplacementMap: { value: rockDisplacementTexture },
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

    // Create terrain mesh
    const terrain = new THREE.Mesh(geometry, material)
    terrain.name = 'terrainMesh'
    terrain.rotation.x = -Math.PI / 2
    terrain.receiveShadow = true
    scene.add(terrain)

    // Create grass
    const grassGroup = new THREE.Group()
    const grassDiffuse = textureLoader.load('/grass/grass_bermuda_01_diff_4k.jpg')
    const grassAlpha = textureLoader.load('/grass/grass_bermuda_01_alpha_4k.png')
    grassDiffuse.colorSpace = THREE.SRGBColorSpace

    const grassGeometry = new THREE.PlaneGeometry(2.5, 2.5)
    const grassMaterial = new THREE.MeshStandardMaterial({
      map: grassDiffuse,
      alphaMap: grassAlpha,
      transparent: true,
      alphaTest: 0.1,
      side: THREE.DoubleSide,
      roughness: 0.8,
      metalness: 0.1
    })

    const grassCount = 100000
    // Limit grass to a radius around the world origin to avoid rendering distant grass
    const maxGrassDistance = terrainSize * 0.6
    const maxGrassDistanceSq = maxGrassDistance * maxGrassDistance
    const grassMesh1 = new THREE.InstancedMesh(grassGeometry, grassMaterial, grassCount)
    const grassMesh2 = new THREE.InstancedMesh(grassGeometry, grassMaterial, grassCount)

    const matrix = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    const rot = new THREE.Euler()
    const scl = new THREE.Vector3()

    let placed = 0
    for (let i = 0; i < grassCount * 10 && placed < grassCount; i++) {
      const x = (Math.random() - 0.5) * terrainSize
      const z = (Math.random() - 0.5) * terrainSize

      // Skip grass that would be too far from the playable area
      if (x * x + z * z > maxGrassDistanceSq) continue
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

    grassMesh1.instanceMatrix.needsUpdate = true
    grassMesh2.instanceMatrix.needsUpdate = true
    grassMesh1.castShadow = grassMesh2.castShadow = true

    grassGroup.add(grassMesh1, grassMesh2)
    scene.add(grassGroup)

    // Cleanup
    return () => {
      geometry.dispose()
      material.dispose()
      groundTexture.dispose()
      rockTexture.dispose()
      rockDisplacementTexture.dispose()
      grassGeometry.dispose()
      grassMaterial.dispose()
      grassDiffuse.dispose()
      grassAlpha.dispose()
      grassMesh1.dispose()
      grassMesh2.dispose()
    }
  }, [scene, camera, noise2D, terrainSize, onMaterialUniformsReady])

  return null
}