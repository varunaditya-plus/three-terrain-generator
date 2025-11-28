// Terrain generation constants
const BIOME_THRESHOLD = 0.65
const BIOME_SCALE = 0.003

// Octave definitions for different terrain types
const MOUNTAIN_OCTAVES = [
  { scale: 0.01, amplitude: 30 },
  { scale: 0.02, amplitude: 15 },
  { scale: 0.04, amplitude: 8 },
  { scale: 0.08, amplitude: 3 },
  { scale: 0.15, amplitude: 1 }
]
const MOUNTAIN_BASE = 20

const PLAINS_OCTAVES = [
  { scale: 0.01, amplitude: 3 },
  { scale: 0.03, amplitude: 1.5 },
  { scale: 0.06, amplitude: 0.5 }
]
const PLAINS_BASE = 1

export function getTerrainHeight(x, z, noise2D) {
  if (!noise2D) return { height: 0, biomeMask: 0, isMountainous: false }

  // Calculate biome mask (0-1 range)
  const biomeMask = (noise2D(x * BIOME_SCALE, z * BIOME_SCALE) + 1) / 2
  const isMountainous = biomeMask > BIOME_THRESHOLD

  let height = 0

  if (isMountainous) {
    // Mountainous terrain
    const intensity = (biomeMask - BIOME_THRESHOLD) / (1 - BIOME_THRESHOLD)
    
    for (const octave of MOUNTAIN_OCTAVES) {
      height += noise2D(x * octave.scale, z * octave.scale) * octave.amplitude * intensity
    }
    height += MOUNTAIN_BASE * intensity
  } else {
    // Flat plains
    const intensity = 1 - (biomeMask / BIOME_THRESHOLD)
    
    for (const octave of PLAINS_OCTAVES) {
      height += noise2D(x * octave.scale, z * octave.scale) * octave.amplitude * intensity
    }
    height += PLAINS_BASE * intensity
  }

  return { height, biomeMask, isMountainous }
}