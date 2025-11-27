uniform sampler2D rockDisplacementMap;
uniform float minRockHeight;
uniform float maxRockHeight;
uniform float displacementScale;

varying vec2 vUv;
varying float vHeight;
varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

attribute float height;

void main() {
  vUv = uv;
  vHeight = height;
  
  float blendFactor = smoothstep(minRockHeight, maxRockHeight, height);
  
  float displacement = texture2D(rockDisplacementMap, vUv).r;
  
  vec3 displacedPosition = position + normal * displacement * displacementScale * blendFactor;
  
  vNormal = normal;
  vPosition = displacedPosition;
  
  vec4 worldPosition = modelMatrix * vec4(displacedPosition, 1.0);
  vWorldPosition = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displacedPosition, 1.0);
}

