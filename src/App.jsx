import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { createNoise2D } from 'simplex-noise'
import Player from './components/Player'
import ChunkedTerrain from './components/ChunkedTerrain.jsx'

function App() {
  const containerRef = useRef(null)
  const sceneRef = useRef(null)
  const rendererRef = useRef(null)
  const cameraRef = useRef(null)
  const animationFrameRef = useRef(null)
  const noise2DRef = useRef(null)
  const terrainSizeRef = useRef(200)
  const materialUniformsRef = useRef(null)
  const playerPositionRef = useRef(new THREE.Vector3(0, 0, 0))
  const [isReady, setIsReady] = useState(false)
  const handlePlayerPositionUpdate = useCallback((pos) => {
    playerPositionRef.current.copy(pos)
  }, [])

  useEffect(() => {
    if (!containerRef.current) return

    const width = containerRef.current.clientWidth
    const height = containerRef.current.clientHeight

    // Create scene
    const scene = new THREE.Scene()
    sceneRef.current = scene
    
    // Add distance fog for atmospheric depth
    const fogColor = new THREE.Color(0xD6DFE5)
    scene.fog = new THREE.Fog(fogColor, 20, 200)

    // Create camera
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000)
    camera.position.set(50, 40, 50)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    // Create renderer with improved settings
    const renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      powerPreference: "high-performance"
    })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.2
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setClearColor(fogColor)
    containerRef.current.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Load realistic HDR skybox
    const rgbeLoader = new RGBELoader()
    rgbeLoader.load('/skybox.hdr', (texture) => {
      // Set texture mapping for equirectangular projection
      texture.mapping = THREE.EquirectangularReflectionMapping
      
      // Set as scene background and environment
      scene.background = texture
      scene.environment = texture
      
      // Adjust tone mapping exposure for HDR
      renderer.toneMappingExposure = 1.0
    }, undefined, (error) => {
      console.error('Error loading skybox:', error)
      // Fallback to solid sky color if HDR fails
      scene.background = new THREE.Color(0x87ceeb)
      scene.environment = null
    })

    // Add realistic lighting setup
    // Hemisphere light for sky/ground ambient lighting
    const hemisphereLight = new THREE.HemisphereLight(
      0x87ceeb, // Sky color
      0x8b7355, // Ground color (brownish)
      0.4 // Intensity
    )
    scene.add(hemisphereLight)

    // Ambient light for overall illumination
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3)
    scene.add(ambientLight)

    // Main directional light (sun)
    const sunLight = new THREE.DirectionalLight(0xfff4e6, 1.2) // Warm sunlight
    sunLight.position.set(100, 150, 50)
    sunLight.castShadow = true
    
    // Configure shadow camera for better coverage
    sunLight.shadow.camera.left = -150
    sunLight.shadow.camera.right = 150
    sunLight.shadow.camera.top = 150
    sunLight.shadow.camera.bottom = -150
    sunLight.shadow.camera.near = 0.5
    sunLight.shadow.camera.far = 500
    sunLight.shadow.mapSize.width = 4096
    sunLight.shadow.mapSize.height = 4096
    sunLight.shadow.bias = -0.0001
    sunLight.shadow.normalBias = 0.02
    scene.add(sunLight)

    // Add a second directional light from opposite side for fill lighting
    const fillLight = new THREE.DirectionalLight(0x87ceeb, 0.3) // Cool blue fill
    fillLight.position.set(-50, 50, -50)
    scene.add(fillLight)

    // Generate noise for terrain
    const terrainSize = 200
    terrainSizeRef.current = terrainSize
    const noise2D = createNoise2D()
    noise2DRef.current = noise2D

    // Mark as ready for Player component
    setIsReady(true)

    // Handle window resize
    const handleResize = () => {
      if (!containerRef.current) return
      const newWidth = containerRef.current.clientWidth
      const newHeight = containerRef.current.clientHeight

      camera.aspect = newWidth / newHeight
      camera.updateProjectionMatrix()
      renderer.setSize(newWidth, newHeight)
    }
    window.addEventListener('resize', handleResize)

    // Animation loop
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate)
      // Update camera position uniform for shader
      if (materialUniformsRef.current) {
        materialUniformsRef.current.uCameraPosition.value.copy(camera.position)
      }
      renderer.render(scene, camera)
    }
    animate()

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize)
      
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      
      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement)
      }
      
      // Cleanup environment texture
      if (scene.background && scene.background.isTexture) {
        scene.background.dispose()
      }
      if (scene.environment && scene.environment.isTexture) {
        scene.environment.dispose()
      }
      
      renderer.dispose()
    }
  }, [])

  return (
    <>
      <div ref={containerRef} className="w-screen h-screen m-0 p-0 cursor-crosshair" />
      {isReady && sceneRef.current && cameraRef.current && rendererRef.current && noise2DRef.current && (
        <>
          <ChunkedTerrain 
            scene={sceneRef.current} 
            camera={cameraRef.current} 
            noise2D={noise2DRef.current} 
            playerPosition={playerPositionRef.current}
            onMaterialUniformsReady={(uniforms) => { materialUniformsRef.current = uniforms }} 
          />
          <Player 
            scene={sceneRef.current} 
            camera={cameraRef.current} 
            renderer={rendererRef.current} 
            terrainSize={terrainSizeRef.current} 
            noise2D={noise2DRef.current}
            onPositionUpdate={handlePlayerPositionUpdate}
          />
        </>
      )}
    </>
  )
}

export default App