import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { getTerrainHeight } from './Terrain'

const BASE_WALK_SHAKE = 0.35
const TRAUMA_DECAY_RATE = 0.8

export default function Player({ scene, camera, renderer, terrainSize, noise2D, onPositionUpdate, onSprintStateChange }) {
  const keysRef = useRef({})
  const directionRef = useRef(new THREE.Vector3())
  const moveVectorRef = useRef(new THREE.Vector3())
  const yawRef = useRef(0)
  const pitchRef = useRef(0)
  const pointerLockedRef = useRef(false)
  const animationFrameRef = useRef(null)
  // Approximate "eye height" of the player above the terrain
  const cameraHeightRef = useRef(2.6)
  const verticalVelocityRef = useRef(0)
  const isGroundedRef = useRef(true)
  const raycasterRef = useRef(new THREE.Raycaster())
  const rayOriginRef = useRef(new THREE.Vector3())
  const downDirectionRef = useRef(new THREE.Vector3(0, -1, 0))
  const jumpLockRef = useRef(false)
  const isSprintingRef = useRef(false)

  // Under-the-hood player position (without shake) so physics/collisions stay stable
  const playerPositionRef = useRef(new THREE.Vector3())

  // Camera shake state (trauma-based, driven by movement/jumps)
  const traumaRef = useRef(0)
  const prevTimeRef = useRef(null)

  useEffect(() => {
    if (!scene || !camera || !renderer || !noise2D) return

    camera.rotation.order = 'YXZ'

    // Position camera slightly above the terrain to start
    const startX = 0
    const startZ = 0
    const maxRayHeight = terrainSize ? terrainSize * 2 : 500

    const getAccurateTerrainHeight = (x, z) => {
      const raycaster = raycasterRef.current
      const rayOrigin = rayOriginRef.current
      const downDirection = downDirectionRef.current
      rayOrigin.set(x, maxRayHeight, z)
      raycaster.set(rayOrigin, downDirection)
      
      // Check all terrain chunks
      const terrainChunks = []
      scene.traverse((object) => {
        if (object.name && object.name.startsWith('terrainChunk_')) {
          terrainChunks.push(object)
        }
      })
      
      if (terrainChunks.length > 0) {
        const intersects = raycaster.intersectObjects(terrainChunks, true)
        if (intersects.length > 0) {
          return intersects[0].point.y
        }
      }

      // Fallback to noise-based height if no mesh intersection
      return getHeightAt(x, z, noise2D)
    }

    const startHeight = getAccurateTerrainHeight(startX, startZ) + cameraHeightRef.current

    // Initialize player position (unshaken) and sync camera
    playerPositionRef.current.set(startX, startHeight, startZ)
    camera.position.copy(playerPositionRef.current)

    // Keyboard input handling
    const handleKeyDown = (event) => {
      keysRef.current[event.code] = true
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
        event.preventDefault()
      }
    }

    const handleKeyUp = (event) => {
      keysRef.current[event.code] = false
      if (event.code === 'Space') {
        jumpLockRef.current = false
      }
      if (event.code === 'KeyR') {
        isSprintingRef.current = false
        if (onSprintStateChange) {
          onSprintStateChange(false)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    renderer.domElement.addEventListener('keydown', handleKeyDown)
    renderer.domElement.addEventListener('keyup', handleKeyUp)

    renderer.domElement.setAttribute('tabindex', '0')
    renderer.domElement.focus()

    // Pointer lock for mouse look
    const onPointerLockChange = () => {
      pointerLockedRef.current = document.pointerLockElement === renderer.domElement
    }

    const onMouseMove = (event) => {
      if (!pointerLockedRef.current) return
      const sensitivity = 0.002
      yawRef.current -= (event.movementX || 0) * sensitivity
      pitchRef.current -= (event.movementY || 0) * sensitivity
      const maxPitch = Math.PI / 2 - 0.05
      pitchRef.current = Math.max(-maxPitch, Math.min(maxPitch, pitchRef.current))
    }

    const onClick = () => {
      renderer.domElement.focus()
      renderer.domElement.requestPointerLock()
    }

    document.addEventListener('pointerlockchange', onPointerLockChange)
    document.addEventListener('mousemove', onMouseMove)
    renderer.domElement.addEventListener('click', onClick)

    const focusCanvas = () => renderer.domElement.focus()
    window.addEventListener('click', focusCanvas)

    // Movement loop
    const baseMoveSpeed = 0.08
    const sprintMultiplier = 2.5
    const gravity = -0.01
    const jumpForce = 0.25
    const groundSnapDistance = 0.05

    const update = (time) => {
      const timeSeconds = time * 0.001
      const prevTime = prevTimeRef.current
      const deltaSeconds = prevTime === null ? 0 : Math.max(0.0001, timeSeconds - prevTime)
      prevTimeRef.current = timeSeconds

      const keys = keysRef.current

      // Handle sprint toggle
      if (keys['KeyR'] && !isSprintingRef.current) {
        isSprintingRef.current = true
        if (onSprintStateChange) {
          onSprintStateChange(true)
        }
      }

      const playerPos = playerPositionRef.current

      directionRef.current.set(0, 0, 0)
      if (keys['KeyW'] || keys['ArrowUp']) directionRef.current.z -= 1
      if (keys['KeyS'] || keys['ArrowDown']) directionRef.current.z += 1
      if (keys['KeyA'] || keys['ArrowLeft']) directionRef.current.x -= 1
      if (keys['KeyD'] || keys['ArrowRight']) directionRef.current.x += 1

      const isMoving = directionRef.current.lengthSq() > 0

      if (isMoving) {
        directionRef.current.normalize()

        const yaw = yawRef.current
        const forward = new THREE.Vector3(
          -Math.sin(yaw),
          0,
          -Math.cos(yaw)
        )
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()

        moveVectorRef.current.set(0, 0, 0)
        moveVectorRef.current.addScaledVector(forward, -directionRef.current.z)
        moveVectorRef.current.addScaledVector(right, directionRef.current.x)
        const currentMoveSpeed = isSprintingRef.current ? baseMoveSpeed * sprintMultiplier : baseMoveSpeed
        moveVectorRef.current.normalize().multiplyScalar(currentMoveSpeed)

        playerPos.add(moveVectorRef.current)
      }

      const terrainHeight = getAccurateTerrainHeight(playerPos.x, playerPos.z)
      const groundLevel = terrainHeight + cameraHeightRef.current
      
      // Check if grounded BEFORE jump check (using current position)
      const currentDistanceFromGround = playerPos.y - groundLevel
      const isCurrentlyGrounded = currentDistanceFromGround <= groundSnapDistance && verticalVelocityRef.current <= 0
      
      // Update grounded state if we detect we're on the ground
      if (isCurrentlyGrounded) {
        isGroundedRef.current = true
        // Reset jump lock when grounded so player can jump
        jumpLockRef.current = false
      }
      
      // Jump (requires key release to retrigger)
      if (keys['Space'] && !jumpLockRef.current && isGroundedRef.current) {
        verticalVelocityRef.current = jumpForce
        isGroundedRef.current = false
        jumpLockRef.current = true

        // Big burst of shake when jumping
        traumaRef.current = Math.min(1, traumaRef.current + 0.4)
      }

      if (!isGroundedRef.current) {
        verticalVelocityRef.current += gravity
      }

      playerPos.y += verticalVelocityRef.current

      const newDistanceFromGround = playerPos.y - groundLevel
      const wasGrounded = isGroundedRef.current

      // Add landing shake when hitting the ground (check before updating isGroundedRef)
      if ((newDistanceFromGround <= groundSnapDistance && verticalVelocityRef.current <= 0) || camera.position.y < groundLevel) {
        if (!wasGrounded) {
          traumaRef.current = Math.min(1, traumaRef.current + 0.3)
        }
      }

      if (newDistanceFromGround <= groundSnapDistance && verticalVelocityRef.current <= 0) {
        playerPos.y = groundLevel
        verticalVelocityRef.current = 0
        isGroundedRef.current = true
        // Reset jump lock when landing so player can jump again
        jumpLockRef.current = false
      } else if (camera.position.y < groundLevel) {
        playerPos.y = groundLevel
        verticalVelocityRef.current = 0
        isGroundedRef.current = true
        // Reset jump lock when landing so player can jump again
        jumpLockRef.current = false
      } else {
        isGroundedRef.current = false
      }

      // Decay trauma over time so shake eases out smoothly
      traumaRef.current = Math.max(0, traumaRef.current - TRAUMA_DECAY_RATE * deltaSeconds)

      // Calculate shake offsets from trauma and noise2D
      const baseMovementShake = (isMoving && isGroundedRef.current) ? BASE_WALK_SHAKE : 0
      const trauma = Math.max(baseMovementShake, traumaRef.current)
      const shake = trauma * trauma // use squared trauma for nicer falloff

      // Base camera from player position (no shake)
      camera.position.copy(playerPos)

      // Notify parent of position update
      if (onPositionUpdate) {
        onPositionUpdate(playerPos.clone())
      }

      if (shake > 0 && noise2D) {
        const noiseTime = timeSeconds * 4.0

        // Positional shake (meters)
        const maxPosShake = 0.18
        const offsetX = (noise2D(noiseTime, 0.0) * 2 - 1) * maxPosShake * shake
        const offsetY = (noise2D(noiseTime, 11.17) * 2 - 1) * maxPosShake * shake
        const offsetZ = (noise2D(noiseTime, 23.41) * 2 - 1) * maxPosShake * shake

        camera.position.x += offsetX
        camera.position.y += offsetY
        camera.position.z += offsetZ

        // Rotational shake (radians)
        const maxRotShake = 0.03
        const rotYawOffset = (noise2D(noiseTime, 37.99) * 2 - 1) * maxRotShake * shake
        const rotPitchOffset = (noise2D(noiseTime, 53.31) * 2 - 1) * maxRotShake * shake
        const rotRollOffset = (noise2D(noiseTime, 67.73) * 2 - 1) * maxRotShake * shake

        camera.rotation.y = yawRef.current + rotYawOffset
        camera.rotation.x = pitchRef.current + rotPitchOffset
        camera.rotation.z = rotRollOffset
        } else {
        // No shake, normal camera orientation
        camera.rotation.y = yawRef.current
        camera.rotation.x = pitchRef.current
        camera.rotation.z = 0
      }

      animationFrameRef.current = requestAnimationFrame(update)
    }

    animationFrameRef.current = requestAnimationFrame(update)

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('click', focusCanvas)
      renderer.domElement.removeEventListener('keydown', handleKeyDown)
      renderer.domElement.removeEventListener('keyup', handleKeyUp)
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      document.removeEventListener('mousemove', onMouseMove)
      renderer.domElement.removeEventListener('click', onClick)
    }
  }, [scene, camera, renderer, terrainSize, noise2D, onPositionUpdate])

  return null
}

function getHeightAt(x, z, noise2D) {
  const terrain = getTerrainHeight(x, z, noise2D)
  return terrain.height
}